# WebSocket Protocol: Scope Sessions

This document describes the realtime protocol used by `/scope/[sessionId]`.

## Connection

The frontend opens a WebSocket connection to:

```text
ws://host/ws/scope/:sessionId?participantId=anonymous-id
```

The server currently uses `participantId` for presence tracking and session cleanup.

## Message Types

### Client -> Server

```ts
interface ScopeUpdateMessage {
  type: "scope:update";
  content: string;
  cursors: Record<string, { start: number; end: number; updatedAt: number }>;
}

interface ScopeFinalizeMessage {
  type: "scope:finalize";
  content: string;
  payload: {
    title: string;
    description: string;
    category: string;
  };
}
```

### Server -> Client

```ts
interface ScopeInitMessage {
  event: "scope:init";
  payload: {
    sessionId: string;
    participantId: string;
    content: string;
    cursors: Record<string, { start: number; end: number; updatedAt: number }>;
    finalized?: boolean;
    finalizedPayload?: Record<string, string> | null;
    expiresAt: string;
  };
}

interface ScopeUpdateBroadcast {
  event: "scope:update";
  payload: {
    sessionId: string;
    content: string;
    cursors: Record<string, { start: number; end: number; updatedAt: number }>;
    updatedAt: string;
  };
}

interface ScopeFinalizedBroadcast {
  event: "scope:finalized";
  payload: {
    sessionId: string;
    content: string;
    payload: Record<string, string> | null;
    updatedAt: string;
  };
}

interface ScopeErrorMessage {
  event: "scope:error";
  payload: { error: string };
}
```

## Session Lifecycle

1. A participant opens a unique session URL.
2. The backend loads the current session document or creates a fresh one.
3. The server sends `scope:init` with the current content, cursor map, and expiry timestamp.
4. Participants send `scope:update` messages while editing.
5. When the document is ready, a participant sends `scope:finalize`.
6. Finalization stores the payload used by `/post-job` and locks the document for subsequent edits.
7. Sessions expire after 24 hours of inactivity and are cleaned up by the backend.

## Rate Limiting

- The frontend debounces document updates to about one message every 2 seconds.
- The backend keeps a 24-hour session TTL and cleans expired sessions hourly.
- If you deploy the socket publicly, apply a reverse-proxy or gateway throttle as a second layer.

## Example Client

```ts
const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000");
const protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${apiUrl.host}/ws/scope/${sessionId}?participantId=${participantId}`);

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.event === "scope:init") {
    console.log("Loaded session", message.payload.sessionId);
  }
};

socket.send(JSON.stringify({
  type: "scope:update",
  content: "Draft scope text",
  cursors: {
    [participantId]: { start: 0, end: 5, updatedAt: Date.now() },
  },
}));
```
