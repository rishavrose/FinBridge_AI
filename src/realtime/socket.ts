/**
 * Socket.io manager — attaches to Fastify's HTTP server and emits
 * real-time events to connected dashboard clients.
 */

import { Server as SocketIO } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { logger } from '../utils/logger.js';

let io: SocketIO | null = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initSocketIO(httpServer: HttpServer): SocketIO {
  io = new SocketIO(httpServer, {
    path: '/ws',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'WebSocket client connected');

    socket.on('subscribe', (room: string) => {
      socket.join(room);
      logger.debug({ socketId: socket.id, room }, 'Client subscribed to room');
    });

    socket.on('unsubscribe', (room: string) => {
      socket.leave(room);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'WebSocket client disconnected');
    });

    // Send initial connection ack
    socket.emit('connected', { ts: Date.now() });
  });

  logger.info('✅ Socket.io initialized on /ws');
  return io;
}

export function getSocketIO(): SocketIO | null {
  return io;
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

/** Broadcast live metrics to all dashboard subscribers */
export function emitMetrics(metrics: unknown): void {
  io?.emit('metrics:update', { ts: Date.now(), data: metrics });
}

/** Broadcast a new or updated alert */
export function emitAlert(alert: unknown): void {
  io?.emit('alert:new', { ts: Date.now(), data: alert });
}

/** Broadcast resolved alert */
export function emitAlertResolved(alertId: string): void {
  io?.emit('alert:resolved', { ts: Date.now(), id: alertId });
}

/** Broadcast an incident update */
export function emitIncident(incident: unknown): void {
  io?.emit('incident:update', { ts: Date.now(), data: incident });
}

/** Broadcast AI insights */
export function emitInsight(insight: string): void {
  io?.emit('ai:insight', { ts: Date.now(), insight });
}

// ─── AI Chat Progress Events ──────────────────────────────────────────────────

export type AiProgressStage =
  | 'start'
  | 'cache_check'
  | 'context_load'
  | 'tool_start'
  | 'tool_done'
  | 'generating'
  | 'validating'
  | 'complete'
  | 'cache_hit';

export interface AiProgressPayload {
  conversationId: string | null;
  stage: AiProgressStage;
  message: string;
  tool?: string;
}

/** Emit AI processing progress to all connected clients */
export function emitAiProgress(payload: AiProgressPayload): void {
  io?.emit('ai:progress', { ts: Date.now(), ...payload });
}

/** Emit when an MCP tool starts executing */
export function emitAiToolStart(conversationId: string | null, tool: string): void {
  io?.emit('ai:tool_start', { ts: Date.now(), conversationId, tool });
}

/** Emit when an MCP tool finishes executing */
export function emitAiToolDone(conversationId: string | null, tool: string): void {
  io?.emit('ai:tool_done', { ts: Date.now(), conversationId, tool });
}

export function getConnectedClients(): number {
  return io?.sockets.sockets.size ?? 0;
}
