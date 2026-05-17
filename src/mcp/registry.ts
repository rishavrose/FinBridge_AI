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

// ─── Handler type ─────────────────────────────────────────────────────────────

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: McpToolContext,
) => Promise<unknown>;

interface RegisteredTool {
  definition: McpToolDefinition;
  handler: ToolHandler;
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
          () => entry.handler(rawArgs, ctx) as Promise<unknown>,
          { ttl: cacheTtl, tags: [`tool:${name}`] },
        );

        const durationMs = Date.now() - start;
        if (!cached) auditToolSuccess(auditCtx, name, durationMs);

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
        throw err;
      }
    }

    // 5. No cache — execute directly
    try {
      const data = await entry.handler(rawArgs, ctx);
      const durationMs = Date.now() - start;
      auditToolSuccess(auditCtx, name, durationMs, Array.isArray(data) ? data.length : undefined);

      return {
        data,
        cached: false,
        executionMs: durationMs,
        rowCount: Array.isArray(data) ? data.length : undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      auditToolError(auditCtx, name, (err as Error).name, durationMs);
      throw err;
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const toolRegistry = new ToolRegistry();
