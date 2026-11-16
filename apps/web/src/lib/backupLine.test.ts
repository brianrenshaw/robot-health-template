import { describe, expect, it } from "vitest";
import type { BackupRun, BackupStatus } from "@health/core";
import { backupLine } from "./backupLine";

const TZ = "America/New_York";
const now = new Date("2026-11-16T15:00:00Z"); // 10:00 AM in New York

function run(finished_at: string, ok: 0 | 1 = 1): BackupRun {
  return {
    id: finished_at, started_at: finished_at, finished_at, ok, source: "nightly",
    object_key: ok ? "backups/x.sql" : null, bytes: 1, table_count: 1, row_count: 1, removed: 0,
    error: ok ? null : "bucket unavailable",
  };
}
const status = (last: BackupRun | null, last_ok: BackupRun | null): BackupStatus => ({ last, last_ok, kept: 1 });

describe("the backup line", () => {
  it("is quiet when last night's backup worked", () => {
    const r = run("2026-11-16T08:15:04Z");
    expect(backupLine(status(r, r), now, TZ)).toEqual({ text: "Backed up today at 3:15 AM", tone: "quiet" });
  });
  it("says yesterday for a copy made the day before", () => {
    const r = run("2026-11-15T08:15:04Z");
    expect(backupLine(status(r, r), now, TZ).text).toBe("Backed up yesterday at 3:15 AM");
  });
  it("is quiet before the first backup", () => {
    expect(backupLine(status(null, null), now, TZ)).toEqual({ text: "No backup yet. One is made every night.", tone: "quiet" });
  });
  it("speaks up when the last backup failed", () => {
    const line = backupLine(status(run("2026-11-16T08:15:04Z", 0), run("2026-11-15T08:15:04Z")), now, TZ);
    expect(line).toEqual({ text: "The last backup did not work. The newest copy is from yesterday at 3:15 AM.", tone: "problem" });
  });
  it("speaks up when the only backup ever tried failed", () => {
    expect(backupLine(status(run("2026-11-16T08:15:04Z", 0), null), now, TZ).tone).toBe("problem");
  });
  it("speaks up when a night was missed", () => {
    const r = run("2026-11-13T08:15:04Z");
    expect(backupLine(status(r, r), now, TZ)).toEqual({ text: "No backup since Nov 13 at 3:15 AM.", tone: "problem" });
  });
});
