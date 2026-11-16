// Every call the page makes to the server is in this file.

import { QueryClient } from "@tanstack/react-query";
import type { BackupRun, BackupStatus, CoachBrief, DayView, FieldInfo, JournalEntry, LiftProgress, MacroView, ProgramProgress, Review, Trend, Workout } from "@health/core";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});

export interface Status {
  email: string;
  backup: BackupStatus;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) {
    // When the login has run out, Cloudflare answers instead of the Worker. Reloading the page
    // sends the browser through the sign-in again.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The server did not answer. Reload the page to sign in again.");
  }
  return (await res.json()) as T;
}

export const getStatus = () => call<Status>("/api/status");
export const backUpNow = () => call<{ run: BackupRun; backup: BackupStatus }>("/api/backup", { method: "POST" });

/** Everything the dashboard shows. `days` and `workouts` cover twice `range`, oldest first. */
export interface Dashboard {
  today: string;
  /** How many days the page is looking at: 30, 90 or 365. */
  range: number;
  /** The first day of the range itself (the rows reach back twice as far). */
  days_from: string;
  fields: FieldInfo[];
  days: DayView[];
  workouts: Workout[];
  /** Every day he logged lifting sets. */
  lift_days: string[];
  /** Each lift's heaviest set per day, most recently done first. */
  lifts: LiftProgress[];
  /** Plain sentences worked out from the record. */
  trends: Trend[];
  /** The coach's latest written review, if there is one. */
  review: Review | null;
  brief: CoachBrief;
  /** The place the forecast in brief.days_ahead is for. */
  forecast_for: string;
  journal: JournalEntry[];
  /** How far through the lifting program he is, for the ring. */
  program: ProgramProgress | null;
  /** Food against his food app's targets: today, this week, the weeks' averages, every check-in. */
  macros: MacroView;
}
export const getDashboard = (days: number) => call<Dashboard>(`/api/dashboard?days=${days}`);
