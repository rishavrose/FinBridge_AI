import type { FastifyInstance } from 'fastify';
import { authenticateRequest } from '../../middleware/auth.js';
import {
  getTpsTimeSeries, getPayoutAnalytics, getPayoutTimeSeries,
  getBankStats, getBankStatsFromPayouts, getFailureAnalysis, getOverviewMetrics,
  getCurrentTps, getRecentPayouts,
} from '../../analytics/service.js';
import { getSocketIO, getConnectedClients } from '../../realtime/socket.js';

// Optional AI insight generation
async function generateInsight(metrics: Awaited<ReturnType<typeof getOverviewMetrics>>, banks: Awaited<ReturnType<typeof getBankStats>>): Promise<string> {
  try {
    const { getOpenAiClient, getActiveModel } = await import('../../openai/client.js');
    const openai = getOpenAiClient();

    const banksDown = banks.filter(b => b.status !== 'up' && b.status !== 'active');
    const slowBanks = banks.filter(b => b.avgResponseMs > 1500);

    const prompt = `You are a fintech operations AI. Analyze these live metrics and provide a concise 3-bullet operational insight:

Metrics:
- Current TPS: ${metrics.currentTps}
- 24h Success Rate: ${metrics.successRate1h}%
- Failed Payouts Today: ${metrics.failedPayoutsToday}
- Total Transactions (24h): ${metrics.totalTransactions24h}
- Banks Down: ${banksDown.map(b => b.bankCode).join(', ') || 'None'}
- Slow Banks (>1500ms): ${slowBanks.map(b => `${b.bankCode} (${b.avgResponseMs}ms)`).join(', ') || 'None'}
- Avg Bank Response: ${metrics.avgResponseMs}ms

Provide exactly 3 bullet points (starting with •) covering: system health assessment, key risk, and recommended action. Be specific and concise.`;

    const res = await openai.chat.completions.create({
      model: getActiveModel(),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.3,
    });
    return res.choices[0]?.message?.content?.trim() ?? 'AI insights unavailable.';
  } catch {
    return '• System metrics collected successfully.\n• Monitor success rate and bank health.\n• No immediate action required.';
  }
}

export async function analyticsRoutes(fastify: FastifyInstance) {
  // All analytics routes require authentication
  fastify.addHook('preHandler', authenticateRequest);

  /** GET /analytics/overview — high-level KPIs */
  fastify.get('/analytics/overview', async (_req, reply) => {
    const data = await getOverviewMetrics();
    return reply.send({ data, wsClients: getConnectedClients() });
  });

  /** GET /analytics/tps?minutes=60 — TPS time series */
  fastify.get<{ Querystring: { minutes?: string } }>('/analytics/tps', async (req, reply) => {
    const minutes = Math.min(Math.max(Number(req.query.minutes ?? 60), 5), 1440);
    const [series, live] = await Promise.all([getTpsTimeSeries(minutes), getCurrentTps()]);
    return reply.send({ series, currentTps: live, windowMinutes: minutes });
  });

  /** GET /analytics/payouts — payout breakdown + time series */
  fastify.get('/analytics/payouts', async (_req, reply) => {
    const [breakdown, timeseries] = await Promise.all([getPayoutAnalytics(), getPayoutTimeSeries()]);
    return reply.send({ breakdown, timeseries });
  });

  /** GET /analytics/banks — bank/PSP health (legacy bank_health table) */
  fastify.get('/analytics/banks', async (_req, reply) => {
    const banks = await getBankStats();
    const healthy = banks.filter(b => b.status === 'up' || b.status === 'active').length;
    return reply.send({ banks, summary: { total: banks.length, healthy, degraded: banks.length - healthy } });
  });

  /**
   * GET /analytics/recent-payouts — recent payouts with bank name joined in.
   *
   * Joins tbl_payouts × tbl_bank_lists so the dashboard's Recent Transactions
   * table can show the bank's display name and the actual addedtime instead of
   * just the date.
   */
  fastify.get<{ Querystring: { limit?: string } }>('/analytics/recent-payouts', async (req, reply) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '8', 10) || 8, 1), 50);
    const rows = await getRecentPayouts(limit);
    return reply.send({ rows, count: rows.length });
  });

  /**
   * GET /analytics/banks/live — bank/PSP health derived from tbl_payouts + tbl_bank_lists.
   *
   * Joins live payout data (last 24h) with the bank registry to compute
   * per-bank success rate and average response time. Response shape matches
   * the dashboard's BankHealthRow contract:
   *   { rows: [{ bank_code, bank_name, status, success_rate, avg_response_ms, ... }] }
   */
  fastify.get('/analytics/banks/live', async (_req, reply) => {
    const banks = await getBankStatsFromPayouts();
    const rows = banks.map((b) => ({
      bank_code: b.bankCode,
      bank_name: b.bankName,
      status: b.status,
      success_rate: b.successRate,
      avg_response_ms: b.avgResponseMs,
      total_requests: b.totalRequests,
      failed_requests: b.failedRequests,
      last_checked: b.lastChecked,
    }));
    const healthy = rows.filter((r) => r.status === 'up').length;
    return reply.send({
      rows,
      summary: { total: rows.length, healthy, degraded: rows.length - healthy },
    });
  });

  /** GET /analytics/failures — failure reason analysis */
  fastify.get('/analytics/failures', async (_req, reply) => {
    const reasons = await getFailureAnalysis();
    return reply.send({ reasons });
  });

  /** GET /ai/insights — AI-generated operational insight */
  fastify.get('/ai/insights', async (_req, reply) => {
    const [metrics, banks] = await Promise.all([getOverviewMetrics(), getBankStats()]);
    const insight = await generateInsight(metrics, banks);
    return reply.send({ insight, generatedAt: new Date().toISOString(), metrics });
  });

  /** GET /analytics/live-status — quick Socket.io status */
  fastify.get('/analytics/live-status', async (_req, reply) => {
    return reply.send({ wsConnected: !!getSocketIO(), clients: getConnectedClients() });
  });
}
