import type { SayayStorage } from '../index.js';

export interface D1Result {
  value?: number | null;
}

export interface D1StatementLike {
  bind(...args: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

export interface D1StorageOptions {
  db: D1DatabaseLike;
  tableName?: string;
}

export class D1Storage implements SayayStorage {
  private readonly db: D1DatabaseLike;
  private readonly table: string;
  private ready: Promise<void> | null = null;

  constructor(options: D1StorageOptions) {
    this.db = options.db;
    this.table = options.tableName || 'sayay_ledger';
  }

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS ${this.table} (
             key TEXT PRIMARY KEY,
             value REAL NOT NULL DEFAULT 0,
             expires INTEGER
           )`,
        )
        .run()
        .then(() => undefined);
    }
    return this.ready;
  }

  private async ensureTable(): Promise<void> {
    await this.init();
  }

  private async pruneExpired(): Promise<void> {
    await this.db
      .prepare(`DELETE FROM ${this.table} WHERE expires IS NOT NULL AND expires < ?`)
      .bind(Math.floor(Date.now() / 1000))
      .run();
  }

  async get(key: string): Promise<number> {
    await this.ensureTable();
    const row = await this.db.prepare(`SELECT value FROM ${this.table} WHERE key = ? AND (expires IS NULL OR expires >= ?)`).bind(key, Math.floor(Date.now() / 1000)).first<D1Result>();
    const value = Number(row?.value ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  async increment(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    await this.ensureTable();
    await this.pruneExpired();
    const expires = ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : null;
    await this.db
      .prepare(
        `INSERT INTO ${this.table} (key, value, expires) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, expires = excluded.expires`,
      )
      .bind(key, amount, expires)
      .run();
    const row = await this.db.prepare(`SELECT value FROM ${this.table} WHERE key = ?`).bind(key).first<D1Result>();
    return Number(row?.value ?? 0);
  }

  async reset(key: string): Promise<void> {
    await this.ensureTable();
    await this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).bind(key).run();
  }
}