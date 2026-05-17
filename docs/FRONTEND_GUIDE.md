# FinBridge AI — Frontend Guide

> How the React dashboard works, how it connects to the MCP server, and every design decision explained.

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Project Structure](#2-project-structure)
3. [How to Run](#3-how-to-run)
4. [Tech Stack & Choices](#4-tech-stack--choices)
5. [Authentication Flow](#5-authentication-flow)
6. [The Four Pages](#6-the-four-pages)
7. [MCP SSE Connection — Deep Dive](#7-mcp-sse-connection--deep-dive)
8. [API Client Layer](#8-api-client-layer)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [Component Hierarchy](#10-component-hierarchy)

---

## 1. Overview & Purpose

The frontend is a **React + TypeScript single-page application** that acts as a visual interface for the FinBridge MCP Server. It has four distinct sections:

| Page | URL-equivalent | What it does |
|---|---|---|
| **Dashboard** | `/dashboard` | Live bank health, transactions, failed payouts via MCP tools |
| **AI Chat** | `/chat` | Natural language queries → OpenAI calls MCP tools automatically |
| **Tool Runner** | `/tools` | Browse all registered MCP tools, execute with custom args |
| **MCP Console** | `/mcp` | Raw MCP SSE protocol — connect, send JSON-RPC, watch events |

The frontend **never touches the database directly**. Everything goes through the MCP server's REST and SSE APIs.

---

## 2. Project Structure

```
frontend/
├── index.html                  ← Vite entry point
├── package.json
├── vite.config.ts              ← Proxy config (dev server → backend :3000)
├── tailwind.config.js
├── tsconfig.json
└── src/
    ├── main.tsx                ← React root mount
    ├── App.tsx                 ← Auth gate + page router (state-based)
    ├── index.css               ← Tailwind directives + scrollbar styles
    │
    ├── types/
    │   └── index.ts            ← Shared TypeScript interfaces
    │
    ├── api/
    │   └── client.ts           ← All fetch calls + openMcpSse() helper
    │
    ├── hooks/
    │   ├── useAuth.ts          ← JWT login/logout, localStorage persistence
    │   └── useMcpSse.ts        ← SSE connection lifecycle + message sending
    │
    └── components/
        ├── Login.tsx           ← Login form (bootstrap secret → JWT)
        ├── Layout.tsx          ← Sidebar navigation + user info
        └── pages/
            ├── DashboardPage.tsx   ← Bank health + transactions overview
            ├── ChatPage.tsx        ← AI chat interface
            ├── ToolsPage.tsx       ← MCP tool browser + executor
            └── McpPage.tsx         ← Raw SSE protocol console
```

---

## 3. How to Run

### Prerequisites

- Node.js 20+
- The FinBridge backend running on `http://localhost:3000` (see root README)

### Start Frontend Dev Server

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Build for Production

```bash
cd frontend
npm run build
# Output in frontend/dist/
```

Serve `dist/` from the backend by adding a static file handler, or deploy to any CDN (Vercel, Netlify, etc.) and point `VITE_API_BASE` to your backend URL.

### Environment (optional)

If your backend is not on `localhost:3000`, edit `frontend/vite.config.ts`:

```typescript
proxy: {
  '/auth':   'http://your-backend-host:3000',
  '/mcp':    'http://your-backend-host:3000',
  '/tools':  'http://your-backend-host:3000',
  '/ai':     'http://your-backend-host:3000',
  '/health': 'http://your-backend-host:3000',
},
```

---

## 4. Tech Stack & Choices

| Technology | Version | Why |
|---|---|---|
| **React 18** | 18.3 | Concurrent rendering, hooks, stable ecosystem |
| **TypeScript** | 5.5 | Type-safe API contracts match backend types |
| **Vite** | 5.4 | Fast HMR, zero-config, dev proxy for CORS |
| **Tailwind CSS** | 3.4 | Utility-first, no runtime overhead, dark theme |
| **lucide-react** | 0.438 | Consistent icon set, tree-shakeable |
| **No Redux / Zustand** | — | State is local to pages; no global state needed |
| **No React Router** | — | Single-page with tab navigation; router adds complexity for no benefit |
| **No axios** | — | Native `fetch()` is sufficient; avoids extra bundle weight |

---

## 5. Authentication Flow

```
User enters userId, role, bootstrap secret
          │
          ▼
POST /auth/token  {"userId","role","secret"}
          │
    ┌─────┴─────┐
    │ success   │ error
    ▼           ▼
JWT token    Error shown in Login form
stored in
localStorage
          │
          ▼
useAuth() hook reads token on every page load
  → parses JWT payload (atob, no library)
  → checks exp claim — removes if expired
  → sets token + claims in React state
          │
          ▼
App.tsx: if token → show Layout + pages
         if not   → show Login
```

### Why localStorage?

- Tokens survive page refresh without re-login
- `exp` claim is checked on every load — expired tokens are auto-removed
- For production, consider `httpOnly` cookies (requires backend change)

### Token in API calls

Every `apiFetch()` call in `src/api/client.ts` automatically adds:
```
Authorization: Bearer <token>
```

The SSE connection (`openMcpSse`) also sends the `Authorization` header via `fetch()` — this is **not possible** with the browser's native `EventSource` API (which is why we use `fetch` instead).

---

## 6. The Four Pages

### 6.1 Dashboard Page

**File:** `src/components/pages/DashboardPage.tsx`

On mount, fires four parallel tool calls via `Promise.allSettled()`:

```typescript
Promise.allSettled([
  fetchHealth(token),                                          // GET /health/ready
  executeTool('get_bank_health', { limit: 10 }, token),       // POST /tools/get_bank_health/execute
  executeTool('get_recent_transactions', { limit: 8 }, token),
  executeTool('get_failed_payouts', { limit: 5 }, token),
])
```

`Promise.allSettled` is used deliberately — if one tool fails (e.g., no data yet), the others still render. Each `fulfilled` result updates its own piece of state.

Results render as:
- 4 stat cards (API status, DB, Redis, uptime)
- Bank health table with color-coded success rates
- Recent transactions table with status badges
- Empty state with guidance if no DB rows exist yet

### 6.2 AI Chat Page

**File:** `src/components/pages/ChatPage.tsx`

The simplest integration: `POST /ai/chat` with the user's message. The OpenAI agentic loop runs entirely server-side.

```
User types message
      │
      ▼
aiChat(message, token) → POST /ai/chat
      │
      ▼
Server: OpenAI decides which MCP tools to call
        → executes tools → sends results to OpenAI
        → OpenAI synthesizes final text reply
      │
      ▼
Frontend receives { reply, toolCallsExecuted, toolsUsed }
      │
      ▼
Renders reply bubble + tool call badges
```

The frontend does **not** manage the tool loop — that all happens in `src/openai/converter.ts` on the backend. The chat UI is intentionally dumb: send message, show reply.

**Suggestions:** Pre-filled prompt buttons help users discover what the system can do.

### 6.3 Tool Runner Page

**File:** `src/components/pages/ToolsPage.tsx`

Loads all tools via `GET /tools` then lets you:
1. Browse and search tools in the left panel
2. Select a tool to see its full schema
3. Fill in parameters via auto-generated form inputs
4. Execute and see the JSON response with timing + cache status

**Dynamic form generation:** For each property in `inputSchema.properties`:
- `enum` → `<select>` dropdown
- `number`/`integer` → `<input type="number">`
- Everything else → `<input type="text">`

Types are cast back before execution:
```typescript
if (prop?.type === 'number' || prop?.type === 'integer') {
  typedArgs[k] = Number(v);
}
```

### 6.4 MCP Console Page

**File:** `src/components/pages/McpPage.tsx`

This page exposes the **raw MCP protocol** so you can see exactly what's happening:

1. **Connect** button → calls `useMcpSse(token).connect()`
2. Displays every raw SSE event in a scrollable log (pretty-printed JSON)
3. **Quick Actions** send pre-built JSON-RPC requests (`tools/list`, specific tool calls)
4. **Custom JSON-RPC** lets you type any method + params and send

This is the most educational page — it shows the exact protocol that Claude Desktop uses when it connects to an MCP server.

---

## 7. MCP SSE Connection — Deep Dive

### The Problem with EventSource

The browser's native `EventSource` API cannot send custom request headers. It only supports a URL:

```javascript
// This is all EventSource supports — no auth header possible
new EventSource('/mcp/sse')
```

This means you cannot use `EventSource` with a Bearer token auth system.

### The Solution: fetch() with ReadableStream

The frontend uses `fetch()` which supports full request headers, then reads the response body as a stream:

```typescript
// src/api/client.ts — openMcpSse()
const response = await fetch('/mcp/sse', {
  headers: { Authorization: `Bearer ${token}` },
  signal: controller.signal,   // ← AbortController for clean disconnect
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  // SSE is newline-delimited text
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';   // keep incomplete last line in buffer
  
  for (const line of lines) {
    if (line.startsWith('event:')) { currentEvent = line.slice(6).trim(); }
    else if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      // Extract sessionId from endpoint event
      if (currentEvent === 'endpoint') {
        const match = data.match(/sessionId=([^&\s]+)/);
        if (match) onSessionId(match[1]);
      }
      onEvent(currentEvent, data);
    }
  }
}
```

### SSE Text Format (what the server sends)

```
event: endpoint\n
data: /mcp/messages?sessionId=a7f3c2d1-...\n
\n
event: message\n
data: {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}\n
\n
```

Each event block ends with a blank line (`\n\n`). The `buffer` pattern ensures partial chunks across multiple `read()` calls are accumulated correctly.

### Session Map (in useMcpSse hook)

```
useMcpSse(token)
    │
    ├── status: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'
    ├── sessionId: string | null          ← set when 'endpoint' event arrives
    ├── events: McpEvent[]                ← all received events
    │
    ├── connect()  → calls openMcpSse(), sets AbortController ref
    ├── disconnect() → abortRef.current.abort()
    └── sendRequest(method, params)
            │
            └── POST /mcp/messages?sessionId=<id>
                    body: { jsonrpc: '2.0', id: autoIncrement, method, params }
```

### Why AbortController?

`AbortController.abort()` cancels the `fetch()` request, which causes `reader.read()` to reject, which exits the `while(true)` loop cleanly. This prevents memory leaks when the component unmounts or the user clicks Disconnect.

---

## 8. API Client Layer

**File:** `src/api/client.ts`

All API calls go through a single `apiFetch<T>()` helper that:
- Adds `Content-Type: application/json`
- Adds `Authorization: Bearer <token>` if provided
- Throws a descriptive `Error` on non-OK status (extracts server error message if JSON)

### Available functions

```typescript
// Auth
issueToken(userId, role, secret)           → POST /auth/token

// Health
fetchHealth(token)                         → GET /health/ready

// Tools
fetchTools(token)                          → GET /tools
executeTool(name, args, token)             → POST /tools/:name/execute

// AI
aiChat(message, token)                     → POST /ai/chat

// MCP SSE
openMcpSse(token, onEvent, onSessionId, onError)  → GET /mcp/sse (streaming)
sendMcpMessage(sessionId, request, token)          → POST /mcp/messages
```

---

## 9. Data Flow Diagrams

### Login Flow

```
Login component
  └── onLogin(userId, role, secret)
        │
        └── useAuth.login()
              │
              └── issueToken() → POST /auth/token
                    │
                    ├── success → parseJwt() → localStorage.set() → setToken()
                    └── error   → setError() → shown in Login form
```

### Dashboard Data Flow

```
DashboardPage mounts
  └── useEffect → load()
        │
        ├── fetchHealth()         → GET /health/ready
        ├── executeTool('get_bank_health')
        │       └── POST /tools/get_bank_health/execute
        │             └── MCP server → executeSelect() → MySQL
        ├── executeTool('get_recent_transactions')
        └── executeTool('get_failed_payouts')
              │
              ▼
        Promise.allSettled resolves
              │
              ▼
        setState → React re-renders tables/cards
```

### MCP Console Flow

```
McpPage
  └── useMcpSse(token)
        │
        ├── connect()
        │     └── openMcpSse()
        │           └── fetch('/mcp/sse', {headers: {Authorization: ...}})
        │                 └── ReadableStream reader loop
        │                       └── onSessionId('abc123') → setSessionId
        │                       └── onEvent('message', data) → setEvents(prev => [...prev, ev])
        │
        └── sendRequest('tools/list', {})
              └── fetch('/mcp/messages?sessionId=abc123', { method: 'POST', body: jsonrpc })
                    └── Server processes → sends back via SSE stream
                          └── appears in events log
```

---

## 10. Component Hierarchy

```
App
├── Login (if no token)
└── Layout (if authenticated)
    ├── Sidebar (nav items, user info, logout)
    └── <main>
        ├── DashboardPage
        │   ├── StatCard × 7
        │   ├── Bank Health Table
        │   └── Transactions Table
        │
        ├── ChatPage
        │   ├── Suggestions list (empty state)
        │   ├── ChatMessage × N
        │   └── Input form
        │
        ├── ToolsPage
        │   ├── Tool list sidebar
        │   │   └── ToolItem × N
        │   └── Tool detail panel
        │       ├── ArgInput × M (dynamic, per schema)
        │       ├── Execute button
        │       └── JSON result viewer
        │
        └── McpPage
            ├── Connection status bar
            ├── SSE event log
            └── Send panel
                ├── Quick action buttons
                └── Custom JSON-RPC form
```

---

## Common Issues

### "Failed to fetch" on connect

The backend is not running. Start it with:
```bash
cd "FinBridge AI"
docker compose -f docker/docker-compose.yml up -d
```

### Blank Dashboard (no data)

Tools are working but your MySQL tables have no rows. Seed with:
```sql
INSERT INTO bank_health (bank_code, status, success_rate, avg_response_ms)
VALUES ('GTB', 'up', 99.2, 210), ('ACCESS', 'up', 97.8, 340);
```

### SSE says "connecting" forever

Check the browser DevTools Network tab — find the `/mcp/sse` request. If it's 401, your token expired. Sign out and sign in again.

### Tool returns empty result

The tool executed successfully but the table is empty. The response will be:
```json
{ "data": { "rows": [] }, "cached": false, "executionMs": 12, "rowCount": 0 }
```

### CORS error in production

When deploying frontend to a different domain, configure `CORS_ORIGIN` in the backend `.env`:
```
CORS_ORIGIN=https://your-frontend-domain.com
```
