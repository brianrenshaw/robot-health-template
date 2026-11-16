// backup.ts
// The nightly copy of the database.
//
// What it does: reads every table out of the database, writes it as one .sql file that can
// rebuild the database from nothing, puts that file in the private R2 bucket, deletes the
// oldest files so only the newest 30 remain, and records how it went in `backup_runs`.
//
// The copy never leaves Cloudflare. Nothing here writes to GitHub, and nothing should.
//
// Rules this file depends on (see CLAUDE.md, "Backups"):
// - No virtual tables (FTS5) and no WITHOUT ROWID tables: the reader below cannot copy them.
// - Values are turned into SQL text by SQLite's own quote(), so text, numbers, NULL and binary
//   data all come back exactly as they went in.

import type { Db } from "./db";

/** Every backup file is `backups/<time>.sql` in the bucket. */
export const BACKUP_PREFIX = "backups/";
/** How many copies are kept. Older ones are deleted after each successful backup. */
export const BACKUPS_KEPT = 30;
/** Rows read per query. Large enough that a small database needs one query per table. */
const PAGE = 1000;

/** The parts of an R2 bucket binding we use. Matches Cloudflare's R2Bucket type. */
export interface BucketLike {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  head(key: string): Promise<{ size: number } | null>;
  list(options: {
    prefix?: string;
    cursor?: string;
  }): Promise<{ objects: { key: string; size: number; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string[]): Promise<void>;
}

export type BackupSource = "nightly" | "manual";

/** One row of `backup_runs`. */
export interface BackupRun {
  id: string;
  started_at: string;
  finished_at: string;
  ok: 0 | 1;
  source: BackupSource;
  object_key: string | null;
  bytes: number | null;
  table_count: number | null;
  row_count: number | null;
  removed: number;
  error: string | null;
}

export interface BackupFile {
  key: string;
  size: number;
  uploaded: string;
}

/** What the page shows about backups. */
export interface BackupStatus {
  /** The most recent run, whether or not it worked. */
  last: BackupRun | null;
  /** The most recent run that worked. */
  last_ok: BackupRun | null;
  /** How many copies are in the bucket right now. */
  kept: number;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Tables SQLite and Cloudflare keep for themselves. They are rebuilt automatically, not copied. */
const isInternal = (name: string) => name.startsWith("sqlite_") || name.startsWith("_cf_");

/**
 * The whole database as SQL text: every table, every row, then the indexes.
 * Running the text against an empty database rebuilds it. `d1_migrations` is included, so a
 * restored database still knows which migrations it has had.
 */
export async function dumpSql(db: Db, now = new Date()): Promise<{ sql: string; tables: number; rows: number }> {
  const objects = (
    await db.all<{ type: string; name: string; tbl_name: string; sql: string }>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
    )
  ).filter((o) => !isInternal(o.name) && !isInternal(o.tbl_name));
  const tables = objects.filter((o) => o.type === "table");
  const rest = objects.filter((o) => o.type !== "table"); // indexes, views, triggers: after the rows

  const out: string[] = [
    `-- Health database backup, taken ${now.toISOString()}`,
    "-- Restore: run this file against an empty D1 database (see CLAUDE.md, Backups and restore).",
    // Lets rows go in before the rows they point at; checked when the file finishes.
    "PRAGMA defer_foreign_keys = true;",
  ];
  let rows = 0;

  // Every table is created before any row goes in, and tables that others point at are filled
  // first, so the file loads even where foreign keys are checked row by row.
  out.push("");
  for (const table of tables) out.push(statement(table.sql));

  for (const table of await parentsFirst(db, tables.map((t) => t.name))) {
    const columns = (await db.all<{ name: string }>(`PRAGMA table_info(${ident(table)})`)).map((c) => c.name);
    if (!columns.length) continue;
    const quoted = columns.map((c, i) => `quote(${ident(c)}) AS c${i}`).join(", ");
    const insert = `INSERT INTO ${ident(table)} (${columns.map(ident).join(", ")}) VALUES`;
    let after = Number.MIN_SAFE_INTEGER;
    let first = true;
    for (;;) {
      const page = await db.all<Record<string, string | number>>(
        `SELECT rowid AS backup_rowid, ${quoted} FROM ${ident(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        [after, PAGE],
      );
      if (first && page.length) out.push("");
      first = false;
      for (const row of page) {
        out.push(`${insert} (${columns.map((_, i) => String(row[`c${i}`])).join(", ")});`);
      }
      rows += page.length;
      if (page.length < PAGE) break;
      after = Number(page[page.length - 1]!.backup_rowid);
    }
  }

  if (rest.length) out.push("");
  for (const o of rest) out.push(statement(o.sql));
  out.push("");
  return { sql: out.join("\n"), tables: tables.length, rows };
}

/**
 * A stored CREATE statement, closed. The semicolon goes on its own line so that a statement
 * whose last line is a `-- comment` does not swallow it.
 */
const statement = (sql: string) => `${sql.trimEnd()}\n;`;

/**
 * The tables in an order where each comes after the tables it points at (its foreign keys).
 * Tables that point at each other in a circle keep their original order; the
 * `defer_foreign_keys` line at the top of the file covers those on D1.
 */
async function parentsFirst(db: Db, names: string[]): Promise<string[]> {
  const parents = new Map<string, string[]>();
  for (const name of names) {
    const keys = await db.all<{ table: string }>(`PRAGMA foreign_key_list(${ident(name)})`);
    parents.set(name, keys.map((k) => k.table).filter((t) => t !== name && names.includes(t)));
  }
  const ordered: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string) => {
    if (state.has(name)) return; // already placed, or part of a circle
    state.set(name, "visiting");
    for (const parent of parents.get(name) ?? []) visit(parent);
    state.set(name, "done");
    ordered.push(name);
  };
  for (const name of names) visit(name);
  return ordered;
}

/** `backups/2026-11-16T08-15-00Z.sql`. Names sort oldest to newest. */
export function backupKey(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-")}.sql`;
}

/** Every copy in the bucket, newest first. */
export async function listBackups(bucket: BucketLike): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
    for (const o of page.objects) files.push({ key: o.key, size: o.size, uploaded: new Date(o.uploaded).toISOString() });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/**
 * Make one backup now. Never throws: a failure is recorded in `backup_runs` and returned, so the
 * page can say so. Old copies are only deleted after the new one is confirmed to be in the bucket.
 */
export async function runBackup(
  env: { db: Db; bucket: BucketLike },
  source: BackupSource,
  now = new Date(),
): Promise<BackupRun> {
  const run: BackupRun = {
    id: crypto.randomUUID(),
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    ok: 0,
    source,
    object_key: null,
    bytes: null,
    table_count: null,
    row_count: null,
    removed: 0,
    error: null,
  };

  try {
    const dump = await dumpSql(env.db, now);
    const key = backupKey(now);
    const bytes = new TextEncoder().encode(dump.sql).byteLength;
    await env.bucket.put(key, dump.sql, {
      httpMetadata: { contentType: "application/sql; charset=utf-8" },
      customMetadata: { tables: String(dump.tables), rows: String(dump.rows), source },
    });
    const stored = await env.bucket.head(key);
    if (!stored || stored.size !== bytes) {
      throw new Error(`The copy did not arrive whole (sent ${bytes} bytes, bucket has ${stored?.size ?? "nothing"}).`);
    }
    run.ok = 1;
    run.object_key = key;
    run.bytes = bytes;
    run.table_count = dump.tables;
    run.row_count = dump.rows;

    // Keep the newest 30. A problem here does not undo the backup that just worked.
    try {
      const old = (await listBackups(env.bucket)).slice(BACKUPS_KEPT).map((f) => f.key);
      if (old.length) await env.bucket.delete(old);
      run.removed = old.length;
    } catch (e) {
      run.error = `Backed up, but could not remove old copies: ${message(e)}`;
    }
  } catch (e) {
    run.error = message(e);
  }

  run.finished_at = new Date().toISOString();
  try {
    await env.db.run(
      `INSERT INTO backup_runs
         (id, started_at, finished_at, ok, source, object_key, bytes, table_count, row_count, removed, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id, run.started_at, run.finished_at, run.ok, run.source, run.object_key, run.bytes,
        run.table_count, run.row_count, run.removed, run.error,
      ],
    );
  } catch (e) {
    console.error("Could not record the backup run", message(e));
  }
  if (!run.ok) console.error("Backup failed:", run.error);
  return run;
}

/** What the page needs: the last run, the last one that worked, and how many copies exist. */
export async function backupStatus(env: { db: Db; bucket: BucketLike }): Promise<BackupStatus> {
  const last = await env.db.first<BackupRun>("SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 1");
  const last_ok = await env.db.first<BackupRun>(
    "SELECT * FROM backup_runs WHERE ok = 1 ORDER BY started_at DESC LIMIT 1",
  );
  let kept = 0;
  try {
    kept = (await listBackups(env.bucket)).length;
  } catch (e) {
    console.error("Could not list backups", message(e));
  }
  return { last, last_ok, kept };
}

/** An error as one short line. Never includes row data: only what the database or bucket said. */
function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}
