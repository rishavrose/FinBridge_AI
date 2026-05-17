/**
 * API key management.
 *
 * Keys are hashed with SHA-256 before storage — raw keys are never persisted.
 * The cache layer is checked first to avoid redundant lookups.
 */

import { v4 as uuidv4 } from 'uuid';
import { hashValue, generateToken } from '../utils/helpers.js';
import { cacheGet, cacheSet } from '../cache/manager.js';
import { AuthenticationError } from '../utils/errors.js';
import { env } from '../config/env.js';
import type { ApiKeyRecord, Role } from '../types/index.js';

// ─── In-memory store (replace with DB table in production) ────────────────────
// NOTE: In a real deployment, persist API keys in a dedicated DB table
// and load them on startup.  This in-memory map is for demonstration.

const apiKeyStore = new Map<string, ApiKeyRecord>();

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreatedApiKey {
  rawKey: string;      // Show ONCE to the user — never stored
  record: ApiKeyRecord;
}

export function createApiKey(name: string, role: Role, expiresInDays?: number): CreatedApiKey {
  const rawKey = generateToken(32);
  const keyHash = hashValue(rawKey, env.API_KEY_SALT);

  const record: ApiKeyRecord = {
    id: uuidv4(),
    keyHash,
    name,
    role,
    createdAt: new Date(),
    expiresAt: expiresInDays
      ? new Date(Date.now() + expiresInDays * 86_400_000)
      : undefined,
    active: true,
  };

  apiKeyStore.set(keyHash, record);
  return { rawKey, record };
}

// ─── Validate ─────────────────────────────────────────────────────────────────

export async function validateApiKey(rawKey: string): Promise<ApiKeyRecord> {
  const keyHash = hashValue(rawKey, env.API_KEY_SALT);
  const cacheKey = `apikey:${keyHash}`;

  // 1. Check Redis cache
  const cached = await cacheGet<ApiKeyRecord>(cacheKey);
  if (cached) {
    if (!cached.active) throw new AuthenticationError('API key has been revoked');
    if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      throw new AuthenticationError('API key has expired');
    }
    return cached;
  }

  // 2. Check in-memory store (or DB in production)
  const record = apiKeyStore.get(keyHash);
  if (!record) throw new AuthenticationError('Invalid API key');
  if (!record.active) throw new AuthenticationError('API key has been revoked');
  if (record.expiresAt && record.expiresAt < new Date()) {
    throw new AuthenticationError('API key has expired');
  }

  // 3. Cache for 5 minutes
  await cacheSet(cacheKey, record, { ttl: 300 });

  return record;
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export function revokeApiKey(id: string): boolean {
  for (const [hash, record] of apiKeyStore.entries()) {
    if (record.id === id) {
      apiKeyStore.set(hash, { ...record, active: false });
      return true;
    }
  }
  return false;
}

export function listApiKeys(): Omit<ApiKeyRecord, 'keyHash'>[] {
  return [...apiKeyStore.values()].map(({ keyHash: _kh, ...rest }) => rest);
}
