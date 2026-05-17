import { Cache } from '../cache';

describe('Cache', () => {
  it('returns undefined when disabled', () => {
    const cache = new Cache({ enabled: false });
    cache.set('key', 'value');
    expect(cache.get('key')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new Cache({ enabled: true, ttl: 5000 });
    cache.set('greeting', 'hello');
    expect(cache.get('greeting')).toBe('hello');
  });

  it('returns undefined after TTL expires', async () => {
    const cache = new Cache({ enabled: true, ttl: 10 });
    cache.set('short', 'lived');
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('short')).toBeUndefined();
  });

  it('evicts oldest entry when maxSize is reached', () => {
    const cache = new Cache({ enabled: true, ttl: 60000, maxSize: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
  });

  it('invalidates by prefix', () => {
    const cache = new Cache({ enabled: true, ttl: 60000 });
    cache.set('/users/1', { id: 1 });
    cache.set('/users/2', { id: 2 });
    cache.set('/payouts/1', { id: 1 });
    cache.invalidatePrefix('/users');
    expect(cache.get('/users/1')).toBeUndefined();
    expect(cache.get('/users/2')).toBeUndefined();
    expect(cache.get('/payouts/1')).toBeDefined();
  });

  it('builds deterministic cache keys', () => {
    const key1 = Cache.buildKey('/payouts', { userId: 1, status: 'failed' });
    const key2 = Cache.buildKey('/payouts', { userId: 1, status: 'failed' });
    expect(key1).toBe(key2);
  });
});
