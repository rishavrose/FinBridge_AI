/**
 * Shared TypeScript types for the FinBridge MCP platform.
 */

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'analyst' | 'readonly' | 'service';

export interface JwtPayload {
  sub: string;        // User / service ID
  role: Role;
  name?: string;
  iat?: number;
  exp?: number;
  iss?: string;
}

export interface ApiKeyRecord {
  id: string;
  keyHash: string;    // SHA-256(salt + rawKey)
  name: string;
  role: Role;
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  active: boolean;
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  permissions: Role[];
  cacheTtl?: number;
  rateLimitMax?: number;
}

export interface McpToolContext {
  caller: {
    id: string;
    role: Role;
    name?: string;
  };
  requestId: string;
  timestamp: Date;
}

export interface McpToolResult {
  data: unknown;
  cached: boolean;
  executionMs: number;
  rowCount?: number;
}

// ─── Database ─────────────────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: 'PRI' | 'MUL' | 'UNI' | '';
  defaultValue: string | null;
  extra: string;
  comment: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  engine: string;
  rowCount: number;
  comment: string;
  columns: ColumnInfo[];
}

export interface SchemaSnapshot {
  database: string;
  capturedAt: Date;
  tables: TableInfo[];
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'tool.call'
  | 'tool.success'
  | 'tool.error'
  | 'auth.login'
  | 'auth.fail'
  | 'schema.scan'
  | 'connection.test';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  actor: {
    id: string;
    role: Role;
    name?: string;
  };
  resource: string;         // Tool name, endpoint, etc.
  requestId: string;
  metadata?: Record<string, unknown>;
  durationMs?: number;
  success: boolean;
  errorCode?: string;
  ip?: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export interface CacheOptions {
  ttl: number;              // Seconds
  tags?: string[];
}

// ─── Query Builder ────────────────────────────────────────────────────────────

export type SortDirection = 'ASC' | 'DESC';

export interface QueryCondition {
  column: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'BETWEEN';
  value: unknown;
}

export interface SafeQueryOptions {
  table: string;
  columns?: string[];
  conditions?: QueryCondition[];
  orderBy?: { column: string; direction: SortDirection };
  limit?: number;
  offset?: number;
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

export interface OpenAiFunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}
