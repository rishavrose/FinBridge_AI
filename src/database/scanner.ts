/**
 * Database schema scanner.
 *
 * Reads MySQL information_schema (read-only, no data access) to discover
 * tables and columns.  Results are cached in Redis to avoid repeated
 * information_schema queries on every request.
 */

import { executeSelect } from './client.js';
import type { TableInfo, ColumnInfo, SchemaSnapshot } from '../types/index.js';
import { SchemaInspectionError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// ─── Queries (parameterised — no interpolation) ───────────────────────────────

const TABLE_QUERY = `
  SELECT
    t.TABLE_NAME      AS name,
    t.TABLE_SCHEMA    AS \`schema\`,
    t.ENGINE          AS engine,
    t.TABLE_ROWS      AS rowCount,
    COALESCE(t.TABLE_COMMENT, '') AS comment
  FROM information_schema.TABLES t
  WHERE t.TABLE_SCHEMA = ?
    AND t.TABLE_TYPE = 'BASE TABLE'
  ORDER BY t.TABLE_NAME
`;

const COLUMN_QUERY = `
  SELECT
    c.COLUMN_NAME     AS name,
    c.DATA_TYPE       AS type,
    c.IS_NULLABLE     AS nullable,
    c.COLUMN_KEY      AS \`key\`,
    c.COLUMN_DEFAULT  AS defaultValue,
    c.EXTRA           AS extra,
    COALESCE(c.COLUMN_COMMENT, '') AS comment
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = ?
    AND c.TABLE_NAME   = ?
  ORDER BY c.ORDINAL_POSITION
`;

// ─── Raw DB row types ─────────────────────────────────────────────────────────

interface RawTable {
  name: string;
  schema: string;
  engine: string;
  rowCount: number;
  comment: string;
}

interface RawColumn {
  name: string;
  type: string;
  nullable: 'YES' | 'NO';
  key: 'PRI' | 'MUL' | 'UNI' | '';
  defaultValue: string | null;
  extra: string;
  comment: string;
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

export async function scanSchema(database?: string): Promise<SchemaSnapshot> {
  const dbName = database ?? env.DB_NAME;
  logger.info({ database: dbName }, 'Scanning database schema');

  let rawTables: RawTable[];
  try {
    rawTables = await executeSelect<RawTable>(TABLE_QUERY, [dbName]);
  } catch (err) {
    throw new SchemaInspectionError(
      `Failed to read table list: ${(err as Error).message}`,
    );
  }

  const tables: TableInfo[] = await Promise.all(
    rawTables.map(async (t) => {
      const rawCols = await executeSelect<RawColumn>(COLUMN_QUERY, [dbName, t.name]).catch(
        (err) => {
          logger.warn({ table: t.name, err }, 'Failed to read columns for table');
          return [] as RawColumn[];
        },
      );

      const columns: ColumnInfo[] = rawCols.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === 'YES',
        key: c.key,
        defaultValue: c.defaultValue,
        extra: c.extra,
        comment: c.comment,
      }));

      return {
        name: t.name,
        schema: t.schema,
        engine: t.engine ?? 'InnoDB',
        rowCount: Number(t.rowCount ?? 0),
        comment: t.comment,
        columns,
      } satisfies TableInfo;
    }),
  );

  logger.info(
    { database: dbName, tableCount: tables.length },
    'Schema scan complete',
  );

  return {
    database: dbName,
    capturedAt: new Date(),
    tables,
  };
}

// ─── Column type → JSON Schema type ──────────────────────────────────────────

/**
 * Map MySQL column types to JSON Schema primitives.
 * Used by the tool generator to produce typed input schemas.
 */
export function mysqlTypeToJsonSchema(mysqlType: string): Record<string, unknown> {
  const t = mysqlType.toLowerCase();

  if (['tinyint', 'smallint', 'mediumint', 'int', 'bigint'].some((k) => t.startsWith(k))) {
    return { type: 'integer' };
  }
  if (['decimal', 'float', 'double', 'numeric'].some((k) => t.startsWith(k))) {
    return { type: 'number' };
  }
  if (['datetime', 'timestamp'].some((k) => t.startsWith(k))) {
    return { type: 'string', format: 'date-time' };
  }
  if (t.startsWith('date')) {
    return { type: 'string', format: 'date' };
  }
  if (['tinyint(1)', 'boolean', 'bool'].includes(t)) {
    return { type: 'boolean' };
  }
  if (['json'].includes(t)) {
    return { type: 'object' };
  }
  if (['enum', 'set'].some((k) => t.startsWith(k))) {
    // Parse enum values from type string e.g. enum('a','b','c')
    const match = t.match(/\(([^)]+)\)/);
    if (match) {
      const values = match[1].split(',').map((v) => v.replace(/'/g, '').trim());
      return { type: 'string', enum: values };
    }
  }

  // Default: string
  return { type: 'string' };
}
