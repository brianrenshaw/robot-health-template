// The Worker. It serves the page (the built React app, bundled in by scripts/embed-web.ts), the
// JSON API under /api, and makes the nightly backup.
//
// Every request, to a page or to the API, must carry a valid Cloudflare Access login for the owner
// (packages/core/src/access.ts). If anything about the login is missing or wrong the request is
// refused. There is no open fallback.
//
// All data access goes through @health/core. No SQL here.

import { Hono } from "hono";
import {
  FIELDS, WEATHER_PLACE, addDays, backupStatus, buildTrends, coachBrief, d1, getForecast, latestReview, liftDays, liftProgress, listDays,
  listJournal, listWorkouts, macroView, programProgress, runBackup, todayInTz, verifyAccess,
  type AccessEnv, type Db,
} from "@health/core";
import { WEB_ASSETS } from "./web-assets.generated";

interface Env extends AccessEnv {
  /** The health database (D1). */
  DB: D1Database;
  /** The private bucket the nightly copies go to (R2). */
  BACKUPS: R2Bucket;
}

type Vars = { db: Db; email: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- login (fail closed), on everything ----------
app.use("*", async (c, next) => {
  const result = await verifyAccess(c.req.raw, c.env);
  if (!result.ok) {
    return new URL(c.req.url).pathname.startsWith("/api/")
      ? c.json({ error: result.error }, result.status)
      : c.text(result.error, result.status);
  }
  c.set("db", d1(c.env.DB));
  c.set("email", result.email);
  await next();
});

// ---------- API ----------
app.use("/api/*", async (c, next) => {
  // A change must come from the page itself. Browsers say where a request came from in the
  // Origin header; another site that tries to post here while the owner is signed in is refused.
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "This request did not come from the health page." }, 403);
    }
  }
  c.header("Cache-Control", "no-store");
  await next();
});

app.onError((err, c) => {
  // Log the kind of failure only. Never log request bodies or rows: this is health data.
  console.error("Request failed:", err instanceof Error ? err.message : String(err));
  return c.json({ error: "Something went wrong on the server. Check the Worker logs." }, 500);
});

/** Who is signed in, and how the backups stand. The page loads this once. */
app.get("/api/status", async (c) =>
  c.json({ email: c.var.email, backup: await backupStatus({ db: c.var.db, bucket: c.env.BACKUPS }) }),
);

const RANGES = [30, 90, 365];

/**
 * Everything the dashboard shows, in one request. `days` is how far back the page is looking
 * (30, 90 or 365). The day rows and workouts cover twice that, so every headline number can be
 * set against the stretch before it.
 */
app.get("/api/dashboard", async (c) => {
  const db = c.var.db;
  const today = todayInTz();
  const range = RANGES.includes(Number(c.req.query("days"))) ? Number(c.req.query("days")) : 30;
  const since = addDays(today, -(range * 2 - 1));
  const [days, workouts, lifted, lifts] = [
    await listDays(db, since, today),
    await listWorkouts(db, since, today),
    await liftDays(db, since),
    await liftProgress(db, addDays(today, -(Math.max(range, 120) - 1))),
  ];
  // The forecast is the one outside thing the site reads (packages/core/src/weather.ts): at most
  // once an hour, only when the page or the coach asks.
  const brief = await coachBrief(db, new Date(), { forecast: await getForecast(db) });
  return c.json({
    today,
    range,
    days_from: addDays(today, -(range - 1)), // the first day of the range itself
    fields: FIELDS,
    days,
    workouts,
    lift_days: lifted,
    lifts,
    trends: buildTrends({ today, range, days, workouts, liftDays: lifted, lifts }),
    review: await latestReview(db),
    brief,
    forecast_for: WEATHER_PLACE,
    program: await programProgress(db),
    journal: await listJournal(db, addDays(today, -29), today),
    // Food against the food app's targets: the targets now and their history, this week day by day,
    // and the week's averages (packages/core/src/macros.ts works it all out).
    macros: await macroView(db, days, today),
  });
});

/** "Back up now": make a copy right away, then report how the backups stand. */
app.post("/api/backup", async (c) => {
  const env = { db: c.var.db, bucket: c.env.BACKUPS };
  const run = await runBackup(env, "manual");
  return c.json({ run, backup: await backupStatus(env) });
});

app.all("/api/*", (c) => c.json({ error: "No such API route" }, 404));

// ---------- the page ----------
// Anything else is the React app. Hashed files under /assets/ are cached for a year; every other
// path gets index.html.
app.get("*", (c) => {
  const path = new URL(c.req.url).pathname;
  const file = WEB_ASSETS[path] ?? WEB_ASSETS["/index.html"]!;
  const body = file.base64 ? Uint8Array.from(atob(file.body), (ch) => ch.charCodeAt(0)) : file.body;
  return new Response(body, {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": path.startsWith("/assets/") ? "private, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
      // The page may only load its own files and talk to its own API.
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    },
  });
});

export default {
  fetch: app.fetch,
  // Runs on the timer set in wrangler.jsonc (`triggers.crons`), once a night: writes a copy of the
  // database to the private bucket and keeps the newest 30 (packages/core/src/backup.ts).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runBackup({ db: d1(env.DB), bucket: env.BACKUPS }, "nightly"));
  },
};
