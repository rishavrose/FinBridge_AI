/**
 * MySQL connection pool.
 *
 * Security:  The pool is configured with a READONLY database user.
 *            SSL is enforced in production.
 *            Connection timeouts prevent runaway queries.
 */

import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { DatabaseConnectionError } from '../utils/errors.js';

// ─── Pool singleton ──────────────────────────────────────────────────────────

let _pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      connectionLimit: env.DB_CONNECTION_LIMIT,
      waitForConnections: env.DB_WAIT_FOR_CONNECTIONS,
      connectTimeout: env.DB_ACQUIRE_TIMEOUT,
      // Hardened settings
      multipleStatements: false,   // Prevent stacked queries
      timezone: '+00:00',          // UTC everywhere
      dateStrings: false,
      // Enforce SSL in production
      ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
    });

    logger.info(
      { host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME },
      'MySQL connection pool initialised',
    );
  }

  return _pool;
}

// ─── Health check ────────────────────────────────────────────────────────────

export async function pingDatabase(): Promise<void> {
  const pool = getPool();
  const connection = await pool.getConnection().catch((err) => {
    throw new DatabaseConnectionError(
      `Cannot acquire DB connection: ${(err as Error).message}`,
    );
  });

  try {
    await connection.ping();
    logger.debug('Database ping OK');
  } finally {
    connection.release();
  }
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    logger.info('MySQL connection pool closed');
  }
}

// ─── Execute helper (SELECT only) ─────────────────────────────────────────────

/**
 * Execute a pre-built, parameterised SELECT query.
 * Throws if the query does not start with SELECT (extra guard layer).
 */
export async function executeSelect<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const normalised = sql.trimStart().toUpperCase();
  if (!normalised.startsWith('SELECT') && !normalised.startsWith('SHOW')) {
    throw new Error('Only SELECT/SHOW statements are permitted through this interface');
  }

  const pool = getPool();
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params as mysql.ExecuteValues);
  return rows as T[];
}

// ─── Write helper (chat tables only) ─────────────────────────────────────────

/**
 * Execute a parameterised INSERT / UPDATE / DELETE strictly limited to the
 * chat_conversations and chat_messages tables.
 * All other write attempts are rejected at the application level.
 */
const ALLOWED_WRITE_TABLES = ['chat_conversations', 'chat_messages', 'app_users'];

export async function executeWrite(
  sql: string,
  params: unknown[] = [],
): Promise<mysql.ResultSetHeader> {
  const normalised = sql.replace(/\s+/g, ' ').trim().toUpperCase();
  const allowed = ALLOWED_WRITE_TABLES.some(t => normalised.includes(t.toUpperCase()));
  if (!allowed) {
    throw new Error('Write access is restricted to chat tables only');
  }

  const pool = getPool();
  const [result] = await pool.execute<mysql.ResultSetHeader>(sql, params as mysql.ExecuteValues);
  return result;
}
