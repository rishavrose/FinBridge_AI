import type {
  TokenResponse,
  ToolDefinition,
  ToolExecuteResult,
  AiChatResponse,
  HealthStatus,
  JsonRpcRequest,
  ApiKeyRecord,
  CreateApiKeyResponse,
  Role,
  Conversation,
  ConversationMessage,
  AiMemoryChatResponse,
  AiCacheStats,
  AiKnowledgeRow,
  AiChatHistoryRow,
  AiCacheLogRow,
} from '../types';

// ─── Base fetch helper ────────────────────────────────────────────────────────

const API_BASE = ((import.meta as any).env?.VITE_API_URL as string | undefined) ?? '';

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };
  // Only set Content-Type when we are actually sending a body
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  expiresIn: string;
  user: { id: string; username: string; role: string; fullName: string | null };
}

export async function loginWithPassword(username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function issueToken(
  userId: string,
  role: string,
  secret: string,
): Promise<TokenResponse> {
  return apiFetch<TokenResponse>('/auth/token', {
    method: 'POST',
    body: JSON.stringify({ userId, role, secret }),
  });
}

// ─── User management ─────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export async function listUsers(token: string): Promise<{ users: AppUser[] }> {
  return apiFetch<{ users: AppUser[] }>('/users', {}, token);
}

export async function createUser(
  data: { username: string; password: string; fullName?: string; role: string },
  token: string,
): Promise<{ user: AppUser }> {
  return apiFetch<{ user: AppUser }>('/users', { method: 'POST', body: JSON.stringify(data) }, token);
}

export async function updateUser(
  id: string,
  data: { fullName?: string; role?: string; isActive?: boolean; password?: string },
  token: string,
): Promise<{ user: AppUser }> {
  return apiFetch<{ user: AppUser }>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
}

export async function deleteUser(id: string, token: string): Promise<void> {
  await apiFetch<void>(`/users/${id}`, { method: 'DELETE' }, token);
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealth(token: string): Promise<HealthStatus> {
  // Merge /health/ready (db/redis checks) with /health/info (uptime)
  const [ready, info] = await Promise.all([
    apiFetch<HealthStatus>('/health/ready', {}, token).catch(() => null),
    apiFetch<{ uptime?: number }>('/health/info', {}, token).catch(() => null),
  ]);
  return { ...ready, uptime: info?.uptime } as HealthStatus;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export async function fetchTools(token: string): Promise<{ tools: ToolDefinition[] }> {
  return apiFetch<{ tools: ToolDefinition[] }>('/tools', {}, token);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
): Promise<ToolExecuteResult> {
  return apiFetch<ToolExecuteResult>(`/tools/${encodeURIComponent(name)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ args }),
  }, token);
}

export async function deleteTool(
  name: string,
  token: string,
): Promise<{ message: string; tool: string }> {
  return apiFetch<{ message: string; tool: string }>(
    `/tools/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
    token,
  );
}

// ─── AI Chat ─────────────────────────────────────────────────────────────────

export async function aiChat(
  message: string,
  token: string,
  conversationId?: string,
): Promise<AiChatResponse> {
  const res = await apiFetch<AiMemoryChatResponse>('/ai/chat/message', {
    method: 'POST',
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  }, token);

  return {
    reply: res.reply,
    conversationId: res.conversationId,
    toolCallsExecuted: res.toolCallsExecuted,
    toolsUsed: [],
    toolCallsTrace: res.toolCallsTrace ?? [],
  };
}

// ─── Chat History ─────────────────────────────────────────────────────────────

export async function listConversations(token: string): Promise<{ conversations: Conversation[] }> {
  return apiFetch<{ conversations: Conversation[] }>('/chat/conversations', {}, token);
}

export async function getConversation(
  id: string,
  token: string,
): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> {
  return apiFetch<{ conversation: Conversation; messages: ConversationMessage[] }>(
    `/chat/conversations/${encodeURIComponent(id)}`,
    {},
    token,
  );
}

export async function deleteConversation(id: string, token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(
    `/chat/conversations/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    token,
  );
}

// ─── API Key management (admin only) ────────────────────────────────────────

export async function listApiKeys(token: string): Promise<{ apiKeys: ApiKeyRecord[] }> {
  return apiFetch<{ apiKeys: ApiKeyRecord[] }>('/auth/api-keys', {}, token);
}

export async function createApiKey(
  name: string,
  role: Role,
  expiresInDays: number | undefined,
  token: string,
): Promise<CreateApiKeyResponse> {
  return apiFetch<CreateApiKeyResponse>('/auth/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name, role, ...(expiresInDays ? { expiresInDays } : {}) }),
  }, token);
}

export async function revokeApiKey(id: string, token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/auth/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, token);
}

// ─── Dynamic DB Connections ───────────────────────────────────────────────────

export interface DbConnectPayload {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  name?: string;
  selectedTables?: string[];
}

export interface DbTestResult {
  success: boolean;
  latencyMs: number;
  serverVersion?: string;
  error?: string;
  tablesFound?: number;
  tables?: string[];
}

export interface DbConnectionRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  ssl: boolean;
  tenantId: string;
  createdAt: string;
  selectedTables?: string[];
  isMain?: boolean;
}

export interface DbConnectResult {
  connectionId: string;
  name: string;
  database: string;
  host: string;
  port: number;
  ssl: boolean;
  createdAt: string;
  connectionTest: { latencyMs: number; serverVersion?: string; tablesFound?: number };
  toolSummary: { tablesDiscovered: string[]; toolsGenerated: string[]; generatedAt: string } | null;
}

export async function testDbConnection(payload: DbConnectPayload, token: string): Promise<DbTestResult> {
  return apiFetch<DbTestResult>('/db/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function connectDatabase(payload: DbConnectPayload, token: string): Promise<DbConnectResult> {
  return apiFetch<DbConnectResult>('/db/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function listDbConnections(token: string): Promise<{ connections: DbConnectionRecord[]; count: number }> {
  return apiFetch<{ connections: DbConnectionRecord[]; count: number }>('/db/connections', {}, token);
}

export async function removeDbConnection(id: string, token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/db/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, token);
}

export async function refreshDbConnectionTools(
  id: string,
  token: string,
  selectedTables?: string[],
): Promise<{ message: string; toolsGenerated: string[]; tablesDiscovered: string[] }> {
  return apiFetch<{ message: string; toolsGenerated: string[]; tablesDiscovered: string[] }>(
    `/db/connections/${encodeURIComponent(id)}/refresh`,
    { method: 'POST', body: JSON.stringify({ selectedTables }) },
    token,
  );
}

export async function getDbConnectionSchema(
  id: string,
  token: string,
): Promise<{ connectionId: string; tableCount: number; tables: Array<{ name: string; rowCount: number; comment: string }> }> {
  return apiFetch(
    `/db/connections/${encodeURIComponent(id)}/schema`,
    {},
    token,
  );
}

// ─── MCP SSE (via fetch + ReadableStream) ────────────────────────────────────

/**
 * Opens a persistent SSE connection to /mcp/sse.
 * Returns a controller that surfaces the sessionId + parsed events.
 *
 * We use fetch() instead of EventSource because the browser's native
 * EventSource API does NOT support custom request headers. fetch() gives us
 * full control over headers so we can pass the Authorization header.
 */
export function openMcpSse(
  token: string,
  onEvent: (event: string, data: string) => void,
  onSessionId: (id: string) => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    let response: Response;
    try {
      response = await fetch('/mcp/sse', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        onError(err instanceof Error ? err.message : 'SSE connection failed');
      }
      return;
    }

    if (!response.ok || !response.body) {
      onError(`SSE request failed: HTTP ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // SSE text/event-stream format:
    //   event: <name>\n
    //   data: <payload>\n
    //   \n
    let currentEvent = 'message';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const data = line.slice(5).trim();

            // Extract sessionId from the endpoint event
            if (currentEvent === 'endpoint') {
              const match = data.match(/sessionId=([^&\s]+)/);
              if (match) onSessionId(match[1]);
            }

            onEvent(currentEvent, data);
            currentEvent = 'message';
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onError(err instanceof Error ? err.message : 'SSE stream error');
      }
    }
  })();

  return controller;
}

// ─── MCP Messages ────────────────────────────────────────────────────────────

export async function sendMcpMessage(
  sessionId: string,
  request: JsonRpcRequest,
  token: string,
): Promise<void> {
  const res = await fetch(`/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error(`MCP message failed: HTTP ${res.status}`);
  }
}

// ─── AI Memory / Semantic Cache (admin only) ─────────────────────────────────

/**
 * POST /ai/chat/message
 * Memory-augmented chat that checks Redis → Qdrant → OpenAI.
 */
export async function aiMemoryChat(
  message: string,
  token: string,
  conversationId?: string,
): Promise<AiMemoryChatResponse> {
  return apiFetch<AiMemoryChatResponse>('/ai/chat/message', {
    method: 'POST',
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  }, token);
}

/**
 * GET /ai/chat/stats
 * Returns in-memory hit-rate counters and average latency.
 */
export async function fetchAiCacheStats(token: string): Promise<AiCacheStats> {
  return apiFetch<AiCacheStats>('/ai/chat/stats', {}, token);
}

/**
 * POST /ai/chat/feedback
 * Submit a user rating on an AI response.
 */
export async function submitAiFeedback(
  messageId: string,
  rating: number,
  feedbackType: 'positive' | 'negative' | 'neutral',
  comment: string | undefined,
  token: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/ai/chat/feedback', {
    method: 'POST',
    body: JSON.stringify({ messageId, rating, feedbackType, comment }),
  }, token);
}

/**
 * GET /ai/memory/knowledge
 * Returns the top-N knowledge entries ordered by hit count.
 */
export async function fetchAiKnowledge(token: string, limit = 50): Promise<AiKnowledgeRow[]> {
  const res = await apiFetch<{ rows?: AiKnowledgeRow[] }>(
    `/ai/memory/knowledge?limit=${limit}`,
    {},
    token,
  ).catch(() => null);
  return res?.rows ?? [];
}

/**
 * GET /ai/memory/history
 * Returns the most recent N chat history entries.
 */
export async function fetchAiChatHistory(token: string, limit = 100): Promise<AiChatHistoryRow[]> {
  const res = await apiFetch<{ rows?: AiChatHistoryRow[] }>(
    `/ai/memory/history?limit=${limit}`,
    {},
    token,
  ).catch(() => null);
  return res?.rows ?? [];
}

/**
 * GET /ai/memory/cache-logs
 * Returns recent cache log entries.
 */
export async function fetchAiCacheLogs(token: string, limit = 200): Promise<AiCacheLogRow[]> {
  const res = await apiFetch<{ rows?: AiCacheLogRow[] }>(
    `/ai/memory/cache-logs?limit=${limit}`,
    {},
    token,
  ).catch(() => null);
  return res?.rows ?? [];
}
