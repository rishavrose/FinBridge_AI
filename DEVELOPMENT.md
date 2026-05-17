# Development Guide for FinBridge AI

> **Best practices, patterns, and workflows for building features on FinBridge AI**

---

## Table of Contents

1. [Code Standards](#code-standards)
2. [Project Structure](#project-structure)
3. [Adding Features](#adding-features)
4. [Working with Tools](#working-with-tools)
5. [Database Operations](#database-operations)
6. [Testing](#testing)
7. [Performance](#performance)
8. [Common Patterns](#common-patterns)
9. [Git Workflow](#git-workflow)

---

## Code Standards

### TypeScript

- **Always use strict mode**: `"strict": true` in `tsconfig.json`
- **Type every function parameter and return**:
  ```typescript
  // ✅ Good
  function getUserBalance(userId: string): Promise<number> {
    return db.query(userId);
  }

  // ❌ Bad
  function getUserBalance(userId) {
    return db.query(userId);
  }
  ```

- **Use interfaces for external data**:
  ```typescript
  interface ToolInput {
    limit: number;
    offset: number;
  }
  ```

- **Avoid `any`** — use `unknown` if you must:
  ```typescript
  // ✅ Better
  const handleData = (data: unknown) => {
    if (typeof data === 'string') {
      return data.toLowerCase();
    }
  };
  ```

### File Organization

```
src/
├── config/
│   └── env.ts              # Validated environment
├── types/
│   └── index.ts            # Shared TypeScript types
├── utils/
│   ├── logger.ts           # Structured logging
│   ├── errors.ts           # Error classes
│   └── helpers.ts          # Utility functions
├── database/
│   ├── client.ts           # MySQL connection pool
│   ├── query-builder.ts    # Safe query building
│   └── scanner.ts          # Schema introspection
├── cache/
│   ├── client.ts           # Redis client
│   └── manager.ts          # Cache operations
├── auth/
│   ├── jwt.ts              # JWT handling
│   ├── api-key.ts          # API key validation
│   └── rbac.ts             # Permission checking
├── mcp/
│   ├── server.ts           # MCP server instance
│   ├── registry.ts         # Tool registration
│   └── generator.ts        # Dynamic tool generation
├── tools/
│   ├── transactions.ts     # Specific tools
│   ├── payouts.ts
│   └── index.ts            # Tool exports
├── openai/
│   ├── client.ts           # OpenAI API client
│   └── converter.ts        # MCP → OpenAI conversion
├── ai/
│   ├── embeddings/         # Vector embeddings
│   ├── memory/             # Memory system
│   └── vector/             # Qdrant integration
├── server/
│   ├── routes/
│   │   ├── health.ts       # Health checks
│   │   ├── mcp.ts          # MCP endpoints
│   │   ├── tools.ts        # Tool REST API
│   │   ├── auth.ts         # Authentication
│   │   └── ai-chat.ts      # AI chat endpoints
│   └── index.ts            # Server bootstrap
└── middleware/
    ├── auth.ts             # Auth middleware
    └── permission.ts       # RBAC middleware
```

### Naming Conventions

```typescript
// Files: kebab-case
// query-builder.ts ✅
// queryBuilder.ts ❌

// Functions & variables: camelCase
// const getUserBalance = () => {} ✅
// const get_user_balance = () => {} ❌

// Types & Interfaces: PascalCase
// interface UserBalance {} ✅
// interface user_balance {} ❌

// Constants: SCREAMING_SNAKE_CASE
// const MAX_QUERY_LIMIT = 1000 ✅
// const maxQueryLimit = 1000 ❌

// Classes: PascalCase
// class AuthManager {} ✅
// class authManager {} ❌
```

---

## Project Structure

### Where Things Live

| Task | File | Notes |
|------|------|-------|
| Add REST route | `src/server/routes/*.ts` | Register in `index.ts` |
| Add MCP tool | `src/tools/*.ts` | Register in `tools/index.ts` |
| Database query | `src/database/query-builder.ts` | Use `executeSelect()` |
| Cache operation | `src/cache/manager.ts` | Use get/set/invalidate |
| Add permission | `src/auth/rbac.ts` | Define role → tool mapping |
| Add error type | `src/utils/errors.ts` | Extend base `AppError` |
| Logging | Use `src/utils/logger.ts` | Structured pino logger |
| Environment var | `src/config/env.ts` | Add to Zod schema |

---

## Adding Features

### Feature Checklist

Before starting a feature:

```
□ Create a feature branch: git checkout -b feature/my-feature
□ Write failing tests first (TDD)
□ Implement the feature
□ Run: npm run typecheck
□ Run: npm run lint
□ Run: npm run test
□ Get code review
□ Merge to main
```

### Example: Add New Tool

**Goal**: Create `get_recent_payouts` tool

#### 1. Define the tool

```typescript
// src/tools/payouts.ts
import { Tool, ToolInput } from '../types';

export interface GetRecentPayoutsInput extends ToolInput {
  status?: 'pending' | 'success' | 'failed';
  limit?: number;
  offset?: number;
}

export const getRecentPayouts: Tool<GetRecentPayoutsInput> = {
  name: 'get_recent_payouts',
  description: 'Fetch recent payouts with optional filters',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'success', 'failed'] },
      limit: { type: 'number', default: 50 },
      offset: { type: 'number', default: 0 }
    }
  },
  handler: async (args: GetRecentPayoutsInput) => {
    const { status, limit = 50, offset = 0 } = args;

    const query = `
      SELECT id, user_id, amount, status, created_at
      FROM payouts
      WHERE 1=1
        ${status ? 'AND status = ?' : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = status ? [status, limit, offset] : [limit, offset];
    const result = await executeSelect(query, params);

    return {
      payouts: result,
      count: result.length,
      hasMore: result.length === limit
    };
  }
};
```

#### 2. Register the tool

```typescript
// src/tools/index.ts
export { getRecentPayouts } from './payouts';

// In your tool registry:
import { getRecentPayouts } from './payouts';

export const STATIC_TOOLS = [
  getRecentPayouts,
  // ... other tools
];
```

#### 3. Set permissions

```typescript
// src/auth/rbac.ts
export const TOOL_PERMISSIONS: Record<string, Role[]> = {
  'get_recent_payouts': ['analyst', 'service', 'admin'], // analyst+ can call
  // ...
};
```

#### 4. Write tests

```typescript
// src/tools/__tests__/payouts.test.ts
import { getRecentPayouts } from '../payouts';

describe('getRecentPayouts', () => {
  it('filters by status', async () => {
    const result = await getRecentPayouts.handler({
      status: 'failed',
      limit: 10
    });
    expect(result.payouts).toBeDefined();
  });

  it('respects pagination', async () => {
    const result = await getRecentPayouts.handler({
      limit: 5,
      offset: 10
    });
    expect(result.payouts.length).toBeLessThanOrEqual(5);
  });
});
```

#### 5. Verify in API

```bash
npm run typecheck
npm run test
npm run dev

# Test via curl
curl -X POST http://localhost:3000/tools/get_recent_payouts/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"args": {"status": "failed", "limit": 10}}'
```

---

## Working with Tools

### Tool Interface

```typescript
interface Tool<T extends ToolInput = ToolInput> {
  name: string;                    // Unique tool name
  description: string;             // Human-readable description
  inputSchema: JSONSchema;         // JSON Schema for inputs
  handler: (args: T) => Promise<unknown>;
}
```

### Best Practices

#### ✅ Safe Queries

```typescript
// Use parameterized queries
const result = await executeSelect(
  'SELECT * FROM users WHERE id = ? AND role = ?',
  [userId, 'admin']
);
```

#### ❌ Never Do This

```typescript
// ❌ Raw SQL concatenation
const query = `SELECT * FROM users WHERE id = ${userId}`;
```

#### Validate Input

```typescript
// ✅ Use Zod or JSON Schema validation
const schema = z.object({
  userId: z.string().uuid(),
  limit: z.number().min(1).max(1000)
});

const args = schema.parse(input);
```

#### Handle Errors

```typescript
// ✅ Return meaningful errors
throw new ToolError(`User not found: ${userId}`, {
  code: 'USER_NOT_FOUND',
  statusCode: 404,
  userId
});
```

---

## Database Operations

### Query Builder

```typescript
import { executeSelect } from '../database/query-builder';

// Safe, parameterized SELECT
const users = await executeSelect(
  'SELECT id, name, email FROM users WHERE status = ? LIMIT ?',
  ['active', 100]
);
```

### Using Cache

```typescript
import { cacheManager } from '../cache/manager';

// Get from cache or fetch
const key = `user:${userId}:balance`;
let balance = await cacheManager.get(key);

if (!balance) {
  balance = await executeSelect(
    'SELECT balance FROM wallets WHERE user_id = ?',
    [userId]
  );
  await cacheManager.set(key, balance, 3600); // TTL: 1 hour
}
```

### Invalidating Cache

```typescript
// When data changes, invalidate cache
await cacheManager.invalidate([
  `user:${userId}:*`,  // Wildcard support
  `transactions:recent`
]);
```

---

## Testing

### Structure

```
src/
├── tools/
│   ├── transactions.ts
│   └── __tests__/
│       └── transactions.test.ts   # Co-located with source
```

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getRecentTransactions } from '../transactions';
import * as db from '../../database/client';

describe('getRecentTransactions', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('returns recent transactions', async () => {
    const result = await getRecentTransactions.handler({
      limit: 10
    });
    expect(result).toHaveProperty('transactions');
    expect(Array.isArray(result.transactions)).toBe(true);
  });

  it('filters by status', async () => {
    const result = await getRecentTransactions.handler({
      status: 'failed'
    });
    expect(result.transactions).toBeDefined();
  });

  it('respects limit parameter', async () => {
    const result = await getRecentTransactions.handler({
      limit: 5
    });
    expect(result.transactions.length).toBeLessThanOrEqual(5);
  });

  it('throws on invalid parameters', async () => {
    await expect(
      getRecentTransactions.handler({
        limit: -1 // Invalid
      })
    ).rejects.toThrow();
  });
});
```

### Run Tests

```bash
# Run all tests
npm run test

# Run specific file
npm run test -- transactions.test.ts

# Watch mode
npm run test -- --watch

# Coverage
npm run test -- --coverage
```

---

## Performance

### Monitor Performance

```bash
# Track query times
SLOW_QUERY_LOG=true npm run dev

# Monitor cache hit rate
curl http://localhost:3000/ai/chat/stats \
  -H "Authorization: Bearer $TOKEN"
```

### Optimize Queries

```typescript
// ✅ Efficient: Load only needed columns
SELECT id, name, amount FROM transactions WHERE status = ?

// ❌ Inefficient: Load everything
SELECT * FROM transactions WHERE status = ?
```

### Use Pagination

```typescript
// ✅ Paginate large results
SELECT * FROM logs LIMIT 100 OFFSET 0

// ❌ Never: No limit
SELECT * FROM logs
```

### Cache Strategic Data

```typescript
// ✅ Cache slowly-changing data
const bankHealth = await cacheManager.getOrSet(
  'bank:health',
  () => queryBankStatus(),
  3600  // 1 hour TTL
);
```

---

## Common Patterns

### Error Handling

```typescript
import { logger } from '../utils/logger';

try {
  const result = await executeSelect(query, params);
  return result;
} catch (error) {
  logger.error({ error, query }, 'Database query failed');
  throw new ToolError('Failed to fetch data', { original: error });
}
```

### Async Operations

```typescript
// ✅ Use async/await, not callbacks
const result = await cacheManager.get(key);

// ❌ Callbacks are error-prone
cacheManager.get(key, (err, result) => {
  if (err) throw err;
  return result;
});
```

### Logging

```typescript
import { logger } from '../utils/logger';

// Info
logger.info({ userId, action: 'login' }, 'User logged in');

// Error
logger.error({ error, code: 'DB_FAIL' }, 'Database error');

// Debug
logger.debug({ query, params }, 'Executing query');

// Audit (with audit flag)
logger.info(
  { audit: true, userId, tool: 'get_balance' },
  'Tool executed'
);
```

### Validation

```typescript
import { z } from 'zod';

const inputSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  amount: z.number().positive('Amount must be positive'),
  reason: z.string().optional()
});

const args = inputSchema.parse(input);
```

---

## Git Workflow

### Branch Strategy

```bash
# Feature
git checkout -b feature/add-settlement-tool

# Bugfix
git checkout -b bugfix/fix-jwt-expiry

# Documentation
git checkout -b docs/update-setup-guide

# Chore
git checkout -b chore/upgrade-dependencies
```

### Commit Messages

```
<type>: <description>

<body>
<footer>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

**Examples**:

```
feat: add semantic cache statistics endpoint

- Add /ai/chat/stats REST endpoint
- Return Redis + Qdrant hit rates
- Include average response time

Closes #123
```

```
fix: prevent SQL injection in query builder

- Add parameter validation
- Update test coverage
- Add integration tests

Fixes #456
```

### Pull Request Checklist

```
□ Branch name follows convention (feature/fix/docs)
□ Tests pass: npm run test
□ TypeScript passes: npm run typecheck
□ Code formatted: npm run lint
□ Tests added for new code
□ Documentation updated if needed
□ Commit messages are clear and descriptive
□ No console.log or debug code
□ No secrets in code (.env ignored)
```

---

## Debugging

### Enable Debug Logs

```bash
DEBUG=finbridge:* npm run dev
```

### VSCode Debugger

```bash
# Start with debugger
npm run dev:debug

# Open Chrome DevTools: chrome://inspect
# Click "Inspect" on the Node process
```

### Database Debugging

```bash
# View all queries
SLOW_QUERY_LOG=0 npm run dev

# Connect to MySQL directly
docker compose -f docker/docker-compose.yml exec mysql mysql -u root -p finbridge_db

# View Redis data
redis-cli
> KEYS *
> GET user:123:balance
```

### Check Logs

```bash
# View server logs
docker compose -f docker/docker-compose.yml logs -f app

# View MySQL logs
docker compose -f docker/docker-compose.yml logs -f mysql

# View Redis logs
docker compose -f docker/docker-compose.yml logs -f redis
```

---

## Tips

1. **Read existing code before writing new code** — understand patterns
2. **Write tests as you code** — TDD catches bugs early
3. **Keep commits small** — easier to review and revert if needed
4. **Review your own code first** — catch obvious issues before PR
5. **Ask Claude for help** — "Explain this function", "Review this code"
6. **Use type safety** — let TypeScript catch errors at compile time
7. **Monitor performance** — slow features are discovered late in production

---

## Resources

- **TypeScript Handbook**: https://www.typescriptlang.org/docs/
- **Fastify Guide**: https://www.fastify.io/docs/latest/
- **MCP Protocol**: https://github.com/modelcontextprotocol/specification
- **Redis Docs**: https://redis.io/docs/
- **MySQL**: https://dev.mysql.com/doc/

---

**Happy coding! 🚀**
