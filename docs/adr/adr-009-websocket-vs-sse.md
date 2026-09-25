# ADR-009: WebSocket vs SSE for Real-Time Updates

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team, DevOps Team

## Context

Stellar MarketPay requires real-time updates for several features:

- **Job applications**: Notify clients when freelancers apply
- **Message notifications**: Alert users of new private messages
- **Escrow status changes**: Real-time updates when payments are released/refunded
- **Collaborative scope editor**: Multiple users editing job descriptions simultaneously
- **Presence indicators**: Show who is viewing a job listing
- **Admin dashboard**: Live metrics and alerts

Without real-time updates, users must poll the API (inefficient, high latency, poor UX).

Requirements:

- **Bidirectional communication**: Server pushes updates, client sends commands
- **Low latency**: < 100ms for notifications
- **Scalability**: Support 10,000+ concurrent connections
- **Reliability**: Automatic reconnection on disconnect
- **Browser compatibility**: Works in all modern browsers
- **Simple deployment**: Minimal infrastructure changes

Two primary technologies exist for real-time web communication:

1. **WebSocket**: Full-duplex bidirectional protocol
2. **Server-Sent Events (SSE)**: Server-to-client unidirectional protocol

## Decision

We will use **WebSocket** as the primary real-time communication protocol, with the following architecture:

### WebSocket Architecture

```
Client (Browser)
   ↓ ws:// or wss://
WebSocket Server (/ws/...)
   ↓
Redis Pub/Sub (multi-server coordination)
   ↓
Backend API (emits events)
```

### Implementation

#### Server Setup

```javascript
// src/websocket/server.js
const WebSocket = require('ws');
const redis = require('../config/redis');

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// Store active connections
const connections = new Map(); // userId → WebSocket

// Handle connection
wss.on('connection', (ws, req, userId) => {
  console.log(`✅ WebSocket connected: ${userId}`);
  
  connections.set(userId, ws);
  
  // Send initial state
  ws.send(JSON.stringify({
    type: 'connected',
    userId,
    timestamp: Date.now(),
  }));
  
  // Handle messages from client
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      await handleClientMessage(ws, userId, message);
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  // Handle disconnect
  ws.on('close', () => {
    console.log(`❌ WebSocket disconnected: ${userId}`);
    connections.delete(userId);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Subscribe to Redis pub/sub
const subscriber = redis.duplicate();
subscriber.subscribe('notifications', 'escrow-updates', 'messages');

subscriber.on('message', (channel, message) => {
  const event = JSON.parse(message);
  
  // Broadcast to relevant users
  const targetUsers = event.recipients || [event.userId];
  for (const userId of targetUsers) {
    const ws = connections.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }
});

module.exports = wss;
```

#### Express Integration

```javascript
// src/server.js
const express = require('express');
const http = require('http');
const wss = require('./websocket/server');

const app = express();
const server = http.createServer(app);

// Upgrade HTTP connections to WebSocket
server.on('upgrade', (request, socket, head) => {
  // Extract user from JWT
  const token = new URL(request.url, 'ws://localhost').searchParams.get('token');
  const userId = verifyJWT(token);
  
  if (!userId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, userId);
  });
});

server.listen(4000, () => {
  console.log('Server listening on :4000');
});
```

#### Client Implementation

```typescript
// lib/websocket.ts
class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  
  connect(token: string) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${process.env.NEXT_PUBLIC_API_URL}/ws?token=${token}`;
    
    this.ws = new WebSocket(url);
    
    this.ws.onopen = () => {
      console.log('✅ WebSocket connected');
      this.emit('connected', {});
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.emit(message.type, message);
    };
    
    this.ws.onclose = () => {
      console.log('❌ WebSocket disconnected, reconnecting...');
      this.reconnectTimeout = setTimeout(() => this.connect(token), 3000);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  send(type: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }
  
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }
  
  off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback);
  }
  
  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(callback => callback(data));
  }
  
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.ws?.close();
  }
}

export const wsClient = new WebSocketClient();
```

#### Usage Example

```typescript
// pages/dashboard.tsx
import { wsClient } from '@/lib/websocket';

export default function Dashboard() {
  useEffect(() => {
    const token = localStorage.getItem('jwt');
    wsClient.connect(token!);
    
    // Listen for notifications
    wsClient.on('notification', (data) => {
      showToast(data.message, 'info');
    });
    
    // Listen for escrow updates
    wsClient.on('escrow-update', (data) => {
      console.log('Escrow updated:', data);
      refetchEscrowStatus();
    });
    
    return () => {
      wsClient.disconnect();
    };
  }, []);
  
  return <div>Dashboard</div>;
}
```

## Rationale

### Why WebSocket?

- **Bidirectional**: Server can push, client can send commands
- **Low Latency**: Direct TCP connection, no HTTP overhead
- **Efficient**: Single connection for all messages
- **Real-Time**: Updates arrive instantly (< 10ms)
- **Binary Support**: Can send binary data (images, files)
- **Stateful**: Maintains connection state
- **Widely Supported**: 98%+ browser support
- **Battle-Tested**: Used by Slack, Discord, Trello

### Why Not SSE (Server-Sent Events)?

SSE was considered but rejected for the following reasons:

#### Pros of SSE:
- Simpler than WebSocket (HTTP-based)
- Automatic reconnection
- Built-in event IDs for replay
- Better proxy/firewall compatibility

#### Cons of SSE:
- **Unidirectional**: Server → Client only
- **No Binary Support**: Text only
- **Limited Scalability**: 6 connections per domain (browser limit)
- **HTTP Overhead**: Each message has HTTP headers
- **No Multiplexing**: One connection per event stream
- **Not Suitable for Collaboration**: Cannot send client commands

For our use case, **bidirectional communication** is essential for the collaborative scope editor and real-time messaging.

### Why Not Polling?

Short polling and long polling were rejected:

- **High Latency**: 1-5 second delay
- **Inefficient**: Constant HTTP requests
- **Server Load**: Wastes resources
- **Poor UX**: Delays visible to users

## Consequences

### Positive

- ✅ **True Real-Time**: Sub-100ms latency
- ✅ **Bidirectional**: Server and client can both send
- ✅ **Efficient**: Single connection, no HTTP overhead
- ✅ **Scalable**: Supports 10,000+ concurrent connections per server
- ✅ **Flexible**: Supports text and binary data
- ✅ **Collaborative**: Enables multi-user editing
- ✅ **Low Bandwidth**: Minimal overhead per message

### Negative

- ❌ **Stateful**: Must maintain connection state
- ❌ **Load Balancing Complexity**: Requires sticky sessions or pub/sub
- ❌ **Reconnection Logic**: Must implement client-side
- ❌ **Firewall Issues**: Some corporate firewalls block WebSocket
- ❌ **Debugging**: Harder to inspect than HTTP
- ❌ **No HTTP Caching**: Cannot cache WebSocket messages

## Implementation Details

### Authentication

```javascript
// Verify JWT from query param
const token = new URL(request.url, 'ws://localhost').searchParams.get('token');
const payload = jwt.verify(token, JWT_SECRET);
const userId = payload.sub;
```

### Scaling with Redis Pub/Sub

For multi-server deployments:

```javascript
// Server A receives message from client
redis.publish('notifications', JSON.stringify({
  userId: 'GXXXX',
  type: 'new-application',
  jobId: '123',
}));

// Server B (where user is connected) receives via subscriber
subscriber.on('message', (channel, message) => {
  const event = JSON.parse(message);
  const ws = connections.get(event.userId);
  if (ws) ws.send(message);
});
```

### Heartbeat / Ping-Pong

```javascript
// Keep connection alive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // Every 30 seconds

ws.on('pong', () => {
  ws.isAlive = true;
});
```

### Message Types

```typescript
// Notification
{
  type: 'notification',
  title: 'New Application',
  message: 'Alice applied to your job',
  jobId: '123',
  timestamp: 1234567890,
}

// Escrow Update
{
  type: 'escrow-update',
  jobId: '123',
  status: 'released',
  amount: 100.00,
  timestamp: 1234567890,
}

// Private Message
{
  type: 'message',
  from: 'GXXXX',
  to: 'GYYYY',
  cipherText: '...',
  nonce: '...',
  timestamp: 1234567890,
}

// Presence Update
{
  type: 'presence',
  jobId: '123',
  users: ['GXXXX', 'GYYYY'],
  timestamp: 1234567890,
}
```

### Error Handling

```javascript
// Handle malformed messages
ws.on('message', async (data) => {
  try {
    const message = JSON.parse(data);
    await handleMessage(message);
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Invalid message format',
    }));
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Closing WebSocket connections...');
  wss.clients.forEach((ws) => {
    ws.send(JSON.stringify({ type: 'server-shutdown' }));
    ws.close(1000, 'Server shutting down');
  });
  server.close();
});
```

### Load Balancing

For production with multiple servers:

```nginx
# nginx.conf
upstream websocket_backend {
  ip_hash; # Sticky sessions
  server backend1:4000;
  server backend2:4000;
  server backend3:4000;
}

server {
  location /ws {
    proxy_pass http://websocket_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400; # 24 hours
  }
}
```

### Monitoring

```javascript
// Track connection metrics
let connectionCount = 0;
let messageCount = 0;

wss.on('connection', (ws) => {
  connectionCount++;
  
  ws.on('message', () => {
    messageCount++;
  });
  
  ws.on('close', () => {
    connectionCount--;
  });
});

// Expose metrics
app.get('/metrics/websocket', (req, res) => {
  res.json({
    activeConnections: connectionCount,
    totalMessages: messageCount,
    uptime: process.uptime(),
  });
});
```

### Testing

```javascript
// test/websocket.test.js
const WebSocket = require('ws');

test('WebSocket connection', (done) => {
  const ws = new WebSocket('ws://localhost:4000/ws?token=valid_jwt');
  
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'ping' }));
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    expect(message.type).toBe('pong');
    ws.close();
    done();
  });
});
```

## Future Considerations

### GraphQL Subscriptions

For more structured real-time APIs, consider GraphQL subscriptions over WebSocket.

### WebRTC

For peer-to-peer video/audio calls between clients and freelancers.

### WebTransport

Next-generation protocol (successor to WebSocket) with better performance and multiplexing.

### Edge Functions

Deploy WebSocket handlers to edge locations for lower latency.

## Related ADRs

- ADR-008: Redis for Session Storage (uses Redis pub/sub)
- ADR-005: Message Encryption (sends encrypted messages via WebSocket)

## References

- [WebSocket Protocol (RFC 6455)](https://datatracker.ietf.org/doc/html/rfc6455)
- [ws Library Documentation](https://github.com/websockets/ws)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [WebSocket vs SSE](https://ably.com/topic/websockets-vs-sse)
- [Scaling WebSockets](https://socket.io/docs/v4/using-multiple-nodes/)
