import { describe, it, expect } from 'vitest';
import { KVStorage } from './kv.js';
import { D1Storage } from './d1.js';
import type { D1DatabaseLike, D1StatementLike } from './d1.js';
import { RedisStorage } from './redis.js';
import type { RedisLike } from './redis.js';

describe('KVStorage', () => {
  function mockKV() {
    const store = new Map<string, { value: string; ttl?: number }>();
    const kv = {
      async get(key: string) {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.ttl !== undefined && Date.now() > entry.ttl) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },
      async put(key: string, value: string, opts?: { expirationTtl?: number }) {
        store.set(key, { value, ttl: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined });
      },
      async delete(key: string) {
        store.delete(key);
      },
      store,
    };
    return kv;
  }

  it('get returns 0 for missing key', async () => {
    const storage = new KVStorage(mockKV());
    await expect(storage.get('missing')).resolves.toBe(0);
  });

  it('increment adds and returns new value', async () => {
    const storage = new KVStorage(mockKV());
    await expect(storage.increment('k', 2)).resolves.toBe(2);
    await expect(storage.increment('k', 3)).resolves.toBe(5);
    await expect(storage.get('k')).resolves.toBe(5);
  });

  it('reset deletes the key', async () => {
    const storage = new KVStorage(mockKV());
    await storage.increment('k', 1);
    await storage.reset('k');
    await expect(storage.get('k')).resolves.toBe(0);
  });
});

describe('D1Storage', () => {
  function mockD1() {
    const table = new Map<string, { value: number; expires: number | null }>();
    const statement: D1StatementLike = {
      bind() {
        return statement;
      },
      async first() {
        return null;
      },
      async run() {
        return {};
      },
    };
    const db: D1DatabaseLike = {
      prepare(sql: string) {
        const self = { ...statement };
        const bound: unknown[] = [];
        self.bind = (...args: unknown[]) => {
          bound.push(...args);
          return self;
        };
        self.first = async () => {
          const m = sql.match(/WHERE key = \?/);
          if (m) {
            const row = table.get(bound[0] as string);
            return row ? { value: row.value } : null;
          }
          return null;
        };
        self.run = async () => {
          if (sql.startsWith('CREATE TABLE')) {
            return {};
          }
          if (sql.startsWith('DELETE')) {
            const key = bound[0] as string;
            table.delete(key);
            return {};
          }
          if (sql.includes('ON CONFLICT')) {
            const [key, amount, expires] = bound as [string, number, number | null];
            const prev = table.get(key)?.value ?? 0;
            table.set(key, { value: prev + amount, expires });
            return {};
          }
          return {};
        };
        return self;
      },
    };
    return { db, table };
  }

  it('get returns 0 for missing key', async () => {
    const storage = new D1Storage({ db: mockD1().db });
    await expect(storage.get('missing')).resolves.toBe(0);
  });

  it('increment upserts atomically', async () => {
    const { db, table } = mockD1();
    const storage = new D1Storage({ db });
    await expect(storage.increment('k', 2)).resolves.toBe(2);
    await expect(storage.increment('k', 3)).resolves.toBe(5);
    expect(table.get('k')?.value).toBe(5);
  });

  it('reset deletes the key', async () => {
    const { db, table } = mockD1();
    const storage = new D1Storage({ db });
    await storage.increment('k', 1);
    await storage.reset('k');
    expect(table.has('k')).toBe(false);
  });
});

describe('RedisStorage', () => {
  function mockRedis() {
    const store = new Map<string, number>();
    const redis: RedisLike = {
      async get(key: string) {
        return store.has(key) ? String(store.get(key)) : null;
      },
      async incrbyfloat(key: string, amount: number) {
        const next = (store.get(key) ?? 0) + amount;
        store.set(key, next);
        return next;
      },
      async expire() {
        return 1;
      },
      async del(key: string) {
        store.delete(key);
        return 1;
      },
      store,
    };
    return redis;
  }

  it('incrbyfloat handles fractional amounts', async () => {
    const storage = new RedisStorage(mockRedis());
    await expect(storage.increment('k', 0.003)).resolves.toBeCloseTo(0.003, 6);
    await expect(storage.increment('k', 0.002)).resolves.toBeCloseTo(0.005, 6);
  });

  it('reset deletes the key', async () => {
    const redis = mockRedis();
    const storage = new RedisStorage(redis);
    await storage.increment('k', 1);
    await storage.reset('k');
    await expect(storage.get('k')).resolves.toBe(0);
  });

  it('throws when the client has no increment primitives', async () => {
    const storage = new RedisStorage({ get: async () => null, expire: async () => 1, del: async () => 1 });
    await expect(storage.increment('k', 1)).rejects.toThrow(/incrbyfloat/);
  });
});