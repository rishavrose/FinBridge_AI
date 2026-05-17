import type { RequestConfig, RequestMiddleware, ResponseMiddleware } from '../types/index.js';

/**
 * Middleware pipeline that chains request and response transformers.
 * Request middlewares are applied in order; response middlewares in reverse.
 */
export class MiddlewarePipeline {
  private requestMiddlewares: RequestMiddleware[] = [];
  private responseMiddlewares: ResponseMiddleware[] = [];

  useRequest(middleware: RequestMiddleware): this {
    this.requestMiddlewares.push(middleware);
    return this;
  }

  useResponse(middleware: ResponseMiddleware): this {
    this.responseMiddlewares.push(middleware);
    return this;
  }

  async applyRequest(config: RequestConfig): Promise<RequestConfig> {
    let current = config;
    for (const middleware of this.requestMiddlewares) {
      current = await middleware(current);
    }
    return current;
  }

  async applyResponse(response: unknown): Promise<unknown> {
    let current = response;
    for (let i = this.responseMiddlewares.length - 1; i >= 0; i--) {
      const middleware = this.responseMiddlewares[i];
      if (middleware) {
        current = await middleware(current);
      }
    }
    return current;
  }
}

// ─── Built-in middleware factories ────────────────────────────────────────────

/** Appends custom headers to every outgoing request. */
export function headersMiddleware(headers: Record<string, string>): RequestMiddleware {
  return (config) => ({
    ...config,
    headers: { ...config.headers, ...headers },
  });
}

/** Logs outgoing requests (use only in debug mode). */
export function loggingMiddleware(
  log: (message: string, meta?: unknown) => void,
): RequestMiddleware {
  return (config) => {
    log(`→ ${config.method} ${config.url}`, {
      params: config.params,
      hasBody: !!config.data,
    });
    return config;
  };
}
