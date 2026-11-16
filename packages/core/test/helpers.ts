// Test helpers: an in-memory SQLite database with the real migrations applied, and a pretend
// R2 bucket that keeps its files in a Map.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BucketLike, Db, Param } from "../src";

const MIGRATIONS = join(__dirname, "../../../migrations");

/** Wrap a node:sqlite database in the same interface the Worker uses for D1. */
export function wrap(raw: DatabaseSync): Db {
  const norm = (row: any) => (row ? { ...row } : null);
  return {
    async all<T>(sql: string, params: Param[] = []) {
      return raw.prepare(sql).all(...params).map(norm) as T[];
    },
    async first<T>(sql: string, params: Param[] = []) {
      return norm(raw.prepare(sql).get(...params)) as T | null;
    },
    async run(sql: string, params: Param[] = []) {
      raw.prepare(sql).run(...params);
    },
  };
}

/** A fresh database with every migration applied. `raw` is for setting up odd cases in a test. */
export function memoryDb(): { db: Db; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  return { db: wrap(raw), raw };
}

/** A pretend bucket. `files` is what it holds; set `failPut` to make uploads fail. */
export function memoryBucket(): BucketLike & { files: Map<string, string>; failPut: boolean; pageSize: number } {
  const files = new Map<string, string>();
  const size = (v: string) => new TextEncoder().encode(v).byteLength;
  return {
    files,
    failPut: false,
    pageSize: 1000,
    async put(key, value) {
      if (this.failPut) throw new Error("bucket unavailable");
      files.set(key, value);
    },
    async head(key) {
      const v = files.get(key);
      return v === undefined ? null : { size: size(v) };
    },
    async list({ prefix = "", cursor }) {
      const keys = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + this.pageSize);
      const end = start + slice.length;
      return {
        objects: slice.map((key) => ({ key, size: size(files.get(key)!), uploaded: new Date(0) })),
        truncated: end < keys.length,
        cursor: end < keys.length ? String(end) : undefined,
      };
    },
    async delete(keys) {
      for (const k of keys) files.delete(k);
    },
  };
}
