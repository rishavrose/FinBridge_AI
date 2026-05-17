/**
 * General utility helpers used across the application.
 */

import { createHash, randomBytes } from 'crypto';

// ─── String helpers ───────────────────────────────────────────────────────────

/** Convert snake_case or camelCase to a human-readable label */
export function toLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Slugify a string for use as a tool or key name */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

/** Generate a cryptographically secure random token */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** SHA-256 hash a value with an optional salt */
export function hashValue(value: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

// ─── Object helpers ───────────────────────────────────────────────────────────

/** Strip undefined values from an object */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Safely parse JSON without throwing */
export function safeJson<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

// ─── Async helpers ────────────────────────────────────────────────────────────

/** Sleep for a given number of milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry an async operation with exponential back-off */
export async function retry<T>(
  fn: () => Promise<T>,
  { attempts = 3, backoffMs = 500 }: { attempts?: number; backoffMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(backoffMs * 2 ** i);
    }
  }
  throw lastError;
}

// ─── Pagination helpers ───────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export function toPaginationMeta(total: number, { page, pageSize }: PaginationParams) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    hasNext: page * pageSize < total,
    hasPrev: page > 1,
  };
}

// ─── Date helpers ────────────────────────────────────────────────────────────

/** Format a Date to MySQL DATETIME string: YYYY-MM-DD HH:MM:SS */
export function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Return the start-of-day date N days ago */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
