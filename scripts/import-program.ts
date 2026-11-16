// Loads a lifting program into the health database and makes it the active one.
//   npx tsx scripts/import-program.ts <program.json>            the real database (needs CLOUDFLARE_API_TOKEN)
//   npx tsx scripts/import-program.ts <program.json> --local    the local development database
//
// <program.json> comes from scripts/parse-program.py. It is copyrighted material: keep it in a
// scratch folder, never in the repository.
//
// The write goes through the same core function everything else uses (importProgram), so it is
// checked and recorded like any other change. A program already active is archived, not deleted.

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importProgram, type Db, type Param } from "@health/core";

const ROOT = join(import.meta.dirname, "..");
const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("Usage: npx tsx scripts/import-program.ts <program.json> [--local]");

/** The local development database that `wrangler dev` uses. */
function localDb(): Db {
  const dir = join(ROOT, "workers/app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  const name = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  if (!name) throw new Error("No local database yet. Run `npm run db:migrate:local` first.");
  const raw = new DatabaseSync(join(dir, name));
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

/** The real database, through Cloudflare's API. The account and database ids are read from wrangler.jsonc. */
function remoteDb(): Db {
  const config = readFileSync(join(ROOT, "workers/app/wrangler.jsonc"), "utf8");
  const account = /"account_id":\s*"([0-9a-f]+)"/.exec(config)?.[1];
  const database = /"database_id":\s*"([0-9a-f-]+)"/.exec(config)?.[1];
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !database || !token) throw new Error("Need CLOUDFLARE_API_TOKEN, and account_id and database_id in workers/app/wrangler.jsonc.");
  const query = async (sql: string, params: Param[]) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const body = (await res.json()) as { success: boolean; errors?: { message: string }[]; result?: { results: unknown[] }[] };
    if (!body.success) throw new Error(`Database refused: ${body.errors?.map((e) => e.message).join("; ")}`);
    return body.result?.[0]?.results ?? [];
  };
  return {
    all: async <T>(sql: string, params: Param[] = []) => (await query(sql, params)) as T[],
    first: async <T>(sql: string, params: Param[] = []) => ((await query(sql, params))[0] as T | undefined) ?? null,
    run: async (sql: string, params: Param[] = []) => void (await query(sql, params)),
  };
}

const local = flag === "--local";
const result = await importProgram({ db: local ? localDb() : remoteDb(), actor: "import" }, JSON.parse(readFileSync(file, "utf8")));
console.log(`Loaded "${result.program.name}" into the ${local ? "local" : "real"} database: ${result.sessions} sessions, ${result.exercises} exercises.`);
