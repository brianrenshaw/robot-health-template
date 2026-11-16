// db.ts
// A tiny database interface so every query in this package works the same way
// against Cloudflare D1 (in the Worker) and against node:sqlite (in tests and scripts).
// All SQL in the whole project lives in packages/core. Nothing else writes SQL.

export type Param = string | number | null;

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | null>;
  run(sql: string, params?: Param[]): Promise<void>;
}

/** The parts of the D1 binding we use. Matches Cloudflare's D1Database type. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

/** Wrap a D1 binding (env.DB) so core queries can use it. */
export function d1(binding: D1Like): Db {
  return {
    async all<T>(sql: string, params: Param[] = []) {
      const res = await binding.prepare(sql).bind(...params).all<T>();
      return res.results ?? [];
    },
    async first<T>(sql: string, params: Param[] = []) {
      return (await binding.prepare(sql).bind(...params).first<T>()) ?? null;
    },
    async run(sql: string, params: Param[] = []) {
      await binding.prepare(sql).bind(...params).run();
    },
  };
}

/** Build "?, ?, ?" for an IN (...) clause. */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}
