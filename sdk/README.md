# @finbridgeai/sdk

> **Connect Any Fintech Database to AI**

The official Node.js SDK for the [FinBridge AI](https://finbridgeai.com) platform — AI-native middleware that securely connects fintech systems, databases, analytics engines, and AI agents through the Model Context Protocol (MCP).

[![npm version](https://img.shields.io/npm/v/@finbridgeai/sdk)](https://www.npmjs.com/package/@finbridgeai/sdk)
[![CI](https://github.com/finbridgeai/sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/finbridgeai/sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org)

---

## Features

- **Full TypeScript support** — strict types for every request and response
- **ESM + CommonJS** — works in any Node.js project
- **Tree-shakable** — import only the modules you use
- **Retry with exponential backoff** — automatic recovery from transient failures
- **In-memory cache** — reduce redundant API calls
- **Realtime events** — WebSocket client with auto-reconnect and heartbeat
- **Middleware pipeline** — customise every request/response
- **Rate-limit aware** — honours `Retry-After` headers automatically
- **JWT + API key auth** — flexible authentication strategies
- **MCP tool access** — discover and invoke AI tools dynamically
- **AI assistant** — natural-language queries over your fintech data

---

## Installation

```bash
npm install @finbridgeai/sdk
# or
yarn add @finbridgeai/sdk
# or
pnpm add @finbridgeai/sdk
```

---

## Quick Start

```ts
import FinBridgeAI from '@finbridgeai/sdk';

const client = new FinBridgeAI({
  apiKey: 'fb_live_xxxxxxxxxxxx',
  baseUrl: 'https://api.rishavsingh.ai', // optional — this is the default
});
```

---

## Modules

### Payouts

```ts
// List failed payouts for a user
const { data: payouts } = await client.payouts.failed({ userId: 101 });

// Create a new payout
const { data: payout } = await client.payouts.create({
  userId: 101,
  amount: 5000,
  currency: 'INR',
  method: 'bank_transfer',
  accountDetails: { accountNumber: '...', ifsc: 'HDFC0001234' },
});

// Retry a failed payout
await client.payouts.retry({ payoutId: payout.id });
```

### Transactions

```ts
const { data: txns } = await client.transactions.list({
  userId: 101,
  status: 'failed',
  startDate: '2026-01-01',
  endDate: '2026-05-10',
});

// Reverse a transaction
await client.transactions.reverse(txns[0].id, 'Duplicate charge');
```

### AI Assistant

```ts
const { data } = await client.ai.ask({
  prompt: 'Why did payouts fail today?',
  tools: ['get_failed_payouts', 'get_bank_health'],
});

console.log(data.answer);
console.log(data.toolResults); // Results from MCP tools used

// Multi-turn chat
const { data: reply } = await client.ai.chat([
  { role: 'user', content: 'Show me settlement volume for last week' },
]);

// Streaming
for await (const chunk of client.ai.stream({ prompt: 'Explain payout failures' })) {
  process.stdout.write(chunk.delta);
}
```

### Analytics

```ts
const { data: summary } = await client.analytics.summary('2026-01-01', '2026-05-10');
console.log(summary.totalVolume, summary.successRate);

const { data: report } = await client.analytics.query({
  startDate: '2026-01-01',
  endDate: '2026-05-10',
  metrics: ['total_transactions', 'payout_success_rate'],
  groupBy: 'day',
});
```

### Settlements

```ts
const { data: settlements } = await client.settlements.list({
  merchantId: 'merch_001',
  status: 'pending',
});

// Download CSV report
const { data: { url } } = await client.settlements.exportCsv('2026-01-01', '2026-05-10');
```

### Users

```ts
const { data: user } = await client.users.create({
  email: 'alice@example.com',
  name: 'Alice Singh',
  role: 'merchant',
});

await client.users.suspend(user.id, 'Suspicious activity');
```

### MCP Tools

```ts
// List all available tools
const { data: tools } = await client.mcp.listTools();

// Call a specific tool
const { data: result } = await client.mcp.call({
  toolName: 'get_rrn_status',
  arguments: { rrn: '123456789012' },
});

// Batch call
const { data: results } = await client.mcp.batchCall([
  { toolName: 'get_failed_payouts', arguments: { userId: 101 } },
  { toolName: 'get_bank_health', arguments: {} },
]);
```

### Monitoring

```ts
const { data: health } = await client.monitoring.health();
console.log(health.status, health.services);

const { data: metrics } = await client.monitoring.metrics();
console.log(`Error rate: ${metrics.errorRate}%`);
```

---

## Realtime Events

```ts
// Subscribe to typed events
client.events.on('payout.failed', (payout) => {
  console.log(`Payout ${payout.id} failed: ${payout.failureReason}`);
});

client.events.on('transaction.completed', (txn) => {
  console.log(`Transaction ${txn.id} completed — ₹${txn.amount}`);
});

client.events.on('system.alert', (alert) => {
  console.warn(`[${alert.level}] ${alert.message}`);
});

// Connect the WebSocket
client.realtime.connect();

// Subscribe to a specific channel
client.realtime.subscribe('payouts:failed');

// Disconnect gracefully
client.realtime.disconnect();
```

---

## Authentication

```ts
// Login with credentials — SDK auto-attaches the returned JWT
const { data: tokens } = await client.auth.login({
  email: 'admin@rishavsingh.ai',
  password: 'super_secret',
});

// Refresh
await client.auth.refresh({ refreshToken: tokens.refreshToken! });

// API key management
const { data: keys } = await client.auth.listApiKeys();
await client.auth.rotateApiKey(keys[0].keyId);
```

---

## Advanced Configuration

```ts
const client = new FinBridgeAI({
  apiKey: 'fb_live_xxxx',
  baseUrl: 'https://api.rishavsingh.ai',
  timeout: 20_000,        // 20 s request timeout
  retries: 3,             // retry up to 3 times
  retryDelay: 500,        // base delay (exponential backoff)
  debug: true,            // verbose logging
  cache: {
    enabled: true,
    ttl: 30_000,          // 30 s TTL
    maxSize: 200,         // up to 200 cached entries
  },
  logger: {
    enabled: true,
    level: 'info',
    handler: (level, message, meta) => myLogger[level](message, meta),
  },
  defaultHeaders: {
    'X-App-Version': '2.0.0',
  },
});
```

### Custom Middleware

```ts
// Add a request middleware
client._http.middleware.useRequest(async (config) => {
  config.headers['X-Correlation-Id'] = crypto.randomUUID();
  return config;
});

// Add a response middleware
client._http.middleware.useResponse(async (response) => {
  myMetrics.increment('api.calls');
  return response;
});
```

---

## Error Handling

```ts
import {
  FinBridgeAI,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
} from '@finbridgeai/sdk';

try {
  await client.payouts.create({ /* ... */ });
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Validation failed:', err.fields);
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited — retry after ${err.retryAfter}s`);
  } else if (err instanceof AuthenticationError) {
    console.error('Invalid or expired credentials');
  } else if (err instanceof NotFoundError) {
    console.error('Resource not found');
  } else {
    throw err; // unexpected
  }
}
```

---

## Tree-Shaking

Import individual modules to keep your bundle lean:

```ts
import { PayoutsModule } from '@finbridgeai/sdk/payouts';
import { AnalyticsModule } from '@finbridgeai/sdk/analytics';
```

---

## Publishing to npm

```bash
# Authenticate
npm login

# Build and publish
npm publish --access public

# Or with a specific tag
npm publish --tag beta --access public
```

Semantic versioning is handled automatically via [semantic-release](https://semantic-release.gitbook.io/) when commits follow [Conventional Commits](https://www.conventionalcommits.org/).

---

## Development

```bash
# Install dependencies
npm install

# Build (ESM + CJS + types)
npm run build

# Type-check without emitting
npm run typecheck

# Watch mode
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

---

## Author

**Rishav Singh**
Senior Software Engineer

- 📧 [rishavsinghh1@gmail.com](mailto:rishavsinghh1@gmail.com)
- 🏗️ Built with ❤️ for the fintech + AI community

---

## License

MIT © [Rishav Singh](mailto:rishavsinghh1@gmail.com)
