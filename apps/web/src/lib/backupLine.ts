// The one line the page shows about backups. Quiet when all is well; it only asks for attention
// when the last backup failed or there has been none for more than a day and a half.

import type { BackupStatus } from "@health/core";

export interface BackupLine {
  text: string;
  /** "problem" is drawn in the error color. Everything else is faint. */
  tone: "quiet" | "problem";
}

const HOUR = 60 * 60 * 1000;
/** A nightly backup that is this old means a night was missed. */
const STALE_AFTER = 36 * HOUR;

/** `timeZone` is only passed by tests; the page uses the browser's own. */
export function backupLine(status: BackupStatus, now = new Date(), timeZone?: string): BackupLine {
  const good = status.last_ok ? new Date(status.last_ok.finished_at) : null;
  const failed = status.last !== null && status.last.ok === 0;

  if (!good) {
    return failed
      ? { text: "The backup did not work, and there is no copy yet.", tone: "problem" }
      : { text: "No backup yet. One is made every night.", tone: "quiet" };
  }
  if (failed) {
    return { text: `The last backup did not work. The newest copy is from ${when(good, now, timeZone)}.`, tone: "problem" };
  }
  if (now.getTime() - good.getTime() > STALE_AFTER) {
    return { text: `No backup since ${when(good, now, timeZone)}.`, tone: "problem" };
  }
  return { text: `Backed up ${when(good, now, timeZone)}`, tone: "quiet" };
}

/** "today at 3:15 AM", "yesterday at 3:15 AM", "Nov 12 at 3:15 AM". */
function when(date: Date, now: Date, timeZone?: string): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  const yesterday = new Date(now.getTime() - 24 * HOUR);
  if (day(date) === day(now)) return `today at ${time}`;
  if (day(date) === day(yesterday)) return `yesterday at ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date)} at ${time}`;
}
