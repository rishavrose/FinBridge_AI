import type { CacheConfig } from '../types/index.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple in-memory LRU-like cache.
 * Evicts the oldest entry when maxSize is reached.
 */
export class Cache {
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();

  constructor(config: CacheConfig = { enabled: false }) {
    this.enabled = config.enabled;
    this.ttl = config.ttl ?? 60_000;
    this.maxSize = config.maxSize ?? 500;
  }

  get<T>(key: string): T | undefined {
    if (!this.enabled) return undefined;

    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Touch order by re-inserting (LRU)
    this.store.delete(key);
    this.store.set(key, entry as CacheEntry<unknown>);

    return entry.value;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    if (!this.enabled) return;

    if (this.store.size >= this.maxSize) {
      // Evict the oldest entry
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.ttl),
    } as CacheEntry<unknown>);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * Build a deterministic cache key from an object.
   */
  static buildKey(namespace: string, params?: unknown): string {
    if (!params) return namespace;
    return `${namespace}:${JSON.stringify(params)}`;
  }
}
