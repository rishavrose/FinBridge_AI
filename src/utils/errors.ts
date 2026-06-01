/**
 * Application error hierarchy.
 * All domain errors extend AppError so error-handling middleware can
 * distinguish expected errors from unexpected crashes.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── HTTP errors ─────────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  constructor(message: string, public readonly details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('Too many requests — please slow down', 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ─── Domain errors ───────────────────────────────────────────────────────────

export class DatabaseError extends AppError {
  constructor(message: string, public readonly query?: string) {
    super(message, 500, 'DATABASE_ERROR');
  }
}

export class DatabaseConnectionError extends AppError {
  constructor(message = 'Unable to connect to the database') {
    super(message, 503, 'DB_CONNECTION_ERROR');
  }
}

export class CacheError extends AppError {
  constructor(message: string) {
    super(message, 500, 'CACHE_ERROR');
  }
}

export class ToolNotFoundError extends AppError {
  constructor(toolName: string) {
    super(`MCP tool "${toolName}" not found`, 404, 'TOOL_NOT_FOUND');
  }
}

export class ToolExecutionError extends AppError {
  constructor(toolName: string, reason: string) {
    super(`Tool "${toolName}" failed: ${reason}`, 500, 'TOOL_EXECUTION_ERROR');
  }
}

export class PermissionError extends AppError {
  constructor(toolName: string, role: string) {
    super(
      `Role "${role}" is not permitted to execute tool "${toolName}"`,
      403,
      'TOOL_PERMISSION_DENIED',
    );
  }
}

export class SchemaInspectionError extends AppError {
  constructor(message: string) {
    super(message, 500, 'SCHEMA_INSPECTION_ERROR');
  }
}

// ─── Guards ──────────────────────────────────────────────────────────────────

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isOperationalError(err: unknown): boolean {
  return isAppError(err) && err.isOperational;
}

// ─── User-safe error sanitizer ───────────────────────────────────────────────

const INTERNAL_ERROR_PATTERNS = [
  /NetworkError/i,
  /FetchError/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /EHOSTUNREACH/i,
  /ENOTFOUND/i,
  /ER_\w+/,           // MySQL error codes (ER_DUP_ENTRY, ER_NO_SUCH_TABLE, etc.)
  /at Object\./,      // stack trace lines
  /\.ts:\d+:\d+/,     // TypeScript source locations
  /\.js:\d+:\d+/,     // JS source locations
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /Cannot read prop/i,
  /is not a function/i,
  /undefined is not/i,
  /null is not/i,
  /redis/i,
  /qdrant/i,
  /bullmq/i,
];

/**
 * Converts any internal/technical error into a safe, user-facing string.
 * Never exposes stack traces, SQL errors, network internals, or service names.
 */
export function sanitizeErrorForUser(err: unknown): string {
  if (isAppError(err)) {
    switch (err.statusCode) {
      case 429: return 'Too many requests — please slow down and try again shortly.';
      case 401: return 'Your session has expired. Please log in again.';
      case 403: return 'You do not have permission to perform this action.';
      case 404: return 'The requested data could not be found.';
      case 503: return 'The service is temporarily unavailable. Please try again in a moment.';
    }
  }

  const msg = err instanceof Error ? err.message : String(err);

  if (INTERNAL_ERROR_PATTERNS.some((p) => p.test(msg))) {
    return 'Unable to retrieve the requested data right now. Please try again.';
  }

  // Short, non-technical messages can be passed through
  if (msg.length < 200 && !msg.includes('\n') && !msg.includes('  at ')) {
    return msg;
  }

  return 'Unable to complete the analysis. Please try again.';
}
