import { HttpClient } from './client/index.js';
import { EventBus } from './realtime/events.js';
import { RealtimeClient } from './realtime/websocket.js';
import { AuthModule } from './modules/auth.js';
import { PayoutsModule } from './modules/payouts.js';
import { TransactionsModule } from './modules/transactions.js';
import { AnalyticsModule } from './modules/analytics.js';
import { AiModule } from './modules/ai.js';
import { UsersModule } from './modules/users.js';
import { SettlementsModule } from './modules/settlements.js';
import { MonitoringModule } from './modules/monitoring.js';
import { McpModule } from './modules/mcp.js';
import type { FinBridgeConfig, WebSocketConfig } from './types/index.js';

export type { FinBridgeConfig, WebSocketConfig };

/**
 * FinBridge AI SDK
 * ─────────────────────────────────────────────────────────────────────────────
 * The single entry-point for all FinBridge AI platform capabilities.
 *
 * @example
 * ```ts
 * import FinBridgeAI from '@finbridgeai/sdk';
 *
 * const client = new FinBridgeAI({ apiKey: 'fb_live_xxxx' });
 *
 * // Query failed payouts
 * const { data } = await client.payouts.failed({ userId: 101 });
 *
 * // Ask the AI
 * const { data: ai } = await client.ai.ask({ prompt: 'Why did payouts fail today?' });
 * console.log(ai.answer);
 *
 * // Subscribe to real-time events
 * client.events.on('payout.failed', (payout) => {
 *   console.log('Payout failed:', payout.id);
 * });
 * client.realtime.connect();
 * ```
 */
export class FinBridgeAI {
  // ─── HTTP modules ────────────────────────────────────────────────────────────
  public readonly auth: AuthModule;
  public readonly payouts: PayoutsModule;
  public readonly transactions: TransactionsModule;
  public readonly analytics: AnalyticsModule;
  public readonly ai: AiModule;
  public readonly users: UsersModule;
  public readonly settlements: SettlementsModule;
  public readonly monitoring: MonitoringModule;
  public readonly mcp: McpModule;

  // ─── Realtime ────────────────────────────────────────────────────────────────
  /** Typed event emitter for subscribing to platform events. */
  public readonly events: EventBus;
  /** Managed WebSocket client for real-time updates. */
  public readonly realtime: RealtimeClient;

  /** Expose the underlying HTTP client for advanced usage. */
  public readonly _http: HttpClient;

  constructor(config: FinBridgeConfig, wsConfig?: WebSocketConfig) {
    const http = new HttpClient(config);
    this._http = http;

    // Instantiate all modules
    this.auth = new AuthModule(http);
    this.payouts = new PayoutsModule(http);
    this.transactions = new TransactionsModule(http);
    this.analytics = new AnalyticsModule(http);
    this.ai = new AiModule(http);
    this.users = new UsersModule(http);
    this.settlements = new SettlementsModule(http);
    this.monitoring = new MonitoringModule(http);
    this.mcp = new McpModule(http);

    // Realtime
    this.events = new EventBus();
    this.realtime = new RealtimeClient(
      config.apiKey,
      this.events,
      http.logger,
      wsConfig ?? {},
      config.baseUrl,
    );
  }

  /**
   * Update the active API key at runtime.
   */
  setApiKey(_apiKey: string): void {
    // The HttpClient interceptor reads from config; swap via token
    this._http.clearToken();
  }

  /**
   * Clear the local response cache.
   */
  clearCache(): void {
    this._http.cache.clear();
  }
}

// Named re-exports
export { HttpClient } from './client/index.js';
export { EventBus } from './realtime/events.js';
export { RealtimeClient } from './realtime/websocket.js';
export { MiddlewarePipeline } from './middleware/index.js';
export { Logger } from './utils/logger.js';
export { Cache } from './utils/cache.js';
export { withRetry } from './utils/retry.js';

// Error exports
export {
  FinBridgeError,
  AuthenticationError,
  AuthorizationError,
  TokenExpiredError,
  InvalidApiKeyError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  ServerError,
  ServiceUnavailableError,
  ConfigurationError,
  WebSocketError,
  fromAxiosError,
} from './errors/index.js';

// Type exports
export type {
  ApiResponse,
  PaginationMeta,
  PaginationParams,
  AuthTokens,
  LoginRequest,
  RefreshRequest,
  ApiKeyInfo,
  Payout,
  PayoutStatus,
  PayoutFilters,
  CreatePayoutRequest,
  RetryPayoutRequest,
  Transaction,
  TransactionType,
  TransactionStatus,
  TransactionFilters,
  AnalyticsQuery,
  AnalyticsMetric,
  AnalyticsResult,
  TimeSeriesPoint,
  SummaryStats,
  AiAskRequest,
  AiAskResponse,
  AiMessage,
  AiStreamChunk,
  TokenUsage,
  ToolResult,
  User,
  UserStatus,
  UserFilters,
  CreateUserRequest,
  UpdateUserRequest,
  Settlement,
  SettlementStatus,
  SettlementFilters,
  SettlementSummary,
  McpTool,
  McpCallRequest,
  McpCallResult,
  HealthStatus,
  MetricsData,
  AlertConfig,
  EventMap,
  SystemAlert,
  RequestConfig,
  RequestMiddleware,
  ResponseMiddleware,
  CacheConfig,
  LoggerConfig,
} from './types/index.js';

export default FinBridgeAI;
