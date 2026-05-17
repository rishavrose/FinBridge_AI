/**
 * Structured audit logger.
 *
 * Every AI tool call, authentication event, and schema scan is recorded
 * with a full audit trail.  In production, entries stream to a log aggregator
 * (CloudWatch, Datadog, Elastic) via the pino transport — no DB writes in the
 * hot path.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import type { AuditAction, AuditEntry, Role } from '../types/index.js';

// ─── Writer ───────────────────────────────────────────────────────────────────

function writeAuditEntry(entry: AuditEntry): void {
  // Emit as a structured log line at INFO level with an `audit` flag
  // so log shippers can route audit events to a dedicated sink.
  logger.info({ audit: true, ...entry }, `AUDIT: ${entry.action}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AuditContext {
  actorId: string;
  actorRole: Role;
  actorName?: string;
  requestId: string;
  ip?: string;
}

export function auditToolCall(
  ctx: AuditContext,
  toolName: string,
  args: unknown,
): string {
  const id = uuidv4();
  writeAuditEntry({
    id,
    timestamp: new Date(),
    action: 'tool.call',
    actor: { id: ctx.actorId, role: ctx.actorRole, name: ctx.actorName },
    resource: toolName,
    requestId: ctx.requestId,
    metadata: { args },
    success: true,
    ip: ctx.ip,
  });
  return id;
}

export function auditToolSuccess(
  ctx: AuditContext,
  toolName: string,
  durationMs: number,
  rowCount?: number,
): void {
  writeAuditEntry({
    id: uuidv4(),
    timestamp: new Date(),
    action: 'tool.success',
    actor: { id: ctx.actorId, role: ctx.actorRole, name: ctx.actorName },
    resource: toolName,
    requestId: ctx.requestId,
    metadata: { rowCount },
    durationMs,
    success: true,
    ip: ctx.ip,
  });
}

export function auditToolError(
  ctx: AuditContext,
  toolName: string,
  errorCode: string,
  durationMs: number,
): void {
  writeAuditEntry({
    id: uuidv4(),
    timestamp: new Date(),
    action: 'tool.error',
    actor: { id: ctx.actorId, role: ctx.actorRole, name: ctx.actorName },
    resource: toolName,
    requestId: ctx.requestId,
    durationMs,
    success: false,
    errorCode,
    ip: ctx.ip,
  });
}

export function auditAuthEvent(
  action: Extract<AuditAction, 'auth.login' | 'auth.fail'>,
  ctx: Partial<AuditContext>,
  metadata?: Record<string, unknown>,
): void {
  writeAuditEntry({
    id: uuidv4(),
    timestamp: new Date(),
    action,
    actor: {
      id: ctx.actorId ?? 'anonymous',
      role: ctx.actorRole ?? 'readonly',
      name: ctx.actorName,
    },
    resource: 'auth',
    requestId: ctx.requestId ?? uuidv4(),
    metadata,
    success: action === 'auth.login',
    ip: ctx.ip,
  });
}

export function auditSchemaScan(ctx: AuditContext, database: string, tableCount: number): void {
  writeAuditEntry({
    id: uuidv4(),
    timestamp: new Date(),
    action: 'schema.scan',
    actor: { id: ctx.actorId, role: ctx.actorRole, name: ctx.actorName },
    resource: `database:${database}`,
    requestId: ctx.requestId,
    metadata: { tableCount },
    success: true,
    ip: ctx.ip,
  });
}
