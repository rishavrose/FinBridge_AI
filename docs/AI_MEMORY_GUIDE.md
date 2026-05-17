# AI Memory + Semantic Cache + Self-Learning System

## Overview

This document describes the AI Memory layer added to FinBridge AI. It sits transparently **in front of** all OpenAI and MySQL calls and is **fully additive** — no existing routes, MCP tools, or database tables were modified.

---

## Architecture

```
User Prompt (POST /ai/chat/message)
         │
         ▼
 Prompt Normalization          src/ai/normalization/index.ts
         │  lowercase, remove stop-words, synonym mapping
         ▼
  SHA-256 Hash                 crypto.createHash('sha256')
         │
         ▼
 ┌───────────────────┐
 │  Redis Exact Cache │ ──── HIT ──► Return cached response  (<5 ms)
 └───────────────────┘
         │
        MISS
         │
         ▼
  Generate Embedding           src/ai/embeddings/index.ts
  text-embedding-3-small (1536-d)
         │
         ▼
 ┌──────────────────────┐
 │  Qdrant Vector Search │
 └──────────────────────┘
         │
         ├── score ≥ 0.95 ──► Direct response  (skip OpenAI)
         ├── score 0.85–0.95 ► Validated response + similarity note
         └── score < 0.85  ──► Cache MISS → OpenAI + MCP Tools
                                      │
                                      ▼
                              MySQL via MCP tools
                                      │
                                      ▼
                              OpenAI Response
                                      │
                                      ▼
                        BullMQ ai-learning Queue (async)
                                      │
                         ┌────────────┴────────────┐
                         │  Store in Qdrant         │
                         │  Store in MySQL          │
                         │  Warm Redis cache        │
                         └─────────────────────────┘
```

---

## New Files

| Path | Purpose |
|------|---------|
| `src/ai/normalization/index.ts` | Prompt normalisation, SHA-256 hashing, intent detection |
| `src/ai/embeddings/index.ts` | OpenAI `text-embedding-3-small` wrapper |
| `src/ai/cache/index.ts` | Redis exact-match cache CRUD |
| `src/ai/vector/client.ts` | Qdrant client singleton + collection bootstrap |
| `src/ai/vector/index.ts` | Qdrant upsert, search, delete, hit-count increment |
| `src/ai/memory/index.ts` | Central orchestrator — `queryMemory()` + `buildLearningPayload()` |
| `src/ai/analytics/index.ts` | Cache log writes to `ai_cache_logs` + in-memory counters |
| `src/ai/workers/index.ts` | BullMQ `ai-learning` queue + worker |
| `src/server/routes/ai-chat.ts` | New Fastify routes (see API section below) |

---

## Modified Files

| Path | What changed |
|------|-------------|
| `package.json` | Added `@qdrant/js-client-rest` dependency |
| `src/config/env.ts` | Added Qdrant + AI Memory environment variables |
| `src/server/index.ts` | Registered `aiChatRoutes`, started AI learning worker, bootstrapped Qdrant collection, added `closeAiWorkers()` to shutdown handler |
| `docker/docker-compose.yml` | Added `qdrant` service, `qdrant-data` volume, Qdrant env vars in app service |
| `docker/init.sql` | Added 5 new AI tables (append-only — no existing tables modified) |

---

## New API Endpoints

### `POST /ai/chat/message`

Memory-augmented AI chat. Checks Redis → Qdrant → OpenAI in order.

**Request body:**
```json
{
  "message": "Why did my payout fail?",
  "conversationId": "optional-uuid",
  "systemPrompt": "optional override"
}
```

**Response:**
```json
{
  "reply": "Your payout failed because...",
  "conversationId": "uuid",
  "messageId": "uuid",
  "cached": true,
  "cacheSource": "redis",
  "confidence": 1.0,
  "responseType": "direct",
  "responseMs": 4,
  "toolCallsExecuted": 0
}
```

| Field | Meaning |
|-------|---------|
| `cached` | `true` if Redis or Qdrant served the response |
| `cacheSource` | `redis` \| `qdrant` \| `openai` |
| `confidence` | Cosine similarity score (`1.0` for exact Redis hits) |
| `responseType` | `direct` (≥0.95), `validated` (0.85–0.95), or `miss` |
| `responseMs` | Total wall-clock time in milliseconds |

---

### `GET /ai/chat/stats`

Returns in-memory cache performance counters.

```json
{
  "totalRequests": 142,
  "redisHits": 98,
  "qdrantHits": 31,
  "openaiCalls": 13,
  "hitRate": 0.908,
  "avgResponseMs": 47
}
```

---

### `POST /ai/chat/feedback`

Submit positive/negative feedback on an AI response.

```json
{
  "messageId": "uuid",
  "rating": 5,
  "feedbackType": "positive",
  "comment": "Perfect answer!"
}
```

---

## New Database Tables

| Table | Purpose |
|-------|---------|
| `ai_knowledge` | Learned prompt/response pairs with hit counter |
| `ai_chat_history` | Full audit trail of every AI request |
| `ai_feedback` | User ratings (1–5) on AI responses |
| `ai_cache_logs` | Per-request cache source + latency logging |
| `ai_embeddings` | Links `ai_knowledge` rows to Qdrant point UUIDs |

---

## New Environment Variables

Add these to your `.env` file (all have safe defaults):

```dotenv
# Qdrant Vector DB
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                          # leave blank for local dev
QDRANT_COLLECTION=finbridge_ai_knowledge

# AI Memory / Semantic Cache
AI_MEMORY_ENABLED=true
AI_MEMORY_SIMILARITY_THRESHOLD=0.85      # minimum score for vector reuse
AI_MEMORY_DIRECT_THRESHOLD=0.95          # score above which response is served as-is
AI_MEMORY_CACHE_TTL=3600                 # Redis TTL in seconds (1 hour)
AI_EMBEDDING_MODEL=text-embedding-3-small
AI_EMBEDDING_DIMENSIONS=1536
```

---

## Confidence Tiers

| Score | Behaviour |
|-------|-----------|
| `≥ 0.95` | **Direct** — serve cached response exactly as stored |
| `0.85 – 0.95` | **Validated** — serve cached response with a similarity note prepended |
| `< 0.85` | **Miss** — fall through to OpenAI + MCP tools |

---

## Self-Learning Flow

Every OpenAI response automatically triggers an async BullMQ job (`ai-learning` queue):

1. Generate embedding for the normalised prompt  
2. Upsert vector point in Qdrant  
3. Insert row into `ai_knowledge` (MySQL)  
4. Insert row into `ai_embeddings` (MySQL)  
5. Write response to Redis exact cache  

The next identical or semantically similar question is served from cache with **zero OpenAI API calls**.

---

## Running Locally

```bash
# Start all services including Qdrant
docker compose -f docker/docker-compose.yml up -d

# Install new dependency
npm install

# Start dev server
npm run dev
```

Qdrant UI is accessible at **http://localhost:6333/dashboard** after startup.

---

## Performance Targets

| Scenario | Expected latency |
|----------|-----------------|
| Redis exact hit | < 5 ms |
| Qdrant vector hit | < 80 ms (includes embedding generation) |
| OpenAI + MCP miss | 1 000 – 5 000 ms (unchanged from before) |
| AI learning job | async, does not block response |
