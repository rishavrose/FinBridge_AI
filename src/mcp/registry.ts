/**
 * MCP Tool Registry.
 *
 * The registry is the central catalogue of all MCP tools.
 * Tools register themselves at startup; the MCP server reads from here.
 * Dynamic tools generated from the DB schema are also registered here.
 */

import type {
  McpToolDefinition,
  McpToolContext,
  McpToolResult,
  Role,
} from '../types/index.js';
import { ToolNotFoundError } from '../utils/errors.js';
import { assertToolPermission } from '../auth/rbac.js';
import { getOrSet, CacheKeys } from '../cache/manager.js';
import { auditToolCall, auditToolSuccess, auditToolError } from '../audit/logger.js';
import { logger } from '../utils/logger.js';
import { createHash } from 'crypto';

// ─── Retry helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('read econnreset') ||
    msg.includes('epipe')
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  toolName: string,
  maxAttempts = 3,
  baseDelayMs = 400,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 400ms, 800ms
      logger.warn({ tool: toolName, attempt, delayMs: delay }, 'Tool call failed — retrying');
      recordToolRetry(toolName); // Rule 14: track retry count
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── Handler type ─────────────────────────────────────────────────────────────

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: McpToolContext,
) => Promise<unknown>;

interface RegisteredTool {
  definition: McpToolDefinition;
  handler: ToolHandler;
}

// ─── Tool health stats (Rules 9 + 14) ────────────────────────────────────────

export interface ToolHealthSnapshot {
  tool: string;
  successCount: number;
  failureCount: number;
  retryCount: number;
  timeoutCount: number;
  totalCallCount: number;
  successRate: number;     // 0–1
  avgLatencyMs: number;
  p95LatencyMs: number;
}

interface ToolStatsEntry {
  successCount: number;
  failureCount: number;
  retryCount: number;
  timeoutCount: number;
  latencies: number[];     // keep last 200 samples for percentile calc
}

const _toolStats = new Map<string, ToolStatsEntry>();

function getOrCreateStats(name: string): ToolStatsEntry {
  if (!_toolStats.has(name)) {
    _toolStats.set(name, { successCount: 0, failureCount: 0, retryCount: 0, timeoutCount: 0, latencies: [] });
  }
  return _toolStats.get(name)!;
}

function recordToolSuccess(name: string, durationMs: number): void {
  const s = getOrCreateStats(name);
  s.successCount++;
  s.latencies.push(durationMs);
  if (s.latencies.length > 200) s.latencies.shift();
}

function recordToolFailure(name: string, durationMs: number, isTimeout = false): void {
  const s = getOrCreateStats(name);
  s.failureCount++;
  if (isTimeout) s.timeoutCount++;
  s.latencies.push(durationMs);
  if (s.latencies.length > 200) s.latencies.shift();
}

function recordToolRetry(name: string): void {
  getOrCreateStats(name).retryCount++;
}

function p95(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

/** Returns a health snapshot for every registered tool that has been called. */
export function getToolHealthStats(): ToolHealthSnapshot[] {
  return [..._toolStats.entries()].map(([tool, s]) => {
    const total = s.successCount + s.failureCount;
    const avg = s.latencies.length
      ? Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length)
      : 0;
    return {
      tool,
      successCount: s.successCount,
      failureCount: s.failureCount,
      retryCount: s.retryCount,
      timeoutCount: s.timeoutCount,
      totalCallCount: total,
      successRate: total === 0 ? 1 : +(s.successCount / total).toFixed(4),
      avgLatencyMs: avg,
      p95LatencyMs: Math.round(p95(s.latencies)),
    };
  }).sort((a, b) => b.totalCallCount - a.totalCallCount);
}

// ─── Registry ─────────────────────────────────────────────────────────────────

class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /** Register a tool with its definition and async handler */
  register(definition: McpToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      logger.warn({ tool: definition.name }, 'Tool already registered — overwriting');
    }
    this.tools.set(definition.name, { definition, handler });
    logger.debug({ tool: definition.name }, 'MCP tool registered');
  }

  /** Unregister a single tool by name */
  unregister(name: string): boolean {
    const existed = this.tools.delete(name);
    if (existed) logger.debug({ tool: name }, 'MCP tool unregistered');
    return existed;
  }

  /** Unregister all tools whose name starts with the given prefix */
  unregisterByPrefix(prefix: string): string[] {
    const removed: string[] = [];
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        removed.push(name);
      }
    }
    if (removed.length) {
      logger.info({ prefix, removed }, 'MCP tools unregistered by prefix');
    }
    return removed;
  }

  /** List all tool definitions (optionally filtered by role) */
  listTools(callerRole?: Role): McpToolDefinition[] {
    return [...this.tools.values()]
      .filter(({ definition }) => {
        if (!callerRole) return true;
        return definition.permissions.includes(callerRole) ||
          definition.permissions.some((p) => {
            // Use role hierarchy: admin can see all, analyst can see analyst/readonly
            const levels: Record<Role, number> = { readonly: 1, analyst: 2, service: 3, admin: 4 };
            return levels[callerRole] >= levels[p];
          });
      })
      .map(({ definition }) => definition);
  }

  hasTools(): boolean {
    return this.tools.size > 0;
  }

  getToolCount(): number {
    return this.tools.size;
  }

  /** Execute a tool with full middleware stack: auth → cache → audit → handler */
  async executeTool(
    name: string,
    rawArgs: Record<string, unknown>,
    ctx: McpToolContext,
  ): Promise<McpToolResult> {
    const start = Date.now();

    // 1. Look up tool
    const entry = this.tools.get(name);
    if (!entry) throw new ToolNotFoundError(name);

    // 2. Permission check
    assertToolPermission(name, ctx.caller.role);

    // 3. Audit: record the call intent
    const auditCtx = {
      actorId: ctx.caller.id,
      actorRole: ctx.caller.role,
      actorName: ctx.caller.name,
      requestId: ctx.requestId,
    };
    auditToolCall(auditCtx, name, rawArgs);

    // 4. Cache check (if tool has a TTL configured)
    const cacheTtl = entry.definition.cacheTtl ?? 0;
    if (cacheTtl > 0) {
      const argsHash = createHash('sha256')
        .update(JSON.stringify(rawArgs))
        .digest('hex')
        .slice(0, 16);
      const cacheKey = CacheKeys.tool(name, argsHash);

      try {
        const { data, cached } = await getOrSet(
          cacheKey,
          () => withRetry(() => entry.handler(rawArgs, ctx) as Promise<unknown>, name),
          { ttl: cacheTtl, tags: [`tool:${name}`] },
        );

        const durationMs = Date.now() - start;
        if (!cached) {
          auditToolSuccess(auditCtx, name, durationMs);
          recordToolSuccess(name, durationMs);
        }

        return {
          data,
          cached,
          executionMs: durationMs,
          rowCount: Array.isArray(data) ? data.length : undefined,
        };
      } catch (err) {
        const durationMs = Date.now() - start;
        const errorCode = (err as Error).name;
        auditToolError(auditCtx, name, errorCode, durationMs);
        recordToolFailure(name, durationMs, errorCode === 'ETIMEDOUT' || errorCode === 'TimeoutError');
        throw err;
      }
    }

    // 5. No cache — execute with retry
    try {
      const data = await withRetry(() => entry.handler(rawArgs, ctx), name);
      const durationMs = Date.now() - start;
      auditToolSuccess(auditCtx, name, durationMs, Array.isArray(data) ? data.length : undefined);
      recordToolSuccess(name, durationMs);

      return {
        data,
        cached: false,
        executionMs: durationMs,
        rowCount: Array.isArray(data) ? data.length : undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorCode = (err as Error).name;
      auditToolError(auditCtx, name, errorCode, durationMs);
      recordToolFailure(name, durationMs, errorCode === 'ETIMEDOUT' || errorCode === 'TimeoutError');
      throw err;
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const toolRegistry = new ToolRegistry();
