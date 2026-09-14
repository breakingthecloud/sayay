import type { SayayStorage } from '../index.js';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  incrbyfloat?(key: string, amount: number): Promise<number | string>;
  incrby?(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisStorage implements SayayStorage {
  constructor(private readonly redis: RedisLike) {}

  async get(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    const value = parseFloat(raw || '0');
    return Number.isFinite(value) ? value : 0;
  }

  async increment(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    let next: number;
    if (typeof this.redis.incrbyfloat === 'function') {
      next = Number(await this.redis.incrbyfloat(key, amount));
    } else if (typeof this.redis.incrby === 'function') {
      next = await this.redis.incrby(key, amount);
    } else {
      throw new Error('RedisStorage requires a client with incrbyfloat() or incrby()');
    }
    if (ttlSeconds) {
      await this.redis.expire(key, ttlSeconds);
    }
    return next;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}