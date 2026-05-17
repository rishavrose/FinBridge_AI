# FinBridge MCP Server — Technical Guide

> How the system works, how MCP integrates, and how every request flows end-to-end.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Request Flow Diagrams](#2-request-flow-diagrams)
3. [MCP Protocol — How It Works Here](#3-mcp-protocol--how-it-works-here)
4. [Tool System](#4-tool-system)
5. [Authentication & Security](#5-authentication--security)
6. [Database Layer](#6-database-layer)
7. [Cache Layer](#7-cache-layer)
8. [OpenAI Integration](#8-openai-integration)
9. [API Reference](#9-api-reference)
10. [Common Workflows](#10-common-workflows)

---

## 1. System Overview

FinBridge MCP Server is a **middleware layer** that sits between AI clients (Claude, OpenAI, custom agents) and a MySQL database. It:

- Exposes database queries as structured **MCP tools**
- Authenticates every request via **JWT or API Key**
- Enforces **read-only access** to the database
- Caches results in **Redis** to reduce DB load
- Logs every tool call to an **audit trail**
- Supports two AI interaction modes: **MCP SSE** (for native MCP clients) and **REST `/ai/chat`** (for OpenAI)

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Clients                                │
│    Claude Desktop · Cursor · OpenAI · Custom Agents             │
└────────┬──────────────────────────────────┬────────────────────┘
         │ MCP SSE (native MCP protocol)    │ REST /ai/chat
         ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Fastify HTTP Server :3000                      │
│   Rate Limit (Redis) · CORS · Swagger /docs · Error Handler     │
├──────────────────────────────────────────────────────────────────┤
│  Auth Middleware (JWT/API Key)  │  RBAC Permission Guard        │
├──────────────────────────────────────────────────────────────────┤
│           MCP Tool Registry (central catalogue)                  │
│    Static Tools (6) + Dynamic Tools (1 per DB table)            │
├──────────────────────────────────────────────────────────────────┤
│  Query Builder (safe SQL)  │  Redis Cache  │  Audit Logger      │
├──────────────────────────────────────────────────────────────────┤
│              MySQL 8 (readonly pool, SSL in prod)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Request Flow Diagrams

### 2.1 MCP SSE Flow (Claude Desktop / native MCP clients)

```
Client                          Server                        MySQL / Redis
  │                               │                               │
  │── GET /mcp/sse ──────────────▶│                               │
  │   Authorization: Bearer <jwt> │                               │
  │                               │─ Auth middleware verifies JWT ─┤
  │                               │─ Creates new MCP Server inst. ─┤
  │                               │─ Creates SSEServerTransport   │
  │◀─ event: endpoint ────────────│                               │
  │   data: /mcp/messages         │                               │
  │         ?sessionId=<uuid>     │  (SSE stream stays open)      │
  │                               │                               │
  │── POST /mcp/messages ────────▶│                               │
  │   ?sessionId=<uuid>           │                               │
  │   {"method":"tools/list",...} │─ Rebuild req stream ──────────┤
  │                               │─ Route to session transport   │
  │◀─ 200 Accepted ───────────────│                               │
  │                               │                               │
  │◀─ event: message (via SSE) ───│                               │
  │   {"result":{"tools":[...]}}  │                               │
  │                               │                               │
  │── POST /mcp/messages ────────▶│                               │
  │   {"method":"tools/call",...} │                               │
  │   {"name":"get_bank_health"}  │─ RBAC check ──────────────────┤
  │                               │─ Cache check ─────────────────▶│
  │                               │  (cache miss)                 │
  │                               │─ executeSelect() ─────────────▶│
  │                               │◀─ rows ────────────────────────│
  │                               │─ cacheSet() ──────────────────▶│
  │◀─ event: message (via SSE) ───│                               │
  │   {"result":{"content":[...]}}│                               │
```

### 2.2 OpenAI `/ai/chat` Flow

```
Client                    Server                    OpenAI API           MySQL
  │                         │                           │                  │
  │── POST /ai/chat ────────▶│                           │                  │
  │   {"message":"..."}     │                           │                  │
  │                         │─ Auth check ──────────────┤                  │
  │                         │─ Get all tool definitions  │                  │
  │                         │── chat.completions.create ▶│                  │
  │                         │   (tools: [...12 tools])  │                  │
  │                         │◀─ {tool_calls:[...]} ──────│                  │
  │                         │                           │                  │
  │                         │─ toolRegistry.executeTool()──────────────────▶│
  │                         │◀─ result ─────────────────────────────────────│
  │                         │── tool results ────────────▶│                  │
  │                         │◀─ {finish:"stop","...text"}─│                  │
  │                         │                           │                  │
  │◀─ {"reply":"...","toolCallsExecuted":2} ────────────│                  │
```

### 2.3 Tool Execution Middleware Stack

Every tool call — whether via MCP or REST — passes through this exact stack:

```
toolRegistry.executeTool(name, args, ctx)
        │
        ├─ 1. Look up tool in registry (ToolNotFoundError if missing)
        │
        ├─ 2. RBAC: assertToolPermission(name, caller.role)
        │         (PermissionError if role too low)
        │
        ├─ 3. Audit: auditToolCall(ctx, name, args)
        │         (writes structured log with audit:true)
        │
        ├─ 4. Cache check (if tool has cacheTtl > 0)
        │         key = sha256(toolName + JSON(args))
        │         → cache HIT: return cached result, skip DB
        │
        ├─ 5. handler(args, ctx)
        │         → query builder builds parameterised SQL
        │         → executeSelect() runs query (SELECT only guard)
        │         → MySQL returns rows
        │
        ├─ 6. cacheSet(result, ttl)  (if cacheTtl > 0)
        │
        ├─ 7. Audit: auditToolSuccess(ctx, name, executionMs)
        │
        └─ return { data, cached, executionMs, rowCount }
```

---

## 3. MCP Protocol — How It Works Here

### What is MCP?

Model Context Protocol (MCP) is an open standard by Anthropic that defines how AI models communicate with external tools and data sources. It uses a JSON-RPC 2.0 message format over a transport layer.

### Transport: SSE (Server-Sent Events)

This server uses **SSE transport** — the only transport supported in server-hosted MCP deployments:

| Endpoint | Purpose |
|---|---|
| `GET /mcp/sse` | Client opens a persistent SSE stream. Server sends events back. |
| `POST /mcp/messages?sessionId=<id>` | Client sends JSON-RPC requests to the server |

The split design (GET for receiving, POST for sending) allows the server to push tool results back asynchronously while the client sends requests over separate HTTP POSTs.

### Per-Connection Server Instances

**Critical design decision:** The `@modelcontextprotocol/sdk` `Server` class only supports one active transport at a time. If the singleton is reused across connections, every new SSE connection crashes with:

```
Error: Already connected to a transport. Call close() before connecting to a new transport
```

**Solution:** `createMcpServer()` is called for every new SSE connection, producing an isolated `Server` instance with its own transport lifecycle. Tool handlers delegate to the shared `toolRegistry` singleton, so tool definitions remain consistent across all sessions.

```typescript
// src/mcp/server.ts
export async function handleSseConnection(_req, res, messagesEndpoint) {
  const transport = new SSEServerTransport(messagesEndpoint, res);
  const server = createMcpServer();  // ← fresh instance per connection
  sessions.set(transport.sessionId, transport);
  await server.connect(transport);
}
```

### Session Lifecycle

```
Client connects (GET /mcp/sse)
        │
        ▼
sessions.set(sessionId, transport)   ← stored in Map
        │
        ▼
SSE stream open — client receives events
        │
        ▼
Client sends messages (POST /mcp/messages?sessionId=X)
        │
        ▼
transport.handlePostMessage(req, res) ← routes to correct session
        │
        ▼
Client disconnects (or token expires)
        │
        ▼
res 'close' event → sessions.delete(sessionId)
```

Sessions are **in-memory** — they do not survive a server restart. Clients must reconnect after a restart.

### Body Stream Reconstruction

Fastify's body parser reads and parses the request body before any handler runs. The MCP SDK's `handlePostMessage()` expects a raw `IncomingMessage` readable stream. Since the stream is already consumed, we reconstruct it:

```typescript
// src/server/routes/mcp.ts
const bodyStr = JSON.stringify(request.body);
const fakeReq = Object.assign(
  Readable.from([Buffer.from(bodyStr)]),
  { headers: request.raw.headers, method: request.raw.method, url: request.raw.url },
) as unknown as IncomingMessage;

await handleSseMessage(fakeReq, reply.raw, sessionId);
```

### MCP Methods Supported

| JSON-RPC Method | Handler | Description |
|---|---|---|
| `tools/list` | `ListToolsRequestSchema` | Returns all registered tool definitions |
| `tools/call` | `CallToolRequestSchema` | Executes a named tool with given arguments |

---

## 4. Tool System

### 4.1 Static Tools (always registered)

Defined in `src/tools/` and registered at startup via `registerStaticTools()`:

| Tool | File | Min Role | Cache TTL | Description |
|---|---|---|---|---|
| `get_recent_transactions` | `transactions.ts` | `analyst` | 120s | Transactions with status/user/date/amount filters |
| `get_failed_payouts` | `payouts.ts` | `analyst` | 60s | Failed payouts for reconciliation |
| `get_user_balance` | `balance.ts` | `analyst` | 60s | Wallet balance — single or batch up to 50 users |
| `get_bank_health` | `bank-health.ts` | `readonly` | 120s | Bank/PSP uptime and success rate metrics |
| `search_rrn` | `rrn.ts` | `analyst` | 300s | Lookup transaction by Retrieval Reference Number |
| `get_settlement_report` | `settlement.ts` | `analyst` | 600s | Settlement batches with computed totals |

### 4.2 Dynamic Tools (auto-generated from DB schema)

At startup, `generateToolsFromSchema()` in `src/mcp/generator.ts`:

1. Runs `scanSchema()` → reads `information_schema.TABLES` and `information_schema.COLUMNS`
2. For each table, calls `tableToToolDefinition()` → builds a `McpToolDefinition`
3. Registers each as `query_{table_name}` with a generic parameterised handler

Example: if your DB has a `transactions` table, a `query_transactions` tool is auto-generated with filters for every column.

```
DB Table: transactions
    │
    ▼
Tool Name: query_transactions
    │
    ▼
Input Schema (auto-generated from column types):
  filters:
    id:           string
    rrn:          string
    user_id:      string
    amount:       number
    status:       string (enum from ENUM columns)
    created_at:   string (date-time)
    ...
  columns:   string[]   ← which columns to SELECT
  orderBy:   string     ← column name
  orderDir:  asc|desc
  limit:     integer    (max 1000)
  offset:    integer
```

### 4.3 Tool Definition Structure

```typescript
interface McpToolDefinition {
  name: string;                    // e.g. "get_bank_health"
  description: string;             // shown to AI model
  inputSchema: JSONSchema;         // Zod/JSON Schema for input validation
  permissions: Role[];             // minimum role required
  cacheTtl?: number;               // seconds; 0 = no cache
  tags?: string[];                 // grouping metadata
}
```

### 4.4 Safe Query Builder

`src/database/query-builder.ts` builds all SQL. No tool ever writes raw SQL:

```typescript
const { sql, params } = buildSelectQuery({
  table: 'transactions',
  conditions: [
    { column: 'status', operator: '=', value: 'failed' },
    { column: 'created_at', operator: '>=', value: '2025-01-01' },
  ],
  columns: ['id', 'amount', 'status', 'created_at'],
  orderBy: { column: 'created_at', direction: 'DESC' },
  limit: 50,
  offset: 0,
});
// sql = "SELECT `id`,`amount`,`status`,`created_at` FROM `transactions`
//        WHERE `status` = ? AND `created_at` >= ? ORDER BY `created_at` DESC LIMIT 50"
// params = ['failed', '2025-01-01']
```

Security guards in the query builder:
- Column/table identifiers validated against `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`
- Operator allowlist: `=`, `!=`, `<`, `<=`, `>`, `>=`, `LIKE`, `IN`, `IS NULL`, `IS NOT NULL`
- `LIKE` values auto-escape `%` and `_`
- `LIMIT` hard-capped at 1000

---

## 5. Authentication & Security

### 5.1 Auth Methods

**JWT (Bearer token)**
```
Authorization: Bearer <jwt>
```
- HS256 signed, configurable expiry (default 24h)
- Payload: `{ sub, role, name, iat, exp, iss }`
- Issued via `POST /auth/token` with `BOOTSTRAP_SECRET`

**API Key**
```
X-API-Key: <rawKey>
```
or
```
Authorization: ApiKey <rawKey>
```
- Raw key shown once at creation, then discarded
- Stored as `SHA-256(rawKey + API_KEY_SALT)` — never stored in plaintext
- Validated from in-memory store (Redis cache layer for performance)

### 5.2 RBAC — Role Hierarchy

```
readonly (1) < analyst (2) < service (3) < admin (4)
```

| Role | What they can do |
|---|---|
| `readonly` | `get_bank_health` and public info only |
| `analyst` | All 6 static fintech tools |
| `service` | All tools + schema operations |
| `admin` | Everything + API key management + tool refresh |

Every tool call checks:
```typescript
assertToolPermission(toolName, callerRole);
// throws PermissionError if callerRole level < tool's minimum role level
```

### 5.3 Rate Limiting

Redis-backed rate limiting via `@fastify/rate-limit`:
- Default: 100 requests per 60 seconds per IP
- Configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`

---

## 6. Database Layer

### 6.1 Connection Pool

```
MySQL 8 ── readonly user (SELECT grants only)
         ── connection pool (default: 10 connections)
         ── multipleStatements: false  (prevents stacked queries)
         ── SSL enforced in NODE_ENV=production
         ── UTC timezone
```

### 6.2 executeSelect Guard

All queries go through `executeSelect()` which:
1. Checks the SQL starts with `SELECT` or `SHOW` — rejects anything else
2. Uses `pool.execute()` with prepared statements (parameters never interpolated)

```typescript
// Allowed
await executeSelect('SELECT * FROM transactions WHERE id = ?', [id]);

// Blocked — throws immediately
await executeSelect('DROP TABLE transactions', []);
await executeSelect('INSERT INTO ...', []);
```

### 6.3 Schema Scanner

`src/database/scanner.ts` reads:
```sql
SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?

SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
```

Results are cached in Redis for `CACHE_TTL_SCHEMA` seconds (default: 1 hour).

---

## 7. Cache Layer

Redis cache via `ioredis` with a two-level strategy:

### 7.1 Tool Result Cache

Each tool definition has an optional `cacheTtl` (seconds). When set:
- Cache key = `sha256(toolName + JSON.stringify(args))`
- Stored at `finbridge:tool:<hash>`
- Hit rate logged per call

### 7.2 Cache Keys

```typescript
CacheKeys = {
  tool: (name, argsHash) => `tool:${name}:${argsHash}`,
  schema: (db)           => `schema:${db}`,
  apiKey: (hash)         => `apikey:${hash}`,
  balance: (userId)      => `balance:${userId}`,
}
```

### 7.3 Tag-Based Invalidation

```typescript
await invalidateByTag('transactions');  // deletes all keys tagged 'transactions'
```

---

## 8. OpenAI Integration

### 8.1 How `/ai/chat` Works

```
POST /ai/chat  {"message": "Show failed payouts from GTB bank"}
        │
        ▼
getAllOpenAiFunctions(callerRole)
  → converts all MCP McpToolDefinition[] to OpenAI function schemas
  → filters by caller's role
        │
        ▼
openai.chat.completions.create({
  model: "gpt-5-mini",
  messages: [systemPrompt, userMessage],
  tools: [...openAiFunctions],
  tool_choice: "auto",
  max_completion_tokens: 4096,
})
        │
        ▼
if finish_reason === "tool_calls":
  → execute each requested tool via toolRegistry.executeTool()
  → append results to messages
  → loop (max 5 rounds)
        │
        ▼
if finish_reason === "stop":
  → return { reply: string, toolCallsExecuted: number }
```

### 8.2 MCP Tool → OpenAI Function Conversion

```typescript
// MCP Tool Definition
{
  name: "get_bank_health",
  description: "Get bank/PSP health metrics",
  inputSchema: { type: "object", properties: { bankCode: { type: "string" } } }
}

// Converted to OpenAI Function
{
  name: "get_bank_health",
  description: "Get bank/PSP health metrics",
  parameters: {
    type: "object",
    properties: { bankCode: { type: "string" } },
    required: []
  }
}
```

---

## 9. API Reference

### Authentication Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/token` | None (bootstrap secret) | Issue a JWT token |
| POST | `/auth/api-keys` | Bearer (admin) | Create an API key |
| GET | `/auth/api-keys` | Bearer (admin) | List API keys |
| DELETE | `/auth/api-keys/:id` | Bearer (admin) | Revoke an API key |

### MCP Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/mcp/sse` | Bearer/ApiKey | Open MCP SSE stream (keep alive) |
| POST | `/mcp/messages?sessionId=<id>` | Bearer/ApiKey | Send JSON-RPC message to session |
| GET | `/mcp/sessions` | Bearer (admin) | List active SSE sessions |

### Tool Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/tools` | Bearer/ApiKey | List available tools for caller's role |
| POST | `/tools/:name/execute` | Bearer/ApiKey | Execute a tool via REST |
| POST | `/tools/refresh` | Bearer (admin) | Re-scan DB schema, regenerate dynamic tools |
| POST | `/ai/chat` | Bearer/ApiKey | Natural language query with OpenAI tool loop |

### Health Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/health/live` | None | Liveness — is the process up? |
| GET | `/health/ready` | None | Readiness — are MySQL and Redis connected? |
| GET | `/health/info` | None | Version and environment info |

---

## 10. Common Workflows

### 10.1 Get a JWT Token

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"your-id","role":"analyst","secret":"finbridge_dev_bootstrap"}'

# Response
{ "token": "eyJ...", "expiresIn": "24h" }
```

### 10.2 List Available Tools

```bash
curl http://localhost:3000/tools \
  -H "Authorization: Bearer <token>"
```

### 10.3 Execute a Tool via REST

```bash
curl -X POST http://localhost:3000/tools/get_bank_health/execute \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"args": {"limit": 10}}'
```

### 10.4 AI Chat (OpenAI — no SSE needed)

```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the health of all our payment banks?"}'
```

### 10.5 MCP SSE Session (Terminal)

```bash
# Terminal 1 — open and keep alive
TOKEN="<your_token>"
curl -N http://localhost:3000/mcp/sse -H "Authorization: Bearer $TOKEN"
# → event: endpoint
# → data: /mcp/messages?sessionId=<uuid>

# Terminal 2 — send request
curl -X POST "http://localhost:3000/mcp/messages?sessionId=<uuid>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# → "Accepted" (result appears in Terminal 1)
```

### 10.6 Connect Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "finbridge": {
      "url": "http://localhost:3000/mcp/sse",
      "headers": {
        "Authorization": "Bearer <your_token>"
      }
    }
  }
}
```

Restart Claude Desktop — all tools appear automatically in the tool panel.

### 10.7 Refresh Dynamic Tools (after DB schema changes)

```bash
curl -X POST http://localhost:3000/tools/refresh \
  -H "Authorization: Bearer <admin_token>"

# Response: { "message": "Tools refreshed", "generatedCount": 6 }
```

---

## Environment Variables Quick Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `DB_HOST` | — | MySQL hostname |
| `DB_USER` | — | Readonly MySQL user |
| `DB_PASSWORD` | — | MySQL password |
| `JWT_SECRET` | — | Min 32 chars — `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime |
| `API_KEY_SALT` | — | Min 16 chars |
| `BOOTSTRAP_SECRET` | — | Secret to issue demo JWT tokens |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `OPENAI_API_KEY` | — | Required only for `/ai/chat` |
| `OPENAI_MODEL` | `gpt-4-turbo-preview` | Model to use |
| `CACHE_TTL_SCHEMA` | `3600` | DB schema cache duration (seconds) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |
