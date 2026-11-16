// audit.ts
// The record of every change to a health record: who made it, and the row before and after.
// Every write function in this package calls recordAudit. Undo is built on it (undoLast).
//
// Everything one request changes shares an `op`, so undo takes the whole request back together:
// all the sets from one message, a session finished along with them, a whole Apple Health sync.

import type { Db } from "./db";

/**
 * Who is making a change. `actor` is "web" for the page, "mcp:claude" for the chatbot, "import"
 * for a script. `op` names the request: the chatbot Worker gives each tool call its own.
 */
export interface Ctx {
  db: Db;
  actor: string;
  op?: string;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  table_name: string;
  row_id: string;
  action: "create" | "update";
  before: string | null;
  after: string;
  op: string | null;
  undone_at: string | null;
}

/** Something the caller asked for cannot be done as asked. The message is safe to show. */
export class InputError extends Error {}

export async function recordAudit(
  ctx: Ctx,
  change: { table: string; rowId: string; before: unknown | null; after: unknown },
): Promise<void> {
  await ctx.db.run(
    `INSERT INTO audit_log (id, at, actor, table_name, row_id, action, before, after, op) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      new Date().toISOString(),
      ctx.actor,
      change.table,
      change.rowId,
      change.before ? "update" : "create",
      change.before ? JSON.stringify(change.before) : null,
      JSON.stringify(change.after),
      ctx.op ?? null,
    ],
  );
}

/** The newest changes first. */
export async function listAudit(db: Db, limit = 50): Promise<AuditRow[]> {
  return db.all<AuditRow>("SELECT * FROM audit_log ORDER BY at DESC, rowid DESC LIMIT ?", [Math.min(Math.max(limit, 1), 500)]);
}

// ---------- undo ----------

/**
 * The tables an undo may touch, with the column that identifies a row. `soft` tables have a
 * `deleted_at` column: taking back something that was added marks it deleted. In the others
 * (the Apple Health spec's tables, which have no such column, and plans) the added row is
 * removed; the audit row still holds what it was.
 */
const UNDOABLE: Record<string, { key: string; soft: boolean }> = {
  daily_metrics: { key: "date", soft: false },
  weighins: { key: "date", soft: false },
  workouts: { key: "id", soft: false },
  lift_sessions: { key: "id", soft: true },
  lift_sets: { key: "id", soft: true },
  journal_entries: { key: "id", soft: true },
  reviews: { key: "id", soft: true },
  week_plans: { key: "week_start", soft: false },
  planned_days: { key: "date", soft: false },
  plan_items: { key: "id", soft: true },
  exercise_swaps: { key: "id", soft: false },
  macro_targets: { key: "id", soft: false },
};

const WORDS: Record<string, [string, string]> = {
  daily_metrics: ["day of numbers", "days of numbers"],
  weighins: ["weigh-in", "weigh-ins"],
  workouts: ["workout", "workouts"],
  lift_sessions: ["session change", "session changes"],
  lift_sets: ["set", "sets"],
  journal_entries: ["note", "notes"],
  reviews: ["review", "reviews"],
  week_plans: ["week plan", "week plans"],
  planned_days: ["planned day", "planned days"],
  plan_items: ["planned activity", "planned activities"],
  exercise_swaps: ["swap", "swaps"],
  macro_targets: ["set of macro targets", "sets of macro targets"],
};

export interface UndoResult {
  /** What was taken back, in plain words: "3 sets, 1 session change". */
  what: string;
  /** When the change that was taken back had been made. */
  made_at: string;
  rows: number;
}

/**
 * Take back the most recent change the chatbot made that has not already been taken back: every
 * row that request touched goes back to what it was before. Returns null when there is nothing
 * to undo. Calling it again takes back the change before that.
 */
export async function undoLast(ctx: Ctx, now = new Date()): Promise<UndoResult | null> {
  const last = await ctx.db.first<AuditRow>(
    "SELECT * FROM audit_log WHERE actor LIKE 'mcp:%' AND undone_at IS NULL AND op IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT 1",
  );
  if (!last) return null;
  const rows = await ctx.db.all<AuditRow>("SELECT * FROM audit_log WHERE op = ? AND undone_at IS NULL ORDER BY at DESC, rowid DESC", [last.op]);
  const counts = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = UNDOABLE[row.table_name];
    if (!table) throw new InputError(`The last change touched ${row.table_name}, which cannot be undone from here. Nothing was changed.`);
    const before = row.before ? (JSON.parse(row.before) as Record<string, string | number | null>) : null;
    // planned_days rows are identified by date and activity together.
    const after = JSON.parse(row.after) as Record<string, string | number | null>;
    const where = row.table_name === "planned_days" ? "date = ? AND activity = ?" : `${table.key} = ?`;
    const id = row.table_name === "planned_days" ? [String(after.date), String(after.activity)] : [row.table_name === "workouts" ? Number(row.row_id) : row.row_id];
    if (before) {
      const cols = Object.keys(before).filter((c) => c !== table.key && /^[a-z_][a-z0-9_]*$/.test(c));
      const exists = await ctx.db.first(`SELECT 1 AS x FROM ${row.table_name} WHERE ${where}`, id);
      if (exists) {
        await ctx.db.run(`UPDATE ${row.table_name} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${where}`, [...cols.map((c) => before[c] ?? null), ...id]);
      } else {
        // The change removed the row (a weigh-in Apple Health no longer had): put it back whole.
        const all = Object.keys(before).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
        await ctx.db.run(`INSERT INTO ${row.table_name} (${all.join(", ")}) VALUES (${all.map(() => "?").join(", ")})`, all.map((c) => before[c] ?? null));
      }
    } else if (table.soft) {
      await ctx.db.run(`UPDATE ${row.table_name} SET deleted_at = ? WHERE ${where}`, [now.toISOString(), ...id]);
    } else {
      if (row.table_name === "workouts") await ctx.db.run("DELETE FROM workout_stats WHERE workout_id = ?", id);
      await ctx.db.run(`DELETE FROM ${row.table_name} WHERE ${where}`, id);
    }
    counts.set(row.table_name, (counts.get(row.table_name) ?? new Set()).add(row.row_id));
  }
  await ctx.db.run("UPDATE audit_log SET undone_at = ? WHERE op = ? AND undone_at IS NULL", [now.toISOString(), last.op]);
  const what = [...counts].map(([t, ids]) => `${ids.size} ${WORDS[t]![ids.size === 1 ? 0 : 1]}`).join(", ");
  return { what, made_at: rows[rows.length - 1]!.at, rows: rows.length };
}
