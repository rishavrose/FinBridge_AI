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

const SAFE_CLIENT_ERROR_CODES = new Set([
  'RATE_LIMIT_EXCEEDED',
  'AUTHENTICATION_ERROR',
  'AUTHORIZATION_ERROR',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'OPENAI_NOT_CONFIGURED',
  'AI_DISABLED',
]);

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

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    // Network-level failure (offline, DNS, CORS, etc.)
    throw new Error('Unable to reach the server. Please check your connection and try again.');
  }

  if (!res.ok) {
    let message = '';
    let code = '';
    try {
      const body = await res.json() as { message?: string; error?: string; code?: string };
      message = body.message ?? body.error ?? '';
      code = body.code ?? '';
    } catch {
      // ignore parse error
    }

    // Only surface user-safe codes or specific HTTP statuses
    if (SAFE_CLIENT_ERROR_CODES.has(code) && message) {
      throw new Error(message);
    }
    if (res.status === 401) throw new Error('Session expired. Please log in again.');
    if (res.status === 403) throw new Error('You do not have permission to perform this action.');
    if (res.status === 429) throw new Error('Too many requests — please slow down and try again.');
    if (res.status === 404 && message) throw new Error(message);
    if (res.status >= 500) throw new Error('Service temporarily unavailable. Please try again.');

    // 4xx with message — safe to surface
    if (message && message.length < 200) throw new Error(message);
    throw new Error('The request could not be completed. Please try again.');
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

/**
 * Recent payouts joined with tbl_bank_lists, in the shape the dashboard's
 * Recent Transactions table expects (id / rrn / amount / status / created_at / bank_code).
 * bank_code carries the bank's display name and created_at is the full
 * addeddate+addedtime timestamp.
 */
export async function fetchRecentPayoutsLive(
  token: string,
  limit = 8,
): Promise<{
  rows: Array<{
    id: string;
    rrn: string | null;
    user_id: string | null;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
    bank_code: string | null;
  }>;
  count: number;
}> {
  return apiFetch(`/analytics/recent-payouts?limit=${limit}`, {}, token);
}

/**
 * Live bank/PSP health derived from tbl_payouts + tbl_bank_lists (last 24h).
 * Returns the same row shape as the old get_bank_health tool so the dashboard
 * can consume it without any other changes.
 */
export async function fetchBankHealthLive(
  token: string,
): Promise<{
  rows: Array<{
    bank_code: string;
    bank_name: string | null;
    status: string;
    success_rate: number;
    avg_response_ms: number;
    total_requests?: number;
    failed_requests?: number;
    last_checked?: string | null;
  }>;
  summary: { total: number; healthy: number; degraded: number };
}> {
  return apiFetch('/analytics/banks/live', {}, token);
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
    modelTier: res.modelTier,
    modelUsed: res.modelUsed,
    grounded: res.grounded,
    ungroundedFacts: res.ungroundedFacts,
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

// ─── Background AI Jobs — Features 1, 5, 6, 9 ───────────────────────────────

export interface QueueAiChatResult {
  jobId: string;
  conversationId: string;
  userMessageId: string;
  status: 'PENDING';
}

export interface AiJobStatus {
  jobId: string;
  conversationId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  result: { messageId: string; content: string; createdAt: string } | null;
}

/** Queue a message for background AI processing. Returns immediately. */
export async function queueAiChat(
  message: string,
  token: string,
  conversationId?: string,
  systemPrompt?: string,
): Promise<QueueAiChatResult> {
  return apiFetch<QueueAiChatResult>('/ai/chat/queue', {
    method: 'POST',
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
    }),
  }, token);
}

/** Poll status of a background AI job. */
export async function getAiJobStatus(jobId: string, token: string): Promise<AiJobStatus> {
  return apiFetch<AiJobStatus>(`/ai/chat/jobs/${encodeURIComponent(jobId)}`, {}, token);
}

/** Cancel a background AI job. */
export async function cancelAiJob(jobId: string, token: string): Promise<{ jobId: string; status: 'CANCELLED' }> {
  return apiFetch<{ jobId: string; status: 'CANCELLED' }>(
    `/ai/chat/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
    token,
  );
}

/** Edit a sent message and re-queue AI response. */
export async function editMessage(
  messageId: string,
  content: string,
  token: string,
): Promise<{ jobId: string; conversationId: string; messageId: string; status: 'PENDING' }> {
  return apiFetch(
    `/chat/messages/${encodeURIComponent(messageId)}/edit`,
    { method: 'POST', body: JSON.stringify({ content }) },
    token,
  );
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

// ─── AI Rate Limiting (admin only) ───────────────────────────────────────────

export interface AiRateConfig {
  aiEnabled: boolean;
  hourlyLimit: number;
  dailyLimit: number;
}

export interface AiUserLimits {
  userId: string;
  isBlocked: boolean;
  isUnlimited: boolean;
  hourlyLimit: number | null;
  dailyLimit: number | null;
  planType: string;
  blockReason: string | null;
  note?: string;
}

export interface AiUsageRow {
  user_id: string;
  username: string;
  full_name: string | null;
  total_requests: number;
  last_request_at: string | null;
  hourlyCount: number;
  dailyCount: number;
  plan_type: string;
  is_blocked: number;
  is_unlimited: number;
  /** Custom per-user hourly cap; null/undefined means "use global". */
  hourly_limit?: number | null;
  /** Custom per-user daily cap; null/undefined means "use global". */
  daily_limit?: number | null;
}

export async function fetchAiRateConfig(token: string): Promise<AiRateConfig> {
  return apiFetch<AiRateConfig>('/admin/ai/config', {}, token);
}

export async function updateAiRateConfig(
  patch: Partial<AiRateConfig>,
  token: string,
): Promise<AiRateConfig & { success: boolean }> {
  return apiFetch<AiRateConfig & { success: boolean }>('/admin/ai/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  }, token);
}

export async function fetchAiUserLimits(userId: string, token: string): Promise<AiUserLimits> {
  return apiFetch<AiUserLimits>(`/admin/ai/users/${encodeURIComponent(userId)}/limits`, {}, token);
}

export async function updateAiUserLimits(
  userId: string,
  patch: Partial<Omit<AiUserLimits, 'userId' | 'note'>>,
  token: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/admin/ai/users/${encodeURIComponent(userId)}/limits`,
    { method: 'PUT', body: JSON.stringify(patch) },
    token,
  );
}

export async function blockAiUser(userId: string, reason: string, token: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/admin/ai/users/${encodeURIComponent(userId)}/block`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    token,
  );
}

export async function unblockAiUser(userId: string, token: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/admin/ai/users/${encodeURIComponent(userId)}/unblock`,
    { method: 'POST' },
    token,
  );
}

export async function resetAiUserCounters(userId: string, token: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/admin/ai/users/${encodeURIComponent(userId)}/reset`,
    { method: 'POST' },
    token,
  );
}

export async function fetchAiUsageAnalytics(
  token: string,
  limit = 50,
): Promise<{ rows: AiUsageRow[]; count: number }> {
  return apiFetch<{ rows: AiUsageRow[]; count: number }>(
    `/admin/ai/usage?limit=${limit}`,
    {},
    token,
  );
}

// ─── Dashboard widget configuration ──────────────────────────────────────────

export interface DashboardWidgetConfig {
  widget_key: string;
  display_label: string;
  tool_name: string;
  args: Record<string, unknown>;
  count_args: Record<string, unknown> | null;
  column_map: Record<string, string> | null;
  description: string | null;
  enabled: boolean;
  updated_at: string;
}

export interface DashboardWidgetData {
  widget_key: string;
  display_label: string;
  tool_name: string;
  rows: Array<Record<string, unknown>>;
  count: number | null;
  raw: unknown;
  error?: string;
}

export async function listDashboardWidgets(token: string): Promise<{ widgets: DashboardWidgetConfig[]; count: number }> {
  return apiFetch<{ widgets: DashboardWidgetConfig[]; count: number }>('/dashboard/widgets', {}, token);
}

export async function getDashboardWidget(key: string, token: string): Promise<DashboardWidgetConfig> {
  return apiFetch<DashboardWidgetConfig>(`/dashboard/widgets/${encodeURIComponent(key)}`, {}, token);
}

export async function saveDashboardWidget(
  key: string,
  payload: {
    display_label: string;
    tool_name: string;
    args: Record<string, unknown>;
    count_args?: Record<string, unknown> | null;
    column_map?: Record<string, string> | null;
    description?: string | null;
    enabled?: boolean;
  },
  token: string,
): Promise<DashboardWidgetConfig> {
  return apiFetch<DashboardWidgetConfig>(
    `/dashboard/widgets/${encodeURIComponent(key)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteDashboardWidget(key: string, token: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/dashboard/widgets/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
    token,
  );
}

export async function fetchDashboardWidgetData(key: string, token: string): Promise<DashboardWidgetData> {
  return apiFetch<DashboardWidgetData>(`/dashboard/widgets/${encodeURIComponent(key)}/data`, {}, token);
}
