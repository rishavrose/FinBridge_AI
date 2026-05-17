import WebSocket from 'ws';
import type { EventMap, WebSocketConfig } from '../types/index.js';
import { EventBus } from './events.js';
import { WebSocketError } from '../errors/index.js';
import type { Logger } from '../utils/logger.js';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface WsMessage {
  event: string;
  data: unknown;
  id?: string;
}

/**
 * Managed WebSocket client with automatic reconnection and heartbeating.
 * Emits typed events via the shared EventBus.
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Set<string>;

  private readonly apiKey: string;
  private readonly wsUrl: string;
  private readonly reconnect: boolean;
  private readonly reconnectDelay: number;
  private readonly maxReconnectAttempts: number;
  private readonly heartbeatInterval: number;
  private readonly events: EventBus;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    events: EventBus,
    logger: Logger,
    config: WebSocketConfig = {},
    baseUrl = 'wss://api.finbridgeai.com',
  ) {
    this.apiKey = apiKey;
    this.events = events;
    this.logger = logger;
    this.wsUrl = config.url ?? baseUrl.replace(/^https?/, 'wss').replace(/^http/, 'ws') + '/ws';
    this.reconnect = config.reconnect ?? true;
    this.reconnectDelay = config.reconnectDelay ?? 2_000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.heartbeatInterval = config.heartbeatInterval ?? 30_000;
    this.subscriptions = new Set(config.subscriptions ?? []);
  }

  /** Open the WebSocket connection. */
  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') return;

    this.state = 'connecting';
    this.logger.debug('WebSocket connecting…', { url: this.wsUrl });

    this.ws = new WebSocket(this.wsUrl, {
      headers: { 'X-API-Key': this.apiKey },
    });

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (raw) => this.handleMessage(raw));
    this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
    this.ws.on('error', (err) => this.handleError(err));
  }

  /** Gracefully close the connection. */
  disconnect(): void {
    this.reconnect && this.clearTimers();
    this.state = 'disconnected';
    this.ws?.close(1000, 'Client disconnected');
    this.ws = null;
  }

  /** Subscribe to a named channel. */
  subscribe(channel: string): void {
    this.subscriptions.add(channel);
    if (this.state === 'connected') {
      this.send({ event: 'subscribe', data: { channel } });
    }
  }

  /** Unsubscribe from a named channel. */
  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    if (this.state === 'connected') {
      this.send({ event: 'unsubscribe', data: { channel } });
    }
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private handleOpen(): void {
    this.state = 'connected';
    this.reconnectAttempts = 0;
    this.logger.info('WebSocket connected');

    this.events.emit('connected', {
      connectionId: generateConnectionId(),
      timestamp: new Date().toISOString(),
    });

    // Re-subscribe to all tracked channels
    for (const channel of this.subscriptions) {
      this.send({ event: 'subscribe', data: { channel } });
    }

    this.startHeartbeat();
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let parsed: WsMessage;

    try {
      parsed = JSON.parse(raw.toString()) as WsMessage;
    } catch {
      this.logger.warn('Received non-JSON WebSocket message');
      return;
    }

    this.logger.debug('WebSocket message', { event: parsed.event });
    this.events.emit(parsed.event as keyof EventMap, parsed.data as EventMap[keyof EventMap]);
  }

  private handleClose(code: number, reason: string): void {
    this.clearTimers();
    this.state = 'disconnected';

    this.logger.warn('WebSocket closed', { code, reason });
    this.events.emit('disconnected', { reason, timestamp: new Date().toISOString() });

    if (this.reconnect && code !== 1000) {
      this.scheduleReconnect();
    }
  }

  private handleError(err: Error): void {
    this.logger.error('WebSocket error', { message: err.message });
    this.events.emit('error', {
      message: err.message,
      code: 'WS_ERROR',
    });
    throw new WebSocketError(err.message);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max WebSocket reconnect attempts reached');
      return;
    }

    this.state = 'reconnecting';
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    this.logger.info(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'connected') {
        this.send({ event: 'ping', data: { timestamp: Date.now() } });
      }
    }, this.heartbeatInterval);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}

function generateConnectionId(): string {
  return `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
