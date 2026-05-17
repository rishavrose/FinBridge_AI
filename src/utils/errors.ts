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
