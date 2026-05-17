import { NetworkError, RateLimitError, ServerError, TimeoutError } from '../errors/index.js';

export interface RetryOptions {
  retries: number;
  retryDelay: number;
  /** Status codes that should trigger a retry */
  retryOn?: number[];
}

const DEFAULT_RETRY_ON = [408, 429, 500, 502, 503, 504];

/**
 * Executes an async operation with exponential backoff retry.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { retries, retryDelay, retryOn = DEFAULT_RETRY_ON } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (attempt === retries) break;
      if (!isRetryable(err, retryOn)) break;

      const delay = computeDelay(retryDelay, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

function isRetryable(err: unknown, retryOn: number[]): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof NetworkError) return true;
  if (err instanceof RateLimitError) return true;
  if (err instanceof ServerError && err.statusCode !== undefined) {
    return retryOn.includes(err.statusCode);
  }
  return false;
}

/** Exponential backoff with jitter: base * 2^attempt ± 10% */
function computeDelay(base: number, attempt: number): number {
  const exponential = base * Math.pow(2, attempt);
  const jitter = exponential * 0.1 * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
