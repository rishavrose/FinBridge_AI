// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  token: string;
  expiresIn: string;
}

export type Role = 'readonly' | 'analyst' | 'service' | 'admin';

export interface JwtClaims {
  sub: string;
  role: Role;
  name?: string;
  iat: number;
  exp: number;
  iss: string;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  permissions: Role[];
  cacheTtl?: number;
  tags?: string[];
}

export interface ToolExecuteResult {
  data: unknown;
  cached: boolean;
  executionMs: number;
  rowCount?: number;
}

// ─── AI Chat ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallInfo[];
  timestamp: Date;
}

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  /** The exact SQL the tool ran (for query_* tools). Optional. */
  sql?: string;
  /** Parameter array bound to the SQL placeholders. */
  params?: unknown[];
}

export interface AiChatResponse {
  reply: string;
  toolCallsExecuted: number;
  toolsUsed?: string[];
  toolCallsTrace?: ToolCallInfo[];
  tokensUsed?: number;
  conversationId: string;
  modelTier?: 'simple' | 'reasoning' | 'strict';
  modelUsed?: string;
  /** True when every numeric/ID fact in the reply was traceable to a tool result. */
  grounded?: boolean;
  ungroundedFacts?: Array<{ kind: string; value: string }>;
}

// ─── Chat History ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: string[];
  created_at: string;
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

export interface McpSession {
  sessionId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  connectedAt?: Date;
}

export interface McpEvent {
  event: string;
  data: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface HealthCheck {
  status: 'ok' | 'error';
  message?: string;
}

export interface HealthStatus {
  status: 'ready' | 'not_ready';
  service?: string;
  version?: string;
  environment?: string;
  timestamp?: string;
  uptime?: number;
  checks?: {
    database?: HealthCheck;
    redis?: HealthCheck;
    tools?: HealthCheck;
  };
}

// ─── Bank health tool ────────────────────────────────────────────────────────

export interface BankHealthRow {
  bank_code: string;
  bank_name?: string;
  status: string;
  success_rate: number;
  avg_response_ms: number;
  last_checked?: string;
}

// ─── API Key management (admin only) ────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  expiresAt?: string;
  active: boolean;
}

export interface CreateApiKeyResponse {
  message: string;
  rawKey: string;
  id: string;
  name: string;
  role: Role;
  expiresAt?: string;
}

// ─── Transaction tool ─────────────────────────────────────────────────────────

export interface TransactionRow {
  id: string;
  rrn?: string;
  user_id?: string;
  amount: number;
  currency?: string;
  status: string;
  created_at: string;
  bank_code?: string;
}

// ─── AI Memory / Semantic Cache (admin only) ─────────────────────────────────

export type CacheSource = 'redis' | 'qdrant' | 'openai';
export type ResponseType = 'direct' | 'validated' | 'miss';

/** Response from POST /ai/chat/message */
export interface AiMemoryChatResponse {
  reply: string;
  conversationId: string;
  messageId: string;
  cached: boolean;
  cacheSource: CacheSource;
  confidence?: number;
  responseType: ResponseType;
  responseMs: number;
  toolCallsExecuted: number;
  toolCallsTrace?: ToolCallInfo[];
  modelTier?: 'simple' | 'reasoning' | 'strict';
  modelUsed?: string;
  grounded?: boolean;
  ungroundedFacts?: Array<{ kind: string; value: string }>;
}

/** Response from GET /ai/chat/stats */
export interface AiCacheStats {
  totalRequests: number;
  redisHits: number;
  qdrantHits: number;
  openaiCalls: number;
  hitRate: number;
  avgResponseMs: number;
}

/** A knowledge entry row (from ai_knowledge table) */
export interface AiKnowledgeRow {
  id: string;
  original_prompt: string;
  normalized_prompt: string;
  intent_category: string;
  hit_count: number;
  confidence: number;
  created_at: string;
  updated_at: string;
}

/** A chat history row (from ai_chat_history table) */
export interface AiChatHistoryRow {
  id: string;
  user_id: string;
  original_prompt: string;
  cache_hit: number;
  cache_source: CacheSource;
  confidence_score?: number;
  response_ms: number;
  tool_calls_count: number;
  created_at: string;
}

/** A cache log row (from ai_cache_logs table) */
export interface AiCacheLogRow {
  id: string;
  prompt_hash: string;
  cache_source: CacheSource;
  hit: number;
  confidence?: number;
  response_ms: number;
  created_at: string;
}
