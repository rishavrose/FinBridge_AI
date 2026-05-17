/**
 * Analytics BullMQ workers.
 *
 * Two repeatable jobs:
 *  1. metrics-tick  — every 15 s: compute overview metrics + emit via Socket.io
 *  2. alerts-tick   — every 30 s: evaluate alert rules + emit triggered alerts
 */

import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '../utils/logger.js';
import { getOverviewMetrics, getTpsTimeSeries, getBankStats, getPayoutAnalytics } from '../analytics/service.js';
import { evaluateAlerts } from '../alerts/engine.js';
import { emitMetrics, emitAlert } from '../realtime/socket.js';

const connection = { host: process.env['REDIS_HOST'] ?? 'localhost', port: Number(process.env['REDIS_PORT'] ?? 6379) };

const analyticsQueue = new Queue('analytics', {
  connection,
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 20 },
});

let metricsWorker: Worker | null = null;
let alertsWorker: Worker | null = null;

// ─── Job handlers ─────────────────────────────────────────────────────────────

async function handleMetricsTick(_job: Job) {
  const [overview, tps, banks, payouts] = await Promise.all([
    getOverviewMetrics(),
    getTpsTimeSeries(60),
    getBankStats(),
    getPayoutAnalytics(),
  ]);

  const payload = { overview, tps, banks, payouts };
  emitMetrics(payload);
  return payload;
}

async function handleAlertsTick(_job: Job) {
  const triggered = await evaluateAlerts();
  for (const alert of triggered) {
    emitAlert(alert);
  }
  return { triggered: triggered.length };
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

export async function startAnalyticsWorkers(): Promise<void> {
  // Register repeatable jobs (idempotent — won't duplicate if already scheduled)
  await analyticsQueue.add('metrics-tick', {}, { repeat: { every: 15_000 } });
  await analyticsQueue.add('alerts-tick', {}, { repeat: { every: 30_000 } });

  metricsWorker = new Worker(
    'analytics',
    async (job: Job) => {
      if (job.name === 'metrics-tick') return handleMetricsTick(job);
      if (job.name === 'alerts-tick')  return handleAlertsTick(job);
      return null;
    },
    { connection, concurrency: 2 },
  );

  metricsWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Analytics worker job failed');
  });

  logger.info('✅ Analytics workers started (metrics every 15s, alerts every 30s)');
}

export async function stopAnalyticsWorkers(): Promise<void> {
  await metricsWorker?.close();
  await alertsWorker?.close();
  await analyticsQueue.close();
}
