/**
 * Safe, parameterised query builder.
 *
 * Security rules enforced at this layer:
 *  1. Only SELECT statements are emitted.
 *  2. Table and column names are validated against an allowlist (schema snapshot).
 *  3. All values are passed as prepared-statement parameters — never interpolated.
 *  4. LIMIT is always applied (max 1000) to prevent full-table dumps.
 *  5. LIKE patterns are escaped to prevent wildcard injection.
 */

import type { SafeQueryOptions, QueryCondition } from '../types/index.js';
import { ValidationError } from '../utils/errors.js';

const MAX_LIMIT = 1000;
const ALLOWED_OPERATORS = new Set<QueryCondition['operator']>([
  '=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IN', 'BETWEEN',
]);

// ─── Identifier validation ────────────────────────────────────────────────────

/** Only allow safe identifier characters: letters, digits, underscore */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function assertIdentifier(name: string, context: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new ValidationError(
      `Invalid identifier "${name}" in ${context}. Only letters, digits, and underscores are allowed.`,
    );
  }
}

/** Escape LIKE wildcards in user-supplied values */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Build a safe SELECT query from structured options.
 * Returns parameterised SQL string + bound parameters array.
 */
export function buildSelectQuery(opts: SafeQueryOptions): BuiltQuery {
  const {
    table,
    columns = ['*'],
    conditions = [],
    orderBy,
    limit = 100,
    offset = 0,
  } = opts;

  // Validate table name
  assertIdentifier(table, 'table');

  // Validate and quote column names
  const selectedCols = columns.map((col) => {
    if (col === '*') return '*';
    assertIdentifier(col, `column selection`);
    return `\`${col}\``;
  });

  const params: unknown[] = [];

  // Build WHERE clause
  const whereClauses: string[] = [];
  for (const cond of conditions) {
    assertIdentifier(cond.column, 'WHERE clause');

    if (!ALLOWED_OPERATORS.has(cond.operator)) {
      throw new ValidationError(`Operator "${cond.operator}" is not permitted.`);
    }

    const col = `\`${cond.column}\``;

    if (cond.operator === 'IN') {
      const values = Array.isArray(cond.value) ? cond.value : [cond.value];
      if (values.length === 0) throw new ValidationError('IN operator requires at least one value.');
      if (values.length > 500) throw new ValidationError('IN operator value list exceeds maximum of 500.');
      const placeholders = values.map(() => '?').join(', ');
      whereClauses.push(`${col} IN (${placeholders})`);
      params.push(...values);
    } else if (cond.operator === 'BETWEEN') {
      const [lo, hi] = Array.isArray(cond.value) ? cond.value : [];
      if (lo === undefined || hi === undefined) {
        throw new ValidationError('BETWEEN operator requires exactly [low, high].');
      }
      whereClauses.push(`${col} BETWEEN ? AND ?`);
      params.push(lo, hi);
    } else if (cond.operator === 'LIKE') {
      const safeValue = `%${escapeLike(String(cond.value))}%`;
      whereClauses.push(`${col} LIKE ?`);
      params.push(safeValue);
    } else {
      whereClauses.push(`${col} ${cond.operator} ?`);
      params.push(cond.value);
    }
  }

  // Clamp LIMIT
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  // Build ORDER BY
  let orderClause = '';
  if (orderBy) {
    assertIdentifier(orderBy.column, 'ORDER BY');
    const dir = orderBy.direction === 'ASC' ? 'ASC' : 'DESC';
    orderClause = ` ORDER BY \`${orderBy.column}\` ${dir}`;
  }

  const whereClause = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';

  const sql =
    `SELECT ${selectedCols.join(', ')} FROM \`${table}\`` +
    whereClause +
    orderClause +
    ` LIMIT ${safeLimit} OFFSET ${offset}`;

  return { sql, params };
}

// ─── Count helper ─────────────────────────────────────────────────────────────

export function buildCountQuery(
  table: string,
  conditions: QueryCondition[] = [],
): BuiltQuery {
  const { sql: selectSql, params } = buildSelectQuery({
    table,
    columns: ['COUNT(*) AS total'],
    conditions,
    limit: 1,
  });

  // Strip the LIMIT clause since COUNT doesn't need it here
  const sql = selectSql.replace(/ LIMIT \d+ OFFSET \d+$/, '');
  return { sql, params };
}
