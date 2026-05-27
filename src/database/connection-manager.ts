/**
 * Dynamic Database Connection Manager
 *
 * Manages tenant-scoped MySQL connections with:
 *  - AES-256-GCM credential encryption
 *  - Per-tenant read-only connection pools
 *  - Schema scanning and dynamic tool generation
 *  - Redis-backed credential store with TTL
 */

import mysql from 'mysql2/promise';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getRedisClient } from '../cache/client.js';
import { logger } from '../utils/logger.js';
import { toolRegistry } from '../mcp/registry.js';
import { registerToolPermission } from '../auth/rbac.js';
import { buildSelectQuery } from './query-builder.js';
import type { QueryCondition } from '../types/index.js';
import { slugify } from '../utils/helpers.js';
import { env } from '../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbConnectionConfig {
  id?: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  name?: string;          // human-readable label
  tenantId?: string;      // caller's user/tenant ID
  selectedTables?: string[];
}

export interface EncryptedCredential {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  encryptedUsername: string;
  encryptedPassword: string;
  ssl: boolean;
  tenantId: string;
  createdAt: string;
  selectedTables?: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  serverVersion?: string;
  error?: string;
  tablesFound?: number;
  tables?: string[];
}

export interface GeneratedToolSummary {
  connectionId: string;
  database: string;
  tablesDiscovered: string[];
  toolsGenerated: string[];
  generatedAt: string;
}

// ─── Encryption helpers (AES-256-GCM) ────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function deriveKey(secret: string): Buffer {
  // Stretch the secret to exactly 32 bytes using SHA-256
  return createHash('sha256').update(secret).digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(hex):tag(hex):ciphertext(hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string, secret: string): string {
  const key = deriveKey(secret);
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted credential format');
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

// ─── Get encryption secret ────────────────────────────────────────────────────

function getEncryptionSecret(): string {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters');
  }
  return secret;
}

// ─── Redis key helpers ────────────────────────────────────────────────────────

const REDIS_PREFIX = 'finbridge:dbconn:';
const REDIS_INDEX_KEY = 'finbridge:dbconn:index';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function connKey(id: string): string {
  return `${REDIS_PREFIX}${id}`;
}

// ─── Pool registry (in-process) ──────────────────────────────────────────────

const poolRegistry = new Map<string, mysql.Pool>();

function getOrCreatePool(id: string, config: DbConnectionConfig): mysql.Pool {
  if (poolRegistry.has(id)) return poolRegistry.get(id)!;

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionLimit: 5,
    waitForConnections: true,
    connectTimeout: 15000,
    multipleStatements: false,
    timezone: '+00:00',
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });

  poolRegistry.set(id, pool);
  return pool;
}

/**
 * Run a query against a specific dynamic connection's pool.
 * Throws if the connection ID isn't registered.
 */
export async function executeOnConnection<T = Record<string, unknown>>(
  connectionId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const config = await getStoredConnection(connectionId);
  if (!config) {
    throw new Error(`Connection ${connectionId} is not registered`);
  }
  const pool = getOrCreatePool(connectionId, config);
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params as mysql.ExecuteValues);
  return rows as T[];
}

/**
 * Find the first registered connection whose database contains BOTH of the
 * given tables. Returns null if no connection has them.
 * Used by analytics widgets that need to find the right tenant DB for
 * cross-table joins like tbl_payouts × tbl_bank_lists.
 */
export async function findConnectionWithTables(
  tables: string[],
): Promise<string | null> {
  const conns = await listStoredConnections();
  for (const meta of conns) {
    try {
      const config = await getStoredConnection(meta.id);
      if (!config) continue;
      const pool = getOrCreatePool(meta.id, config);
      const placeholders = tables.map(() => '?').join(',');
      const [rows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
        tables,
      );
      const found = new Set(rows.map((r) => String(r.table_name ?? r.TABLE_NAME).toLowerCase()));
      const wanted = tables.map((t) => t.toLowerCase());
      if (wanted.every((t) => found.has(t))) return meta.id;
    } catch {
      // Skip unreachable connections and keep scanning
    }
  }
  return null;
}

export async function releasePool(id: string): Promise<void> {
  const pool = poolRegistry.get(id);
  if (pool) {
    await pool.end().catch(() => {});
    poolRegistry.delete(id);
  }
}

// ─── Test Connection ──────────────────────────────────────────────────────────

export async function testDbConnection(
  config: DbConnectionConfig,
): Promise<ConnectionTestResult> {
  const start = Date.now();
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectTimeout: 10000,
      multipleStatements: false,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });

    const [rows] = await conn.execute<mysql.RowDataPacket[]>('SELECT VERSION() AS v');
    const serverVersion = (rows[0] as { v: string }).v;

    // List tables in the target database
    const [tableRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [config.database],
    );
    const tables = (tableRows as Array<{ name: string }>).map((r) => r.name);

    return {
      success: true,
      latencyMs: Date.now() - start,
      serverVersion,
      tablesFound: tables.length,
      tables,
    };
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// ─── Store Connection ─────────────────────────────────────────────────────────

export async function storeConnection(
  config: DbConnectionConfig,
  tenantId: string,
): Promise<EncryptedCredential> {
  const secret = getEncryptionSecret();
  const id = config.id ?? uuidv4();

  const credential: EncryptedCredential = {
    id,
    name: config.name ?? `${config.database}@${config.host}`,
    host: config.host,
    port: config.port,
    database: config.database,
    encryptedUsername: encrypt(config.username, secret),
    encryptedPassword: encrypt(config.password, secret),
    ssl: config.ssl,
    tenantId,
    createdAt: new Date().toISOString(),
    selectedTables: config.selectedTables,
  };

  const redis = getRedisClient();
  await redis.set(connKey(id), JSON.stringify(credential), 'EX', TTL_SECONDS);
  await redis.sadd(REDIS_INDEX_KEY, id);

  logger.info({ connectionId: id, database: config.database, tenantId }, 'DB connection stored');
  return credential;
}

// ─── Get Connection (decrypt) ─────────────────────────────────────────────────

export async function getStoredConnection(id: string): Promise<DbConnectionConfig | null> {
  const redis = getRedisClient();
  const raw = await redis.get(connKey(id));
  if (!raw) return null;

  const cred = JSON.parse(raw) as EncryptedCredential;
  const secret = getEncryptionSecret();

  return {
    id: cred.id,
    host: cred.host,
    port: cred.port,
    database: cred.database,
    username: decrypt(cred.encryptedUsername, secret),
    password: decrypt(cred.encryptedPassword, secret),
    ssl: cred.ssl,
    name: cred.name,
    tenantId: cred.tenantId,
    selectedTables: cred.selectedTables,
  };
}

// ─── List Connections (metadata only — no credentials) ───────────────────────

export async function listStoredConnections(): Promise<Omit<EncryptedCredential, 'encryptedUsername' | 'encryptedPassword'>[]> {
  const redis = getRedisClient();
  const ids = await redis.smembers(REDIS_INDEX_KEY);
  if (!ids.length) return [];

  const results: Omit<EncryptedCredential, 'encryptedUsername' | 'encryptedPassword'>[] = [];
  for (const id of ids) {
    const raw = await redis.get(connKey(id));
    if (!raw) {
      await redis.srem(REDIS_INDEX_KEY, id);
      continue;
    }
    const { encryptedUsername: _u, encryptedPassword: _p, ...safe } = JSON.parse(raw) as EncryptedCredential;
    results.push(safe);
  }
  return results;
}

// ─── Remove Connection ────────────────────────────────────────────────────────

export async function removeConnection(id: string): Promise<boolean> {
  const redis = getRedisClient();

  // Fetch metadata before deleting so we know the database name
  const raw = await redis.get(connKey(id));
  let database: string | null = null;
  if (raw) {
    const cred = JSON.parse(raw) as EncryptedCredential;
    database = cred.database;
  }

  const deleted = await redis.del(connKey(id));
  await redis.srem(REDIS_INDEX_KEY, id);
  await releasePool(id);

  // Unregister all dynamic tools generated for this connection
  if (database) {
    const prefix = `query_${slugify(database)}_`;
    toolRegistry.unregisterByPrefix(prefix);
  }

  return deleted > 0;
}

// ─── Scan Schema via stored connection ───────────────────────────────────────

interface ScannedTable {
  name: string;
  rowCount: number;
  comment: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    key: string;
    comment: string;
  }>;
}

export async function scanConnectionSchema(id: string): Promise<ScannedTable[]> {
  const config = await getStoredConnection(id);
  if (!config) throw new Error(`Connection ${id} not found`);

  const pool = getOrCreatePool(id, config);
  const [tableRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS name, COALESCE(TABLE_ROWS, 0) AS rowCount,
            COALESCE(TABLE_COMMENT, '') AS comment
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [config.database],
  );

  const tables: ScannedTable[] = [];
  for (const row of tableRows as Array<{ name: string; rowCount: number; comment: string }>) {
    const [colRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type,
              IS_NULLABLE AS nullable, COLUMN_KEY AS \`key\`,
              COALESCE(COLUMN_COMMENT, '') AS comment
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [config.database, row.name],
    );
    tables.push({
      name: row.name,
      rowCount: row.rowCount,
      comment: row.comment,
      columns: (colRows as Array<{ name: string; type: string; nullable: string; key: string; comment: string }>).map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === 'YES',
        key: c.key,
        comment: c.comment,
      })),
    });
  }
  return tables;
}

// ─── Generate & Register Dynamic Tools ───────────────────────────────────────

function mysqlTypeToJsonType(mysqlType: string): string {
  const t = mysqlType.toLowerCase();
  if (['int', 'bigint', 'smallint', 'tinyint', 'mediumint'].some((k) => t.startsWith(k))) return 'integer';
  if (['decimal', 'float', 'double', 'numeric'].some((k) => t.startsWith(k))) return 'number';
  if (['bool', 'boolean'].some((k) => t.startsWith(k))) return 'boolean';
  return 'string';
}

export async function generateToolsForConnection(id: string, selectedTables?: string[]): Promise<GeneratedToolSummary> {
  const config = await getStoredConnection(id);
  if (!config) throw new Error(`Connection ${id} not found`);

  // Unregister ALL previously generated tools for this connection before re-generating
  const prefix = `query_${slugify(config.database)}_`;
  const removed = toolRegistry.unregisterByPrefix(prefix);
  if (removed.length) {
    logger.info({ connectionId: id, removed }, 'Unregistered old tools before refresh');
  }

  const allTables = await scanConnectionSchema(id);
  // Filter to only selected tables (if specified), otherwise use stored selection, then all
  const filter = selectedTables ?? config.selectedTables;
  const tables = filter && filter.length > 0
    ? allTables.filter((t) => filter.includes(t.name))
    : allTables;
  const pool = getOrCreatePool(id, config);
  const toolsGenerated: string[] = [];

  for (const table of tables) {
    const toolName = `query_${slugify(config.database)}_${slugify(table.name)}`;
    const allowedColumns = new Set(table.columns.map((c) => c.name));

    const filterProps: Record<string, unknown> = {};
    for (const col of table.columns) {
      filterProps[col.name] = {
        type: mysqlTypeToJsonType(col.type),
        description: col.comment || `Filter by ${col.name} (${col.type})`,
      };
    }

    const hasAddeddate = allowedColumns.has('addeddate');
    const hasAmount = allowedColumns.has('amount');
    const hasStatus = allowedColumns.has('status');
    const todayStr = new Date().toISOString().slice(0, 10);

    const usageHints: string[] = [];
    if (hasAddeddate) usageHints.push(`For "today" use filters.addeddate="${todayStr}".`);
    if (hasStatus) usageHints.push('status codes: 1=success, 2=initiated, 4=failed, 6=pending, 8=reversed.');
    if (hasAmount) usageHints.push('For count+amount totals use aggregate={count:true,sum:"amount"} — NEVER fetch rows to count.');
    const description = [
      table.comment || `Query \`${config.database}\`.\`${table.name}\` table.`,
      ...usageHints,
    ].join(' ');

    toolRegistry.register(
      {
        name: toolName,
        description,
        inputSchema: {
          type: 'object',
          properties: {
            filters: {
              type: 'object',
              description:
                'Equality filters (WHERE col = val). ' +
                (hasAddeddate ? `For date "today" set addeddate="${todayStr}". ` : '') +
                (hasStatus ? 'For "successful" set status=1, "failed" set status=4, "pending" set status=6. ' : '') +
                'You MUST include relevant filters when the user mentions a date, status, or any specific value.',
              properties: filterProps,
              additionalProperties: false,
            },
            filterRanges: {
              type: 'array',
              description: 'Range filters for date/numeric columns. Use for "between A and B" queries.',
              items: {
                type: 'object',
                properties: {
                  column: { type: 'string', description: 'Column name to filter on' },
                  from: { type: 'string', description: 'Start value inclusive, e.g. "2026-04-01 00:00:00"' },
                  to: { type: 'string', description: 'End value inclusive, e.g. "2026-04-30 23:59:59"' },
                },
                required: ['column'],
                additionalProperties: false,
              },
            },
            columns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Columns to return (default: all)',
            },
            orderBy: {
              type: 'string',
              enum: table.columns.map((c) => c.name),
              description: 'Sort column',
            },
            orderDir: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            aggregate: {
              type: 'object',
              description:
                'REQUIRED for any "how many", "count", "total", "sum", "average" question — even if combined with date/status filters. ' +
                'Returns exact figures via SQL COUNT/SUM/AVG. NEVER fetch rows just to count them. ' +
                (hasAmount ? `Example for "today's successful payout count and total amount": filters={addeddate:"${todayStr}",status:1}, aggregate={count:true,sum:"amount"}.` : ''),
              properties: {
                count: { type: 'boolean', description: 'Return total matching row count' },
                sum: { type: 'string', description: 'Column name to SUM (e.g. "amount")' },
                avg: { type: 'string', description: 'Column name to AVG (e.g. "amount")' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        permissions: ['readonly', 'analyst', 'service', 'admin'],
        cacheTtl: env.CACHE_TTL_DEFAULT,
      },
      async (args) => {
        const filters = (args.filters as Record<string, unknown>) ?? {};
        const requestedCols = Array.isArray(args.columns)
          ? (args.columns as string[]).filter((c) => allowedColumns.has(c))
          : ['*'];
        const orderBy =
          typeof args.orderBy === 'string' && allowedColumns.has(args.orderBy)
            ? args.orderBy
            : undefined;
        const orderDir = args.orderDir === 'ASC' ? 'ASC' : 'DESC';
        const limit = Math.min(Number(args.limit ?? 50), 1000);
        const offset = Math.max(Number(args.offset ?? 0), 0);

        const conditions: QueryCondition[] = Object.entries(filters)
          .filter(([col]) => allowedColumns.has(col))
          .map(([col, value]) => ({ column: col, operator: '=' as const, value }));

        // Process filterRanges (date/numeric range filters)
        const filterRanges = Array.isArray(args.filterRanges)
          ? (args.filterRanges as Array<{ column: string; from?: string; to?: string }>)
          : [];
        for (const range of filterRanges) {
          if (!allowedColumns.has(range.column)) continue;
          if (range.from !== undefined) conditions.push({ column: range.column, operator: '>=' as const, value: range.from });
          if (range.to !== undefined) conditions.push({ column: range.column, operator: '<=' as const, value: range.to });
        }

        const agg = args.aggregate as { count?: boolean; sum?: string; avg?: string } | undefined;
        if (agg && (agg.count || agg.sum || agg.avg)) {
          const selectParts: string[] = [];
          if (agg.count) selectParts.push('COUNT(*) AS `count`');
          if (agg.sum && allowedColumns.has(agg.sum)) selectParts.push(`SUM(\`${agg.sum}\`) AS \`sum_${agg.sum}\``);
          if (agg.avg && allowedColumns.has(agg.avg)) selectParts.push(`AVG(\`${agg.avg}\`) AS \`avg_${agg.avg}\``);

          const whereClause = conditions.length
            ? 'WHERE ' + conditions.map((c) => `\`${c.column}\` ${c.operator} ?`).join(' AND ')
            : '';
          const aggParams = conditions.map((c) => c.value);
          const aggSql = `SELECT ${selectParts.join(', ')} FROM \`${table.name}\` ${whereClause}`;
          const [aggRows] = await pool.execute<mysql.RowDataPacket[]>(aggSql, aggParams as mysql.ExecuteValues);
          return { result: aggRows[0] ?? {}, table: table.name, _sql: aggSql, _params: aggParams };
        }

        const { sql, params } = buildSelectQuery({
          table: table.name,
          columns: requestedCols,
          conditions,
          orderBy: orderBy ? { column: orderBy, direction: orderDir } : undefined,
          limit,
          offset,
        });

        const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params as mysql.ExecuteValues);
        return { rows, total: rows.length, table: table.name, _sql: sql, _params: params };
      },
    );

    registerToolPermission(toolName, 'readonly');
    toolsGenerated.push(toolName);
    logger.debug({ tool: toolName, table: table.name, connectionId: id }, 'Dynamic tool registered');
  }

  // Persist the active selectedTables back to Redis so it survives restarts
  if (selectedTables !== undefined) {
    const redis = getRedisClient();
    const raw = await redis.get(connKey(id));
    if (raw) {
      const cred = JSON.parse(raw) as EncryptedCredential;
      cred.selectedTables = tables.map((t) => t.name);
      const ttl = await redis.ttl(connKey(id));
      if (ttl > 0) {
        await redis.set(connKey(id), JSON.stringify(cred), 'EX', ttl);
      } else {
        await redis.set(connKey(id), JSON.stringify(cred), 'EX', TTL_SECONDS);
      }
    }
  }

  logger.info(
    { connectionId: id, database: config.database, count: toolsGenerated.length },
    'Dynamic tools generated for connection',
  );

  return {
    connectionId: id,
    database: config.database,
    tablesDiscovered: tables.map((t) => t.name),
    toolsGenerated,
    generatedAt: new Date().toISOString(),
  };
}
