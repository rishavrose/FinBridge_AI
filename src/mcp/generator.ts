/**
 * Dynamic MCP tool generator.
 *
 * Scans the database schema and auto-generates MCP tools for each table.
 * Each generated tool exposes a safe, parameterised SELECT interface for
 * that table — no raw SQL, no write operations.
 *
 * Generated tool name convention:  query_{table_name}
 */

import { scanSchema, mysqlTypeToJsonSchema } from '../database/scanner.js';
import { buildSelectQuery } from '../database/query-builder.js';
import { executeSelect } from '../database/client.js';
import { toolRegistry } from './registry.js';
import { registerToolPermission } from '../auth/rbac.js';
import { getOrSet, CacheKeys } from '../cache/manager.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { slugify } from '../utils/helpers.js';
import type { McpToolDefinition, SchemaSnapshot, TableInfo } from '../types/index.js';

// ─── Table → Tool ─────────────────────────────────────────────────────────────

function tableToToolDefinition(table: TableInfo): McpToolDefinition {
  const toolName = `query_${slugify(table.name)}`;

  // Build filter properties from columns
  const filterProperties: Record<string, unknown> = {};
  for (const col of table.columns) {
    filterProperties[col.name] = {
      ...mysqlTypeToJsonSchema(col.type),
      description: col.comment || `Filter by ${col.name} (${col.type})`,
    };
  }

  return {
    name: toolName,
    description:
      table.comment ||
      `Query the \`${table.name}\` table with optional filters, sorting, and pagination.`,
    inputSchema: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          description: 'Key-value filters applied as WHERE column = value',
          properties: filterProperties,
          additionalProperties: false,
        },
        filterRanges: {
          type: 'array',
          description: 'Range filters for date/numeric columns. Use for queries like "on date X" or "between date A and B".',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string', description: 'Column name to filter on' },
              from: { type: 'string', description: 'Start value (inclusive), e.g. "2026-05-12 00:00:00"' },
              to: { type: 'string', description: 'End value (inclusive), e.g. "2026-05-12 23:59:59"' },
            },
            required: ['column'],
            additionalProperties: false,
          },
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific columns to return (default: all)',
        },
        orderBy: {
          type: 'string',
          description: 'Column to sort by',
          enum: table.columns.map((c) => c.name),
        },
        orderDir: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          default: 'DESC',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          default: 50,
          description: 'Number of rows to return',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Pagination offset',
        },
      },
      additionalProperties: false,
    },
    permissions: ['readonly', 'analyst', 'service', 'admin'],
    cacheTtl: env.CACHE_TTL_DEFAULT,
  };
}

// ─── Handler factory ──────────────────────────────────────────────────────────

function createTableHandler(table: TableInfo) {
  const allowedColumns = new Set(table.columns.map((c) => c.name));

  return async (args: Record<string, unknown>) => {
    const filters = (args.filters as Record<string, unknown>) ?? {};
    const requestedCols = Array.isArray(args.columns)
      ? (args.columns as string[]).filter((c) => allowedColumns.has(c))
      : ['*'];
    const orderBy = typeof args.orderBy === 'string' && allowedColumns.has(args.orderBy)
      ? args.orderBy
      : undefined;
    const orderDir = args.orderDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = Math.min(Number(args.limit ?? 50), 1000);
    const offset = Math.max(Number(args.offset ?? 0), 0);

    // Convert flat filter object → QueryCondition array
    const conditions: Parameters<typeof buildSelectQuery>[0]['conditions'] = Object.entries(filters)
      .filter(([col]) => allowedColumns.has(col))
      .map(([col, value]) => ({
        column: col,
        operator: '=' as const,
        value,
      }));

    // Convert filterRanges → >= / <= conditions
    const filterRanges = Array.isArray(args.filterRanges)
      ? (args.filterRanges as Array<{ column: string; from?: string; to?: string }>)
      : [];
    for (const range of filterRanges) {
      if (!allowedColumns.has(range.column)) continue;
      if (range.from !== undefined) {
        conditions.push({ column: range.column, operator: '>=', value: range.from });
      }
      if (range.to !== undefined) {
        conditions.push({ column: range.column, operator: '<=', value: range.to });
      }
    }

    const { sql, params } = buildSelectQuery({
      table: table.name,
      columns: requestedCols,
      conditions,
      orderBy: orderBy ? { column: orderBy, direction: orderDir } : undefined,
      limit,
      offset,
    });

    const rows = await executeSelect(sql, params);
    return { rows, total: rows.length, table: table.name };
  };
}

// ─── Generator ────────────────────────────────────────────────────────────────

export async function generateToolsFromSchema(database?: string): Promise<number> {
  const dbName = database ?? env.DB_NAME;

  logger.info({ database: dbName }, 'Generating MCP tools from schema');

  // Load schema (with Redis cache)
  const { data: schema } = await getOrSet<SchemaSnapshot>(
    CacheKeys.schema(dbName),
    () => scanSchema(dbName),
    { ttl: env.CACHE_TTL_SCHEMA, tags: [`schema:${dbName}`] },
  );

  let generated = 0;

  for (const table of schema.tables) {
    const definition = tableToToolDefinition(table);
    const handler = createTableHandler(table);

    toolRegistry.register(definition, handler);
    registerToolPermission(definition.name, 'readonly');
    generated++;
  }

  logger.info(
    { database: dbName, toolsGenerated: generated },
    'Dynamic tool generation complete',
  );

  return generated;
}

/** Re-generate tools after a schema change (invalidates cache first) */
export async function refreshTools(database?: string): Promise<number> {
  const { invalidateByTag } = await import('../cache/manager.js');
  const dbName = database ?? env.DB_NAME;
  await invalidateByTag(`schema:${dbName}`);
  return generateToolsFromSchema(dbName);
}
