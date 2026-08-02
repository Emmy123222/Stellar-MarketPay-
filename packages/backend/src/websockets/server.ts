import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import http from 'http';
import { logger } from '../utils/logger';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import { chatBotService, ChatMessage } from '../services/chatBotService';

// Interface for typed events
interface ServerToClientEvents {
  priceUpdate: (data: { flightId: string; price: number; timestamp: Date }) => void;
  alert: (data: FlightAlertPayload) => void;
  booking_status: (data: { bookingId: string; status: string; timestamp: Date }) => void;
  flight_status: (data: FlightStatusPayload) => void;
  contract_event: (data: ContractEventPayload) => void;
  'chat:reply': (data: { message: ChatMessage; escalated: boolean }) => void;
}

export type FlightStatus = 'SCHEDULED' | 'DELAYED' | 'GATE_CHANGED' | 'BOARDING' | 'CANCELLED' | 'LANDED';

export interface FlightStatusPayload {
  flightId: string;
  status: FlightStatus;
  /** Present for DELAYED (new departure time) and GATE_CHANGED (new gate) updates. */
  detail?: string;
  timestamp: Date;
}

export interface FlightAlertPayload {
  message: string;
  flightId: string;
  status?: string;
  gate?: string;
  delayMinutes?: number;
  timestamp?: Date;
}

interface ClientToServerEvents {
  subscribe: (flightId: string) => void;
  unsubscribe: (flightId: string) => void;
  subscribe_address: (walletAddress: string) => void;
  unsubscribe_address: (walletAddress: string) => void;
  subscribe_job: (jobId: string) => void;
  unsubscribe_job: (jobId: string) => void;
  'chat:message': (text: string) => void;
}

export interface ContractEventPayload {
  contractId: string;
  eventType: string;
  ledger: number;
  walletAddress?: string;
  data: unknown;
  timestamp: Date;
}

export class WebSocketServer {
  private io: Server<ClientToServerEvents, ServerToClientEvents>;
  private pubClient: any;
  private subClient: any;
  private redisEnabled: boolean = false; // Track Redis status
  /** Chat message history per socket connection (issue #379). Cleared on disconnect. */
  private chatHistory = new Map<string, ChatMessage[]>();

  constructor(httpServer: http.Server) {
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin || '*',
        methods: ['GET', 'POST']
      }
    });

    // Setup connection handlers immediately
    this.setupConnectionHandlers();
    
    // Setup Redis adapter asynchronously but don't block
    this.setupRedisAdapter().catch(error => {
      logger.error('Redis adapter setup failed, continuing with in-memory adapter:', error);
    });
  }

  private async setupRedisAdapter() {
    try {
      const redisUrl = config.redisUrl || process.env.REDIS_URL || 'redis://172.20.145.159:6379';
      logger.info(`Attempting to connect to Redis at: ${redisUrl}`);
      
      this.pubClient = createClient({ url: redisUrl });
      this.subClient = this.pubClient.duplicate();

      // Add error handlers before connecting
      this.pubClient.on('error', (err: any) => {
        logger.error(`Redis Publisher error: ${err.message}`);
        this.redisEnabled = false;
      });

      this.subClient.on('error', (err: any) => {
        logger.error(`Redis Subscriber error: ${err.message}`);
        this.redisEnabled = false;
      });

      // Connect with timeout
      await Promise.race([
        Promise.all([this.pubClient.connect(), this.subClient.connect()]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
        )
      ]);

      // Apply Redis adapter
      this.io.adapter(createAdapter(this.pubClient, this.subClient));
      this.redisEnabled = true;
      logger.info('✅ WebSocket Redis Adapter initialized successfully');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`⚠️ Redis adapter not initialized (using in-memory adapter): ${errorMessage}`);
      this.redisEnabled = false;
      
      // Clean up any partial connections
      if (this.pubClient) {
        try { this.pubClient.quit(); } catch (e) {}
      }
      if (this.subClient) {
        try { this.subClient.quit(); } catch (e) {}
      }
    }
  }

  private setupConnectionHandlers() {
    // Add connection logging middleware
    this.io.use((socket, next) => {
      logger.info(`Socket connection attempt: ${socket.id}`);
      next();
    });

    // Authentication middleware: verify JWT if provided, attach to socket.data.user
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token) return next();

      try {
        const payload = jwt.verify(token, config.jwtSecret) as any;
        (socket as any).data = (socket as any).data || {};
        (socket as any).data.user = payload;
        logger.info(`Socket ${socket.id} authenticated (user=${payload?.sub || payload?.id || 'unknown'})`);
      } catch (err) {
        logger.warn(`Socket ${socket.id} failed auth: ${(err as any)?.message || err}`);
        // allow connection to proceed but unauthenticated
      }
      return next();
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info(`✅ Client connected: ${socket.id} (Redis: ${this.redisEnabled ? 'enabled' : 'disabled'})`);

      socket.on('subscribe', (flightId: string) => {
        logger.info(`Client ${socket.id} subscribed to flight ${flightId}`);
        socket.join(`flight:${flightId}`);
      });

      socket.on('unsubscribe', (flightId: string) => {
        logger.info(`Client ${socket.id} unsubscribed from flight ${flightId}`);
        socket.leave(`flight:${flightId}`);
      });

      socket.on('subscribe_booking', (bookingId: string) => {
        logger.info(`Client ${socket.id} subscribed to booking ${bookingId}`);
        socket.join(`booking:${bookingId}`);
      });

      socket.on('unsubscribe_booking', (bookingId: string) => {
        logger.info(`Client ${socket.id} unsubscribed from booking ${bookingId}`);
        socket.leave(`booking:${bookingId}`);
      });

      socket.on('subscribe_address', (walletAddress: string) => {
        logger.info(`Client ${socket.id} subscribed to address room ${walletAddress}`);
        socket.join(`address:${walletAddress}`);
      });

      socket.on('unsubscribe_address', (walletAddress: string) => {
        logger.info(`Client ${socket.id} unsubscribed from address room ${walletAddress}`);
        socket.leave(`address:${walletAddress}`);
      });

      socket.on('subscribe_job', (jobId: string) => {
        logger.info(`Client ${socket.id} subscribed to job ${jobId}`);
        socket.join(`job:${jobId}`);
      });

      socket.on('unsubscribe_job', (jobId: string) => {
        logger.info(`Client ${socket.id} unsubscribed from job ${jobId}`);
        socket.leave(`job:${jobId}`);
      });

      socket.on('chat:message', (text: string) => {
        this.handleChatMessage(socket, text);
      });

      socket.on('disconnect', () => {
        logger.info(`🔴 Client disconnected: ${socket.id}`);
        this.chatHistory.delete(socket.id);
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error(`Socket ${socket.id} error:`, error);
      });
    });

    // Handle server-level errors
    this.io.engine.on('connection_error', (err: any) => {
      logger.error('Engine connection error:', err);
    });
  }

  public broadcastPriceUpdate(flightId: string, price: number) {
    const room = `flight:${flightId}`;
    logger.info(`Broadcasting price update to ${room}: $${price}`);
    
    this.io.to(room).emit('priceUpdate', {
      flightId,
      price,
      timestamp: new Date()
    });
  }

  public broadcastBookingStatus(bookingId: string, status: string) {
    const room = `booking:${bookingId}`;
    logger.info(`Broadcasting booking status to ${room}: ${status}`);
    this.io.to(room).emit('booking_status', {
      bookingId,
      status,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcasts a flight status change (issue #381) — delays, gate changes,
   * cancellations, boarding calls — to clients subscribed to that flight's
   * room via the existing `subscribe`/`unsubscribe` events. Distinct from
   * `priceUpdate`, which only covers pricing.
   */
  public broadcastFlightStatus(flightId: string, status: FlightStatus, detail?: string) {
    const room = `flight:${flightId}`;
    logger.info(`Broadcasting flight status to ${room}: ${status}`);
    this.io.to(room).emit('flight_status', {
      flightId,
      status,
      detail,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast a flight status change (delay, cancellation, gate change) to
   * everyone subscribed to that flight's room. Uses the `alert` event that
   * was already declared on ServerToClientEvents but had no emitter (#380).
   * Distinct from `broadcastFlightStatus` above (issue #381, merged in
   * parallel): different event name (`alert` vs `flight_status`) and a
   * richer payload (a pre-built message string) — flightStatus.ts and the
   * FlightStatusBanner/useFlightStatusAlerts client code this PR adds
   * depend on this one specifically.
   */
  public broadcastFlightAlert(payload: FlightAlertPayload) {
    const room = `flight:${payload.flightId}`;
    logger.info(`Broadcasting flight alert to ${room}: ${payload.message}`);
    this.io.to(room).emit('alert', {
      ...payload,
      timestamp: payload.timestamp ?? new Date(),
    });
  }

  /**
   * Broadcast a Soroban contract event to all subscribers of the contract room
   * and, when a wallet address is present, to that address-specific room too.
   */
  public broadcastContractEvent(payload: ContractEventPayload) {
    const contractRoom = `contract:${payload.contractId}`;
    this.io.to(contractRoom).emit('contract_event', payload);

    if (payload.walletAddress) {
      const addressRoom = `address:${payload.walletAddress}`;
      this.io.to(addressRoom).emit('contract_event', payload);
    }

    logger.debug('Contract event broadcast', {
      contractId: payload.contractId,
      eventType: payload.eventType,
      ledger: payload.ledger,
    });
  }

  // Method to check Redis status
  public isRedisEnabled(): boolean {
    return this.redisEnabled;
  }

  /**
   * Handles an inbound chat message (issue #379): appends it to the
   * socket's history, gets a bot response (or an escalation signal), and
   * replies over the same socket. Escalation just flags the message —
   * routing to a human queue is a follow-on integration, not built here.
   */
  private handleChatMessage(socket: Socket<ClientToServerEvents, ServerToClientEvents>, text: string): void {
    const trimmed = typeof text === 'string' ? text : '';
    const history = this.chatHistory.get(socket.id) ?? [];

    const userMessage: ChatMessage = {
      id: `${socket.id}-${history.length}`,
      from: 'user',
      text: trimmed,
      createdAt: new Date(),
    };
    history.push(userMessage);

    const { reply, escalate } = chatBotService.respond(trimmed);
    const botMessage: ChatMessage = {
      id: `${socket.id}-${history.length}`,
      from: escalate ? 'agent' : 'bot',
      text: reply,
      createdAt: new Date(),
    };
    history.push(botMessage);

    this.chatHistory.set(socket.id, history);

    if (escalate) {
      logger.info(`Chat escalated to human agent for socket ${socket.id}`);
    }

    socket.emit('chat:reply', { message: botMessage, escalated: escalate });
  }

  /** Test/introspection hook: read a socket's chat history. */
  public getChatHistory(socketId: string): ChatMessage[] {
    return this.chatHistory.get(socketId) ?? [];
  }
}

let wsServer: WebSocketServer | null = null;

export const initWebSocket = (httpServer: http.Server) => {
  logger.info('Initializing WebSocket server...');
  wsServer = new WebSocketServer(httpServer);
  return wsServer;
};

export const getWebSocketServer = () => {
  if (!wsServer) {
    throw new Error('WebSocket Server not initialized');
  }
  return wsServer;
};
