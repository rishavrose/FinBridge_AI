/**
 * Socket.io manager — attaches to Fastify's HTTP server and emits
 * real-time events to connected dashboard clients.
 *
 * Security model: clients join a `user:{userId}` room derived from the JWT
 * in the handshake auth. Job-completion events are targeted to that room so
 * one user never sees another's AI responses.
 */

import { Server as SocketIO } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { logger } from '../utils/logger.js';

let io: SocketIO | null = null;

// ─── JWT helpers (inline — avoids a circular import with the full auth module) ─

function parseJwtPayload(token: string): { sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as { sub?: string };
  } catch {
    return null;
  }
}

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
    // Extract userId from JWT auth handshake and join a private room.
    // If no valid token is provided, the socket still connects (dashboard
    // clients that don't send a token still get broadcast events).
    const authToken = (socket.handshake.auth as { token?: string }).token;
    let userId: string | null = null;

    if (authToken) {
      const payload = parseJwtPayload(authToken);
      if (payload?.sub) {
        userId = payload.sub;
        socket.join(`user:${userId}`);
        logger.debug({ socketId: socket.id, userId }, 'Client joined user room');
      }
    }

    logger.info({ socketId: socket.id, userId }, 'WebSocket client connected');

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

    // Send initial connection ack with the resolved userId so the client
    // knows which room it joined (useful for debugging).
    socket.emit('connected', { ts: Date.now(), userId });
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

/** Emit AI processing progress to a specific user's room */
export function emitAiProgressToUser(userId: string, payload: AiProgressPayload): void {
  io?.to(`user:${userId}`).emit('ai:progress', { ts: Date.now(), ...payload });
}

/** Emit when an MCP tool starts executing */
export function emitAiToolStart(conversationId: string | null, tool: string): void {
  io?.emit('ai:tool_start', { ts: Date.now(), conversationId, tool });
}

/** Emit when an MCP tool starts — targeted to a specific user */
export function emitAiToolStartToUser(userId: string, conversationId: string | null, tool: string): void {
  io?.to(`user:${userId}`).emit('ai:tool_start', { ts: Date.now(), conversationId, tool });
}

/** Emit when an MCP tool finishes executing */
export function emitAiToolDone(conversationId: string | null, tool: string): void {
  io?.emit('ai:tool_done', { ts: Date.now(), conversationId, tool });
}

/** Emit when an MCP tool finishes — targeted to a specific user */
export function emitAiToolDoneToUser(userId: string, conversationId: string | null, tool: string): void {
  io?.to(`user:${userId}`).emit('ai:tool_done', { ts: Date.now(), conversationId, tool });
}

/** Emit when a background AI job completes — targeted to the job's owner */
export function emitJobComplete(userId: string, payload: {
  jobId: string;
  conversationId: string;
  messageId: string;
  reply: string;
}): void {
  io?.to(`user:${userId}`).emit('ai:job_complete', { ts: Date.now(), ...payload });
}

/** Emit when a background AI job fails */
export function emitJobFailed(userId: string, payload: {
  jobId: string;
  conversationId: string;
  error: string;
}): void {
  io?.to(`user:${userId}`).emit('ai:job_failed', { ts: Date.now(), ...payload });
}

/** Emit when a background AI job is cancelled */
export function emitJobCancelled(userId: string, payload: {
  jobId: string;
  conversationId: string;
}): void {
  io?.to(`user:${userId}`).emit('ai:job_cancelled', { ts: Date.now(), ...payload });
}

export function getConnectedClients(): number {
  return io?.sockets.sockets.size ?? 0;
}
