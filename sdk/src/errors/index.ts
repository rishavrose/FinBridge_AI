import type { AxiosError } from 'axios';

// ─── Base Error ───────────────────────────────────────────────────────────────

export class FinBridgeError extends Error {
  public readonly code: string;
  public readonly statusCode: number | undefined;
  public readonly requestId: string | undefined;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: string,
    statusCode?: number,
    requestId?: string,
  ) {
    super(message);
    this.name = 'FinBridgeError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.timestamp = new Date().toISOString();

    // Restore prototype chain (necessary when extending built-in classes in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      requestId: this.requestId,
      timestamp: this.timestamp,
    };
  }
}

// ─── Authentication Errors ────────────────────────────────────────────────────

export class AuthenticationError extends FinBridgeError {
  constructor(message = 'Authentication failed', requestId?: string) {
    super(message, 'AUTHENTICATION_ERROR', 401, requestId);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends FinBridgeError {
  constructor(message = 'Insufficient permissions', requestId?: string) {
    super(message, 'AUTHORIZATION_ERROR', 403, requestId);
    this.name = 'AuthorizationError';
  }
}

export class TokenExpiredError extends FinBridgeError {
  constructor(message = 'Token has expired', requestId?: string) {
    super(message, 'TOKEN_EXPIRED', 401, requestId);
    this.name = 'TokenExpiredError';
  }
}

export class InvalidApiKeyError extends FinBridgeError {
  constructor(message = 'Invalid API key', requestId?: string) {
    super(message, 'INVALID_API_KEY', 401, requestId);
    this.name = 'InvalidApiKeyError';
  }
}

// ─── Request Errors ───────────────────────────────────────────────────────────

export class ValidationError extends FinBridgeError {
  public readonly fields: Record<string, string> | undefined;

  constructor(
    message = 'Validation failed',
    fields?: Record<string, string>,
    requestId?: string,
  ) {
    super(message, 'VALIDATION_ERROR', 422, requestId);
    this.name = 'ValidationError';
    this.fields = fields;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), fields: this.fields };
  }
}

export class NotFoundError extends FinBridgeError {
  constructor(resource = 'Resource', requestId?: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404, requestId);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends FinBridgeError {
  constructor(message = 'Resource conflict', requestId?: string) {
    super(message, 'CONFLICT', 409, requestId);
    this.name = 'ConflictError';
  }
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export class RateLimitError extends FinBridgeError {
  public readonly retryAfter: number | undefined;

  constructor(message = 'Rate limit exceeded', retryAfter?: number, requestId?: string) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, requestId);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), retryAfter: this.retryAfter };
  }
}

// ─── Network Errors ───────────────────────────────────────────────────────────

export class NetworkError extends FinBridgeError {
  constructor(message = 'Network error occurred', requestId?: string) {
    super(message, 'NETWORK_ERROR', undefined, requestId);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends FinBridgeError {
  constructor(message = 'Request timed out', requestId?: string) {
    super(message, 'TIMEOUT', undefined, requestId);
    this.name = 'TimeoutError';
  }
}

// ─── Server Errors ────────────────────────────────────────────────────────────

export class ServerError extends FinBridgeError {
  constructor(message = 'Internal server error', statusCode = 500, requestId?: string) {
    super(message, 'SERVER_ERROR', statusCode, requestId);
    this.name = 'ServerError';
  }
}

export class ServiceUnavailableError extends FinBridgeError {
  constructor(message = 'Service temporarily unavailable', requestId?: string) {
    super(message, 'SERVICE_UNAVAILABLE', 503, requestId);
    this.name = 'ServiceUnavailableError';
  }
}

// ─── SDK Configuration Errors ─────────────────────────────────────────────────

export class ConfigurationError extends FinBridgeError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class WebSocketError extends FinBridgeError {
  constructor(message: string, requestId?: string) {
    super(message, 'WEBSOCKET_ERROR', undefined, requestId);
    this.name = 'WebSocketError';
  }
}

// ─── Error Factory ────────────────────────────────────────────────────────────

export function fromAxiosError(error: AxiosError<ApiErrorBody>): FinBridgeError {
  const requestId = error.response?.headers?.['x-request-id'] as string | undefined;
  const body = error.response?.data;
  const message = body?.message ?? error.message;

  if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
    return new TimeoutError(message, requestId);
  }

  if (!error.response) {
    return new NetworkError(message, requestId);
  }

  const status = error.response.status;

  switch (status) {
    case 400:
      return new ValidationError(message, body?.fields, requestId);
    case 401: {
      if (body?.code === 'TOKEN_EXPIRED') return new TokenExpiredError(message, requestId);
      if (body?.code === 'INVALID_API_KEY') return new InvalidApiKeyError(message, requestId);
      return new AuthenticationError(message, requestId);
    }
    case 403:
      return new AuthorizationError(message, requestId);
    case 404:
      return new NotFoundError(body?.resource ?? 'Resource', requestId);
    case 409:
      return new ConflictError(message, requestId);
    case 422:
      return new ValidationError(message, body?.fields, requestId);
    case 429: {
      const retryAfter = parseInt(
        error.response.headers?.['retry-after'] as string ?? '0',
        10,
      );
      return new RateLimitError(message, retryAfter || undefined, requestId);
    }
    case 503:
      return new ServiceUnavailableError(message, requestId);
    default:
      if (status >= 500) return new ServerError(message, status, requestId);
      return new FinBridgeError(message, body?.code ?? 'UNKNOWN_ERROR', status, requestId);
  }
}

interface ApiErrorBody {
  message?: string;
  code?: string;
  resource?: string;
  fields?: Record<string, string>;
}

// Re-export for convenience
export {
  FinBridgeError as default,
};
