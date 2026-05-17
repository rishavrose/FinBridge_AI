# FinBridge MCP Server

> **Production-grade Model Context Protocol (MCP) server platform** — a plug-and-play AI middleware that connects securely to MySQL databases and auto-generates MCP tools for AI assistants.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Clients                                │
│          (Claude Desktop · OpenAI · Custom Agents)              │
└──────────────────────┬──────────────────────────────────────────┘
                       │  MCP SSE / REST + JWT / API Key
┌──────────────────────▼──────────────────────────────────────────┐
│                   Fastify HTTP Server                            │
│     Rate Limit · CORS · Swagger Docs · Error Handler            │
├──────────────────────────────────────────────────────────────────┤
│  Auth Middleware    │  Permission RBAC  │  Audit Logger          │
├──────────────────────────────────────────────────────────────────┤
│                   MCP Server (SDK)                               │
│          Tool Registry · Tool Generator                          │
├──────────────────────────────────────────────────────────────────┤
│  Safe Query Builder │  Redis Cache      │  BullMQ Queue          │
├──────────────────────────────────────────────────────────────────┤
│        MySQL (readonly pool)  ←  Schema Scanner                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Feature Highlights

| Feature | Implementation |
|---|---|
| MCP Protocol | `@modelcontextprotocol/sdk` — SSE transport |
| HTTP Server | Fastify v4 with full plugin ecosystem |
| Database | MySQL 8 via `mysql2` — **readonly connection only** |
| ORM / Schema | Drizzle ORM + `information_schema` scanner |
| Cache | Redis via `ioredis` with TTL + tag invalidation |
| Async Queue | BullMQ (Redis-backed) with retry and back-off |
| Auth | Dual: JWT (HS256) + API Keys (SHA-256 hashed) |
| Permissions | RBAC — 4 roles: `readonly`, `analyst`, `service`, `admin` |
| Audit Trail | Structured pino logs with `audit: true` flag |
| AI Integration | OpenAI function calling with agentic tool loop |
| Validation | Zod for env + tool input; Fastify Ajv for routes |
| Security | No raw SQL, parameterised queries, SQL injection prevention |
| Observability | Structured JSON logs, health probes, OpenAPI docs |
| Containers | Docker multi-stage build, Docker Compose, Kubernetes HPA |

---

## Project Structure

```
finbridge-mcp/
├── src/
│   ├── config/
│   │   └── env.ts               # Zod-validated environment config
│   ├── types/
│   │   └── index.ts             # All shared TypeScript types
│   ├── utils/
│   │   ├── logger.ts            # Pino structured logger
│   │   ├── errors.ts            # Domain error hierarchy
│   │   └── helpers.ts           # Crypto, date, async helpers
│   ├── database/
│   │   ├── client.ts            # MySQL pool (readonly, SSL in prod)
│   │   ├── scanner.ts           # information_schema reader
│   │   └── query-builder.ts     # Safe parameterised SELECT builder
│   ├── cache/
│   │   ├── client.ts            # ioredis singleton
│   │   └── manager.ts           # get/set/invalidate with tags
│   ├── auth/
│   │   ├── jwt.ts               # Sign / verify JWT
│   │   ├── api-key.ts           # API key create / validate / revoke
│   │   └── rbac.ts              # Role-based permission matrix
│   ├── audit/
│   │   └── logger.ts            # Structured audit event emitter
│   ├── queue/
│   │   └── client.ts            # BullMQ queues + workers
│   ├── mcp/
│   │   ├── server.ts            # MCP Server instance + SSE transport
│   │   ├── registry.ts          # Tool registry with full middleware stack
│   │   └── generator.ts         # Dynamic tool generation from DB schema
│   ├── tools/                   # Static fintech domain tools
│   │   ├── transactions.ts      # get_recent_transactions
│   │   ├── payouts.ts           # get_failed_payouts
│   │   ├── balance.ts           # get_user_balance
│   │   ├── bank-health.ts       # get_bank_health
│   │   ├── rrn.ts               # search_rrn
│   │   ├── settlement.ts        # get_settlement_report
│   │   └── index.ts             # Registration bootstrap
│   ├── openai/
│   │   ├── client.ts            # OpenAI singleton
│   │   └── converter.ts         # MCP ↔ OpenAI function calling
│   ├── middleware/
│   │   ├── auth.ts              # JWT + API key Fastify middleware
│   │   └── permission.ts        # Role guard + tool permission hook
│   └── server/
│       ├── routes/
│       │   ├── health.ts        # /health/live, /health/ready, /health/info
│       │   ├── mcp.ts           # /mcp/sse, /mcp/messages, /mcp/sessions
│       │   ├── tools.ts         # /tools, /tools/:name/execute, /ai/chat
│       │   └── auth.ts          # /auth/token, /auth/api-keys
│       └── index.ts             # Fastify bootstrap + graceful shutdown
├── scripts/
│   ├── generate-tools.ts        # CLI: scan schema and print tool JSON
│   └── setup.sh                 # First-time setup script
├── docker/
│   ├── Dockerfile               # Multi-stage production build
│   ├── docker-compose.yml       # Dev stack (app + MySQL + Redis)
│   ├── init.sql                 # DB seed schema
│   └── .dockerignore
├── k8s/
│   ├── deployment.yaml          # K8s Deployment (3 replicas, non-root)
│   ├── service.yaml             # ClusterIP Service + ServiceAccount
│   ├── configmap.yaml           # ConfigMap + Secret template
│   └── ingress.yaml             # Nginx Ingress + HPA (2–10 pods)
├── .env.example                 # All environment variables documented
├── package.json
├── tsconfig.json
└── drizzle.config.ts
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- MySQL 8.0 (readonly user configured)
- Redis 7

### 1. Install & configure

```bash
# Clone and install
npm install

# Auto-setup (generates secrets, creates .env)
bash scripts/setup.sh
```

Edit `.env` with your database credentials:

```env
DB_HOST=localhost
DB_NAME=your_database
DB_USER=your_readonly_user
DB_PASSWORD=your_password
```

### 2. Start with Docker (recommended)

```bash
# Start MySQL + Redis + App
npm run docker:up

# View logs
docker compose -f docker/docker-compose.yml logs -f app
```

### 3. Start in development mode

```bash
# Start MySQL and Redis only
docker compose -f docker/docker-compose.yml up -d mysql redis

# Run server with hot reload
npm run dev
```

### 4. Verify

```
http://localhost:3000/health/ready   → dependency health check
http://localhost:3000/docs           → Swagger API docs
http://localhost:3000/mcp/sse        → MCP SSE endpoint
```

---

## Database Flow

```
User provides DB credentials
        │
        ▼
  pingDatabase() validates connection
        │
        ▼
  scanSchema() reads information_schema
        │
        ▼
  generateToolsFromSchema() creates:
    ┌──────────────────────────────────┐
    │  query_transactions              │
    │  query_wallets                   │
    │  query_payouts                   │
    │  query_settlements               │
    │  query_{every_other_table}       │
    └──────────────────────────────────┘
        │
        ▼
  Tools exposed via MCP SSE & REST API
        │
        ▼
  AI system calls tools → safe parameterised SQL → cached result
```

---

## MCP Tools

### Static Fintech Tools

| Tool | Description | Min Role |
|---|---|---|
| `get_recent_transactions` | Transactions with status/user/date/amount filters | `analyst` |
| `get_failed_payouts` | Failed payouts for reconciliation | `analyst` |
| `get_user_balance` | Wallet balances — single or batch (up to 50) | `analyst` |
| `get_bank_health` | Bank/PSP uptime metrics and status | `readonly` |
| `search_rrn` | Transaction lookup by Retrieval Reference Number | `analyst` |
| `get_settlement_report` | Settlement batches with summary totals | `analyst` |

### Dynamic Tools

At startup, the schema scanner reads every table in your database and generates a `query_{table_name}` tool for each one. Each generated tool supports:

- Column-level filters (value equality)
- Column selection
- ORDER BY with direction
- LIMIT / OFFSET pagination
- Full cache TTL management

---

## Authentication

### JWT (Bearer token)'
## '{"userId":"dev-user","role":"admin","name":"Dev Admin","secret":"dev_bootstrap"}' | jq .

```bash
# Get a token (demo endpoint — replace with real auth in production)
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","role":"analyst","secret":"dev_bootstrap"}'

# Use the token
curl http://localhost:3000/tools \
  -H "Authorization: Bearer <token>"
```

### API Keys

```bash
# Create an API key (admin only)
curl -X POST http://localhost:3000/auth/api-keys \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-service","role":"analyst","expiresInDays":90}'

# Use the API key
curl http://localhost:3000/tools \
  -H "X-API-Key: <rawKey>"
```

---

## Role Permissions

| Role | Level | Capabilities |
|---|---|---|
| `readonly` | 1 | View bank health and public info |
| `analyst` | 2 | Execute all fintech tools |
| `service` | 3 | Execute tools + schema operations |
| `admin` | 4 | Full access + API key management + tool refresh |

---

## Execute a Tool via REST

```bash
curl -X POST http://localhost:3000/tools/get_recent_transactions/execute \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "args": {
      "status": "failed",
      "dateFrom": "2024-01-01T00:00:00Z",
      "limit": 20
    }
  }'
```

---

## AI Chat (OpenAI Function Calling)

```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Show me all failed payouts from GTB bank in the last 7 days and their total amount"
  }'
```

The server automatically:
1. Converts MCP tools → OpenAI function definitions
2. Sends your message to GPT-4
3. Executes any requested tool calls
4. Returns the final natural-language answer

---

## Connect Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "finbridge": {
      "url": "http://localhost:3000/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN"
      }
    }
  }
}
```

---

## Security Architecture

| Threat | Mitigation |
|---|---|
| SQL Injection | Parameterised queries only — `mysql2` prepared statements |
| Raw SQL execution | `executeSelect()` rejects any non-SELECT statement |
| Write operations | MySQL user has `SELECT` grants only |
| Auth bypass | JWT signature + API key SHA-256 hash verification |
| Privilege escalation | RBAC level check on every tool call |
| Data dumps | `LIMIT` always enforced (max 1000 rows) |
| Enumeration | Table/column names validated against safe identifier regex |
| Brute force | Redis-backed rate limiting per IP |
| Secrets exposure | `.env` excluded from git; K8s Secrets for production |
| Audit evasion | Every tool call, auth event, and scan is logged |

---

## Environment Variables

See [.env.example](.env.example) for the full annotated list.

Key variables:

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | ✅ | MySQL host |
| `DB_USER` | ✅ | **Readonly** MySQL user |
| `DB_PASSWORD` | ✅ | MySQL password |
| `JWT_SECRET` | ✅ | Min 32 chars — `openssl rand -hex 32` |
| `API_KEY_SALT` | ✅ | Min 16 chars |
| `REDIS_HOST` | ✅ | Redis host |
| `OPENAI_API_KEY` | ❌ | Only needed for `/ai/chat` |

---

## Production Deployment

### Docker

```bash
# Build production image
npm run docker:build

# Run production stack
npm run docker:prod
```

### Kubernetes

```bash
# Create namespace
kubectl create namespace finbridge

# Update secrets in k8s/configmap.yaml with real base64 values
# Apply all manifests
kubectl apply -f k8s/

# Verify deployment
kubectl get pods -n finbridge
kubectl logs -f deployment/finbridge-mcp -n finbridge
```

### Generate Tool Catalog

```bash
# Print all generated tools to stdout
npm run generate-tools

# Save to file
npm run generate-tools -- --output tools.json
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript 5 |
| HTTP Server | Fastify 4 |
| MCP Protocol | `@modelcontextprotocol/sdk` |
| Database | MySQL 8 via `mysql2` |
| ORM | Drizzle ORM |
| Cache | Redis via `ioredis` |
| Queue | BullMQ |
| Auth | `jsonwebtoken` + SHA-256 API keys |
| Validation | Zod + Fastify Ajv |
| AI | OpenAI API |
| Logging | Pino |
| Containers | Docker + Kubernetes |
