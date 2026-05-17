import axios, { type AxiosInstance, type AxiosResponse, isAxiosError } from 'axios';
import type { FinBridgeConfig, ApiResponse, RequestConfig } from '../types/index.js';
import { fromAxiosError, ConfigurationError } from '../errors/index.js';
import { withRetry } from '../utils/retry.js';
import { Logger } from '../utils/logger.js';
import { Cache } from '../utils/cache.js';
import { MiddlewarePipeline, headersMiddleware, loggingMiddleware } from '../middleware/index.js';

const SDK_VERSION = '1.0.0';
const DEFAULT_BASE_URL = 'https://api.finbridgeai.com';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 500;

/**
 * Core HTTP client for FinBridge AI.
 * Handles auth headers, retries, caching, middleware, and error normalisation.
 */
export class HttpClient {
  private readonly http: AxiosInstance;
  private readonly config: Required<
    Pick<FinBridgeConfig, 'retries' | 'retryDelay' | 'timeout'>
  > &
    FinBridgeConfig;

  public readonly logger: Logger;
  public readonly cache: Cache;
  public readonly middleware: MiddlewarePipeline;

  constructor(config: FinBridgeConfig) {
    if (!config.apiKey?.trim()) {
      throw new ConfigurationError('apiKey is required to initialise the FinBridgeAI SDK.');
    }

    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      timeout: DEFAULT_TIMEOUT,
      retries: DEFAULT_RETRIES,
      retryDelay: DEFAULT_RETRY_DELAY,
      debug: false,
      ...config,
    };

    this.logger = new Logger(
      config.debug
        ? { enabled: true, level: 'debug', ...config.logger }
        : (config.logger ?? { enabled: false }),
    );

    this.cache = new Cache(config.cache ?? { enabled: false });
    this.middleware = new MiddlewarePipeline();

    // Built-in request middlewares
    this.middleware.useRequest(
      headersMiddleware({
        'User-Agent': `@finbridgeai/sdk/${SDK_VERSION}`,
        'X-SDK-Version': SDK_VERSION,
        ...(config.defaultHeaders ?? {}),
      }),
    );

    if (config.debug) {
      this.middleware.useRequest(loggingMiddleware(this.logger.debug.bind(this.logger)));
    }

    this.http = axios.create({
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.setupInterceptors();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async get<T>(
    path: string,
    params?: Record<string, unknown>,
    opts: { cache?: boolean } = {},
  ): Promise<ApiResponse<T>> {
    const cacheKey = Cache.buildKey(path, params);

    if (opts.cache !== false) {
      const cached = this.cache.get<ApiResponse<T>>(cacheKey);
      if (cached) {
        this.logger.debug('Cache hit', { key: cacheKey });
        return cached;
      }
    }

    const result = await this.request<T>({ url: path, method: 'GET', headers: {}, ...(params ? { params } : {}) });

    if (opts.cache !== false) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  async post<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ url: path, method: 'POST', headers: {}, data });
  }

  async put<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ url: path, method: 'PUT', headers: {}, data });
  }

  async patch<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ url: path, method: 'PATCH', headers: {}, data });
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>({ url: path, method: 'DELETE', headers: {} });
  }

  /** Swap the active auth token (e.g. after token refresh). */
  setToken(token: string): void {
    this.http.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    this.logger.debug('Auth token updated');
  }

  clearToken(): void {
    delete this.http.defaults.headers.common['Authorization'];
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private async request<T>(rawConfig: RequestConfig): Promise<ApiResponse<T>> {
    const resolvedConfig = await this.middleware.applyRequest(rawConfig);

    return withRetry(
      () => this.executeRequest<T>(resolvedConfig),
      {
        retries: this.config.retries,
        retryDelay: this.config.retryDelay,
      },
    );
  }

  private async executeRequest<T>(config: RequestConfig): Promise<ApiResponse<T>> {
    try {
      const response: AxiosResponse<ApiResponse<T>> = await this.http.request({
        url: config.url,
        method: config.method,
        headers: config.headers,
        params: config.params,
        data: config.data,
        timeout: config.timeout ?? this.config.timeout,
      });

      this.logger.debug(`← ${config.method} ${config.url} [${response.status}]`);

      return response.data;
    } catch (err) {
      if (isAxiosError(err)) {
        throw fromAxiosError(err);
      }
      throw err;
    }
  }

  private setupInterceptors(): void {
    // Attach auth headers on every request
    this.http.interceptors.request.use((config) => {
      const { apiKey, jwtToken } = this.config;

      if (jwtToken) {
        config.headers['Authorization'] = `Bearer ${jwtToken}`;
      } else {
        config.headers['X-API-Key'] = apiKey;
      }

      config.headers['X-Request-Id'] = generateRequestId();
      return config;
    });

    // Rate-limit backoff: honour Retry-After header automatically
    this.http.interceptors.response.use(
      (res) => res,
      async (err) => {
        if (isAxiosError(err) && err.response?.status === 429) {
          const retryAfter = parseInt(
            (err.response.headers?.['retry-after'] as string | undefined) ?? '1',
            10,
          );
          this.logger.warn(`Rate limited — retrying after ${retryAfter}s`);
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        }
        return Promise.reject(err);
      },
    );
  }
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
