import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BACKUPS_KEPT, BACKUP_PREFIX, backupKey, backupStatus, dumpSql, listBackups, runBackup, type BackupRun } from "../src";
import { memoryBucket, memoryDb, wrap } from "./helpers";

/** Every row of every table, for comparing two databases. */
function contents(raw: DatabaseSync): Record<string, unknown[]> {
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map((t) => [t.name, raw.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}" ORDER BY rowid`).all().map((r) => ({ ...r }))]),
  );
}

describe("the backup file", () => {
  it("rebuilds the database exactly, awkward values included", async () => {
    const { db, raw } = memoryDb();
    // A child table created before its parent, to prove the order of tables does not matter.
    raw.exec(`
      CREATE TABLE reading_notes (id INTEGER PRIMARY KEY, reading_id TEXT NOT NULL REFERENCES readings(id), body TEXT);
      CREATE TABLE readings (id TEXT PRIMARY KEY, taken_at TEXT, value REAL, count INTEGER, note TEXT, scan BLOB);
      CREATE INDEX readings_by_time ON readings (taken_at);
      CREATE TABLE "odd ""name""" (a TEXT);
    `);
    const add = raw.prepare("INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?)");
    add.run("r1", "2026-11-15T07:00:00Z", 182.4, 3, "plain", null);
    add.run("r2", null, 0.1 + 0.2, -7, "it's got 'quotes', a \"double\", a ; and\na new line", new Uint8Array([0, 1, 254, 255]));
    add.run("r3", "", 1e21, 9007199254740991, "héllo ✓ 🫀", new Uint8Array([]));
    raw.prepare("INSERT INTO reading_notes VALUES (1, 'r2', 'after breakfast')").run();
    raw.prepare(`INSERT INTO "odd ""name""" VALUES ('x')`).run();
    raw.prepare(
      "INSERT INTO backup_runs (id, started_at, finished_at, ok, source) VALUES ('b1', '2026-11-14', '2026-11-14', 1, 'nightly')",
    ).run();

    const dump = await dumpSql(db);
    const fresh = await dumpSql(memoryDb().db); // what the migrations alone make
    expect(dump.tables).toBe(fresh.tables + 3);
    expect(dump.rows).toBe(fresh.rows + 6);

    const restored = new DatabaseSync(":memory:");
    restored.exec("PRAGMA foreign_keys = ON");
    restored.exec(dump.sql);
    expect(contents(restored)).toEqual(contents(raw));
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const index = restored.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'readings_by_time'").get();
    expect(index).toBeTruthy();
  });

  it("copies a table longer than one page of rows", async () => {
    const { db, raw } = memoryDb();
    raw.exec("CREATE TABLE steps (day INTEGER PRIMARY KEY, n INTEGER)");
    const add = raw.prepare("INSERT INTO steps VALUES (?, ?)");
    for (let i = 1; i <= 2500; i++) add.run(i, i * 3);
    const dump = await dumpSql(db);
    const restored = new DatabaseSync(":memory:");
    restored.exec(dump.sql);
    expect(restored.prepare("SELECT COUNT(*) AS n, SUM(n) AS total FROM steps").get()).toEqual({ n: 2500, total: 9378750 });
  });

  it("survives a table or index whose definition ends in a comment", async () => {
    const { db, raw } = memoryDb();
    raw.exec("CREATE TABLE meds (id TEXT PRIMARY KEY, name TEXT -- what it is called\n) -- the list\n;");
    raw.exec("CREATE INDEX meds_by_name ON meds (name) -- for looking one up\n;");
    raw.exec("INSERT INTO meds VALUES ('m1', 'example')");
    const restored = new DatabaseSync(":memory:");
    restored.exec((await dumpSql(db)).sql);
    expect(contents(restored).meds).toEqual([{ id: "m1", name: "example" }]);
    expect(restored.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'meds_by_name'").get()).toEqual({ n: 1 });
  });

  it("leaves SQLite's and Cloudflare's own tables out", async () => {
    const { db, raw } = memoryDb();
    raw.exec("CREATE TABLE counted (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT); INSERT INTO counted (x) VALUES ('a');");
    raw.exec("CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB)");
    const { sql } = await dumpSql(db);
    expect(sql).not.toMatch(/sqlite_sequence|_cf_KV/);
    expect(sql).toMatch(/INSERT INTO "counted"/);
  });
});

describe("running a backup", () => {
  it("puts the file in the bucket and records the run", async () => {
    const { db } = memoryDb();
    const bucket = memoryBucket();
    const run = await runBackup({ db, bucket }, "nightly", new Date("2026-11-16T08:15:03.123Z"));
    expect(run).toMatchObject({ ok: 1, source: "nightly", object_key: "backups/2026-11-16T08-15-03Z.sql", removed: 0, error: null });
    expect(bucket.files.get(run.object_key!)).toContain("CREATE TABLE backup_runs");
    expect(run.bytes).toBe(new TextEncoder().encode(bucket.files.get(run.object_key!)!).byteLength);

    const status = await backupStatus({ db, bucket });
    expect(status.kept).toBe(1);
    expect(status.last?.id).toBe(run.id);
    expect(status.last_ok?.id).toBe(run.id);
  });

  it("keeps the newest 30 and deletes the rest", async () => {
    const { db } = memoryDb();
    const bucket = memoryBucket();
    bucket.pageSize = 7; // make the listing come back in several pages
    for (let day = 1; day <= 34; day++) {
      bucket.files.set(backupKey(new Date(Date.UTC(2026, 9, day, 8, 15))), "old");
    }
    bucket.files.set("something-else.txt", "not a backup");
    const run = await runBackup({ db, bucket }, "nightly", new Date("2026-11-16T08:15:00Z"));
    expect(run).toMatchObject({ ok: 1, removed: 5 });

    const kept = await listBackups(bucket);
    expect(kept).toHaveLength(BACKUPS_KEPT);
    expect(kept[0]!.key).toBe(run.object_key); // newest first
    expect(kept.at(-1)!.key).toBe(`${BACKUP_PREFIX}2026-10-06T08-15-00Z.sql`); // days 1 to 5 are gone
    expect(bucket.files.has("something-else.txt")).toBe(true);
  });

  it("records a failure, deletes nothing, and does not throw", async () => {
    const { db } = memoryDb();
    const bucket = memoryBucket();
    for (let day = 1; day <= 34; day++) bucket.files.set(backupKey(new Date(Date.UTC(2026, 9, day))), "old");
    const good = await runBackup({ db, bucket }, "manual", new Date("2026-11-15T08:15:00Z"));
    const before = bucket.files.size;

    bucket.failPut = true;
    const bad = await runBackup({ db, bucket }, "nightly", new Date("2026-11-16T08:15:00Z"));
    expect(bad).toMatchObject({ ok: 0, object_key: null, error: "bucket unavailable" });
    expect(bucket.files.size).toBe(before);

    const status = await backupStatus({ db, bucket });
    expect(status.last?.id).toBe(bad.id);
    expect(status.last_ok?.id).toBe(good.id);
    const rows = await db.all<BackupRun>("SELECT * FROM backup_runs ORDER BY started_at");
    expect(rows.map((r) => r.ok)).toEqual([1, 0]);
  });

  it("a restored backup still knows about earlier backups", async () => {
    const { db } = memoryDb();
    const bucket = memoryBucket();
    await runBackup({ db, bucket }, "nightly", new Date("2026-11-15T08:15:00Z"));
    const second = await runBackup({ db, bucket }, "nightly", new Date("2026-11-16T08:15:00Z"));
    const restored = new DatabaseSync(":memory:");
    restored.exec(bucket.files.get(second.object_key!)!);
    const status = await backupStatus({ db: wrap(restored), bucket });
    expect(status.last_ok?.object_key).toBe("backups/2026-11-15T08-15-00Z.sql");
  });
});
