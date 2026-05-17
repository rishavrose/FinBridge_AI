/**
 * FinBridge AI SDK — Basic Usage Examples
 * Run: npx ts-node examples/basic.ts
 */
import FinBridgeAI from '../src/index.js';

const client = new FinBridgeAI({
  apiKey: process.env['FINBRIDGE_API_KEY'] ?? 'fb_test_xxxxxxxxxxxxxxxx',
  baseUrl: process.env['FINBRIDGE_BASE_URL'] ?? 'https://api.finbridgeai.com',
  debug: true,
  retries: 2,
  cache: { enabled: true, ttl: 30_000 },
});

// ─── Payouts ─────────────────────────────────────────────────────────────────

async function payoutsExample(): Promise<void> {
  console.log('\n=== Payouts ===');

  const { data: failedPayouts } = await client.payouts.failed({ userId: 101 });
  console.log('Failed payouts:', failedPayouts.length);

  if (failedPayouts[0]) {
    const { data: retried } = await client.payouts.retry({
      payoutId: failedPayouts[0].id,
      reason: 'Manual retry via SDK',
    });
    console.log('Retried payout status:', retried.status);
  }
}

// ─── Transactions ─────────────────────────────────────────────────────────────

async function transactionsExample(): Promise<void> {
  console.log('\n=== Transactions ===');

  const { data: txns } = await client.transactions.list({
    status: 'completed',
    startDate: '2026-01-01',
    endDate: '2026-05-10',
    limit: 10,
  });

  console.log('Transactions fetched:', txns.length);
}

// ─── AI ───────────────────────────────────────────────────────────────────────

async function aiExample(): Promise<void> {
  console.log('\n=== AI ===');

  const { data } = await client.ai.ask({
    prompt: 'Why did payouts fail today? Summarise the top 3 reasons.',
    tools: ['get_failed_payouts', 'get_bank_health'],
  });

  console.log('AI Answer:', data.answer);
  console.log('Tokens used:', data.usage.totalTokens);
}

// ─── Analytics ────────────────────────────────────────────────────────────────

async function analyticsExample(): Promise<void> {
  console.log('\n=== Analytics ===');

  const { data: summary } = await client.analytics.summary('2026-01-01', '2026-05-10');
  console.log('Total volume:', summary.totalVolume, summary.currency);
  console.log('Success rate:', summary.successRate, '%');
}

// ─── MCP Tools ────────────────────────────────────────────────────────────────

async function mcpExample(): Promise<void> {
  console.log('\n=== MCP Tools ===');

  const { data: tools } = await client.mcp.listTools();
  console.log('Available tools:', tools.map((t) => t.name).join(', '));

  if (tools[0]) {
    const { data: result } = await client.mcp.call({
      toolName: tools[0].name,
      arguments: {},
    });
    console.log(`Tool "${tools[0].name}" result:`, result.result);
  }
}

// ─── Realtime Events ─────────────────────────────────────────────────────────

function realtimeExample(): void {
  console.log('\n=== Realtime ===');

  client.events.on('payout.failed', (payout) => {
    console.log(`[EVENT] Payout failed: ${payout.id} — ${payout.failureReason ?? 'unknown'}`);
  });

  client.events.on('transaction.completed', (txn) => {
    console.log(`[EVENT] Transaction completed: ${txn.id} — ₹${txn.amount}`);
  });

  client.events.on('system.alert', (alert) => {
    console.warn(`[ALERT][${alert.level}] ${alert.message}`);
  });

  client.events.on('connected', ({ connectionId }) => {
    console.log(`[WS] Connected — ID: ${connectionId}`);
  });

  // Connect (comment out in test environments without a live server)
  // client.realtime.connect();
  // client.realtime.subscribe('payouts:merchant_001');
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await payoutsExample();
    await transactionsExample();
    await analyticsExample();
    await mcpExample();
    await aiExample();
    realtimeExample();
  } catch (err) {
    console.error('Example error:', err);
    process.exit(1);
  }
}

void main();
