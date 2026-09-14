import type { SayayStorage } from '../index.js';

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KVStorage implements SayayStorage {
  constructor(private readonly kv: KVNamespaceLike) {}

  async get(key: string): Promise<number> {
    const raw = await this.kv.get(key);
    const value = parseFloat(raw || '0');
    return Number.isFinite(value) ? value : 0;
  }

  async increment(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const current = await this.get(key);
    const next = current + amount;
    await this.kv.put(key, String(next), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
    return next;
  }

  async reset(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}