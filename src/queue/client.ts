/**
 * BullMQ queue and worker setup.
 *
 * Queues:
 *  - tool-execution  : async MCP tool calls (non-latency-critical)
 *  - audit-events    : fire-and-forget audit log persistence
 */

import { Queue, Worker, QueueEvents } from 'bullmq';

import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// ─── Connection ───────────────────────────────────────────────────────────────

const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
};

// ─── Queues ───────────────────────────────────────────────────────────────────

export const toolExecutionQueue = new Queue('tool-execution', {
  connection,
  defaultJobOptions: {
    attempts: env.QUEUE_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: env.QUEUE_BACKOFF_MS,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

export const auditQueue = new Queue('audit-events', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

// ─── Queue events ─────────────────────────────────────────────────────────────

const toolQueueEvents = new QueueEvents('tool-execution', { connection });

toolQueueEvents.on('completed', ({ jobId }) => {
  logger.debug({ jobId }, 'Tool execution job completed');
});

toolQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, reason: failedReason }, 'Tool execution job failed');
});

// ─── Workers ──────────────────────────────────────────────────────────────────

export interface ToolJobData {
  toolName: string;
  args: Record<string, unknown>;
  callerId: string;
  callerRole: string;
  requestId: string;
}

export interface AuditJobData {
  action: string;
  actorId: string;
  resource: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

let _toolWorker: Worker | null = null;
let _auditWorker: Worker | null = null;

export function startWorkers(
  toolProcessor: (data: ToolJobData) => Promise<unknown>,
): void {
  _toolWorker = new Worker<ToolJobData>(
    'tool-execution',
    async (job) => {
      logger.debug({ jobId: job.id, tool: job.data.toolName }, 'Processing tool job');
      return toolProcessor(job.data);
    },
    {
      connection,
      concurrency: env.QUEUE_CONCURRENCY,
    },
  );

  _toolWorker.on('error', (err) => logger.error({ err }, 'Tool worker error'));

  _auditWorker = new Worker<AuditJobData>(
    'audit-events',
    async (job) => {
      // In production: write to audit DB table or external sink
      logger.info({ audit: true, ...job.data }, `ASYNC_AUDIT: ${job.data.action}`);
    },
    { connection, concurrency: 10 },
  );

  _auditWorker.on('error', (err) => logger.error({ err }, 'Audit worker error'));

  logger.info('BullMQ workers started');
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    _toolWorker?.close(),
    _auditWorker?.close(),
    toolExecutionQueue.close(),
    auditQueue.close(),
    toolQueueEvents.close(),
  ]);
  logger.info('BullMQ queues and workers closed');
}
