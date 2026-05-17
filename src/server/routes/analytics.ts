import type { FastifyInstance } from 'fastify';
import { authenticateRequest } from '../../middleware/auth.js';
import {
  getTpsTimeSeries, getPayoutAnalytics, getPayoutTimeSeries,
  getBankStats, getFailureAnalysis, getOverviewMetrics,
  getCurrentTps,
} from '../../analytics/service.js';
import { getSocketIO, getConnectedClients } from '../../realtime/socket.js';
import { env } from '../../config/env.js';

// Optional OpenAI insight generation
async function generateInsight(metrics: Awaited<ReturnType<typeof getOverviewMetrics>>, banks: Awaited<ReturnType<typeof getBankStats>>): Promise<string> {
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

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
      model: env.OPENAI_MODEL ?? 'gpt-4-turbo-preview',
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

  /** GET /analytics/banks — bank/PSP health */
  fastify.get('/analytics/banks', async (_req, reply) => {
    const banks = await getBankStats();
    const healthy = banks.filter(b => b.status === 'up' || b.status === 'active').length;
    return reply.send({ banks, summary: { total: banks.length, healthy, degraded: banks.length - healthy } });
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
