// kv.ts
// A small stand-in for a Workers KV namespace, stored in the oauth_kv table.
// Used only by the chatbot Worker (workers/mcp)'s OAuth library, which needs get, put, delete and list.
// (A real KV namespace would also work; this keeps everything in the one D1 database.)

import type { Db } from "./db";

interface PutOptions {
  expirationTtl?: number; // seconds from now
  expiration?: number; // Unix seconds
  metadata?: unknown;
}

interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string | null;
}

interface Row {
  key: string;
  value: string;
  metadata: string | null;
  expires_at: number | null;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function dbKv(db: Db) {
  return {
    async get(key: string, options?: string | { type?: string }): Promise<any> {
      const row = await db.first<Row>(
        `SELECT * FROM oauth_kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`,
        [key, nowSeconds()],
      );
      if (!row) return null;
      const type = typeof options === "string" ? options : options?.type;
      return type === "json" ? JSON.parse(row.value) : row.value;
    },

    async put(key: string, value: string, options: PutOptions = {}): Promise<void> {
      const now = nowSeconds();
      const expires = options.expiration ?? (options.expirationTtl ? now + options.expirationTtl : null);
      await db.run(
        `INSERT INTO oauth_kv (key, value, metadata, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, expires_at = excluded.expires_at`,
        [key, String(value), options.metadata === undefined ? null : JSON.stringify(options.metadata), expires],
      );
      // Housekeeping: drop rows that have expired. Cheap, and keeps the table small.
      await db.run(`DELETE FROM oauth_kv WHERE expires_at IS NOT NULL AND expires_at <= ?`, [now]);
    },

    async delete(key: string): Promise<void> {
      await db.run(`DELETE FROM oauth_kv WHERE key = ?`, [key]);
    },

    async list(options: ListOptions = {}) {
      const prefix = options.prefix ?? "";
      const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
      const rows = await db.all<Row>(
        `SELECT * FROM oauth_kv
         WHERE key >= ? AND key < ? AND key > ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY key LIMIT ${limit + 1}`,
        [prefix, prefix + "￿", options.cursor ?? "", nowSeconds()],
      );
      const page = rows.slice(0, limit);
      const complete = rows.length <= limit;
      return {
        keys: page.map((r) => ({
          name: r.key,
          ...(r.expires_at ? { expiration: r.expires_at } : {}),
          ...(r.metadata ? { metadata: JSON.parse(r.metadata) } : {}),
        })),
        list_complete: complete,
        ...(complete ? {} : { cursor: page[page.length - 1]!.key }),
        cacheStatus: null,
      };
    },
  };
}
