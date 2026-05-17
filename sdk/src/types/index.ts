// ─── Core Configuration ───────────────────────────────────────────────────────

export interface FinBridgeConfig {
  /** Your FinBridge AI API key */
  apiKey: string;
  /** Base URL of the FinBridge AI API (default: https://api.finbridgeai.com) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts on transient failures (default: 3) */
  retries?: number;
  /** Base delay in ms between retries — uses exponential backoff (default: 500) */
  retryDelay?: number;
  /** Optional JWT token for user-scoped requests */
  jwtToken?: string;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Cache configuration */
  cache?: CacheConfig;
  /** Logger configuration */
  logger?: LoggerConfig;
  /** Custom headers appended to every request */
  defaultHeaders?: Record<string, string>;
}

export interface CacheConfig {
  enabled: boolean;
  /** Time-to-live in milliseconds (default: 60000) */
  ttl?: number;
  /** Maximum number of cached entries (default: 500) */
  maxSize?: number;
}

export interface LoggerConfig {
  enabled: boolean;
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom log function — defaults to console */
  handler?: (level: string, message: string, meta?: unknown) => void;
}

// ─── Shared Response Wrapper ──────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
  meta?: PaginationMeta;
  requestId?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

// ─── Authentication ───────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface ApiKeyInfo {
  keyId: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

export interface Payout {
  id: string;
  userId: string | number;
  amount: number;
  currency: string;
  status: PayoutStatus;
  method: string;
  reference?: string;
  failureReason?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  metadata?: Record<string, unknown>;
}

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'reversed';

export interface PayoutFilters extends PaginationParams {
  userId?: string | number;
  status?: PayoutStatus;
  startDate?: string;
  endDate?: string;
  currency?: string;
  minAmount?: number;
  maxAmount?: number;
  reference?: string;
}

export interface CreatePayoutRequest {
  userId: string | number;
  amount: number;
  currency: string;
  method: string;
  accountDetails: Record<string, unknown>;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export interface RetryPayoutRequest {
  payoutId: string;
  reason?: string;
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  userId: string | number;
  amount: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  description?: string;
  reference?: string;
  channel?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export type TransactionType = 'debit' | 'credit' | 'reversal' | 'fee';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export interface TransactionFilters extends PaginationParams {
  userId?: string | number;
  type?: TransactionType;
  status?: TransactionStatus;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  channel?: string;
  reference?: string;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  metrics: AnalyticsMetric[];
  groupBy?: 'day' | 'week' | 'month' | 'hour';
  filters?: Record<string, unknown>;
  currency?: string;
}

export type AnalyticsMetric =
  | 'total_transactions'
  | 'total_volume'
  | 'success_rate'
  | 'failure_rate'
  | 'avg_transaction_value'
  | 'total_payouts'
  | 'payout_success_rate'
  | 'settlement_volume'
  | string;

export interface AnalyticsResult {
  metrics: Record<string, number | string>;
  timeSeries?: TimeSeriesPoint[];
  breakdown?: Record<string, BreakdownItem>;
  generatedAt: string;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  label?: string;
}

export interface BreakdownItem {
  value: number;
  percentage: number;
  change?: number;
}

export interface SummaryStats {
  totalTransactions: number;
  totalVolume: number;
  successRate: number;
  failedTransactions: number;
  averageTransactionValue: number;
  currency: string;
  period: { from: string; to: string };
}

// ─── AI ───────────────────────────────────────────────────────────────────────

export interface AiAskRequest {
  prompt: string;
  context?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** MCP tool names to make available during this request */
  tools?: string[];
  /** Conversation history for multi-turn sessions */
  messages?: AiMessage[];
  stream?: boolean;
}

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiAskResponse {
  answer: string;
  model: string;
  usage: TokenUsage;
  toolResults?: ToolResult[];
  conversationId?: string;
  finishReason?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolResult {
  toolName: string;
  result: unknown;
  executionTimeMs?: number;
}

export interface AiStreamChunk {
  delta: string;
  done: boolean;
  conversationId?: string;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface User {
  id: string | number;
  email: string;
  name: string;
  phone?: string;
  role: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  metadata?: Record<string, unknown>;
}

export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface UserFilters extends PaginationParams {
  status?: UserStatus;
  role?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  phone?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserRequest {
  name?: string;
  phone?: string;
  role?: string;
  status?: UserStatus;
  metadata?: Record<string, unknown>;
}

// ─── Settlements ─────────────────────────────────────────────────────────────

export interface Settlement {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  status: SettlementStatus;
  settlementDate: string;
  bankReference?: string;
  transactionCount?: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type SettlementStatus = 'pending' | 'processing' | 'settled' | 'failed' | 'on_hold';

export interface SettlementFilters extends PaginationParams {
  merchantId?: string;
  status?: SettlementStatus;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface SettlementSummary {
  totalSettled: number;
  totalPending: number;
  totalFailed: number;
  currency: string;
  period: { from: string; to: string };
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
  category?: string;
  version?: string;
  tags?: string[];
}

export interface McpToolSchema {
  type: 'object';
  properties: Record<string, McpPropertySchema>;
  required?: string[];
}

export interface McpPropertySchema {
  type: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
}

export interface McpCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  timeout?: number;
}

export interface McpCallResult {
  toolName: string;
  result: unknown;
  executionTimeMs?: number;
  cached?: boolean;
}

// ─── Monitoring ───────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: ServiceStatus;
  version: string;
  uptime: number;
  services: Record<string, ServiceHealth>;
  timestamp: string;
}

export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface ServiceHealth {
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
  lastChecked?: string;
}

export interface MetricsData {
  requestCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  activeConnections?: number;
  timestamp: string;
}

export interface AlertConfig {
  metric: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  windowSeconds?: number;
}

// ─── Middleware & Request ─────────────────────────────────────────────────────

export interface RequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
  timeout?: number;
  skipCache?: boolean;
  skipRetry?: boolean;
}

export type RequestMiddleware = (
  config: RequestConfig,
) => RequestConfig | Promise<RequestConfig>;

export type ResponseMiddleware = (response: unknown) => unknown | Promise<unknown>;

// ─── Realtime Events ─────────────────────────────────────────────────────────

export interface EventMap {
  'payout.created': Payout;
  'payout.processing': Payout;
  'payout.completed': Payout;
  'payout.failed': Payout;
  'payout.reversed': Payout;
  'transaction.created': Transaction;
  'transaction.completed': Transaction;
  'transaction.failed': Transaction;
  'settlement.initiated': Settlement;
  'settlement.processed': Settlement;
  'settlement.failed': Settlement;
  'user.created': User;
  'user.updated': User;
  'user.suspended': User;
  'system.alert': SystemAlert;
  'system.maintenance': { message: string; scheduledAt: string };
  connected: { connectionId: string; timestamp: string };
  disconnected: { reason: string; timestamp: string };
  error: { message: string; code?: string };
  [key: string]: unknown;
}

export interface SystemAlert {
  level: 'info' | 'warning' | 'critical';
  message: string;
  service?: string;
  timestamp: string;
}

export interface WebSocketConfig {
  url?: string;
  reconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  /** Topics/channels to subscribe on connect */
  subscriptions?: string[];
}
