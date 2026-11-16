// Local test of the OAuth sign-in used by chat apps (Claude on the web and phone).
// Needs the chatbot Worker running locally with ENVIRONMENT=local (see CLAUDE.md, "Running locally").
// It saves made-up numbers and a made-up workout for 2001-01-01 in the LOCAL database only. Never point it at the real one.
//   npx tsx scripts/oauth-smoke.ts
// Steps: discover, register an app, open the consent page, approve, swap the code for tokens,
// save and read back a day, refresh the token, and confirm a denied consent gives no access.

import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.MCP_BASE ?? "http://localhost:8788";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    console.log("      ", JSON.stringify(detail)?.slice(0, 500));
    process.exitCode = 1;
  }
}

async function mcp(token: string | null, body: unknown) {
  return fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function consent(clientId: string, decision: "approve" | "deny") {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: "health",
    state: "s123",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
  });
  const pageRes = await fetch(`${BASE}/authorize?${q}`);
  const html = await pageRes.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const cookie = (pageRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const post = await fetch(`${BASE}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Origin: BASE },
    body: new URLSearchParams({ handle, decision }),
  });
  return { html, status: pageRes.status, post, verifier, location: post.headers.get("Location") ?? "" };
}

async function main() {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) throw new Error("This test writes made-up numbers. It only runs against a local Worker.");
  const unauth = await mcp(null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const challengeHeader = unauth.headers.get("WWW-Authenticate") ?? "";
  check("no token gives 401 with a discovery pointer", unauth.status === 401 && challengeHeader.includes("resource_metadata"), challengeHeader);

  const prm: any = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  const asm: any = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check("discovery documents are served", prm.resource === `${BASE}/mcp` && !!asm.token_endpoint && !!asm.registration_endpoint, { prm, asm });

  const reg: any = await (
    await fetch(asm.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    })
  ).json();
  check("an app can register", !!reg.client_id, reg);

  const denied = await consent(reg.client_id, "deny");
  check("consent page names the app and where access goes", denied.status === 200 && denied.html.includes("Claude") && denied.html.includes("claude.ai"), denied.html.slice(0, 300));
  check("Deny sends the app away without a code", denied.location.includes("error=access_denied") && !denied.location.includes("code="), denied.location);

  const ok = await consent(reg.client_id, "approve");
  const code = new URL(ok.location || "http://x").searchParams.get("code") ?? "";
  check("Allow returns a code to the app", ok.post.status === 302 && !!code, { status: ok.post.status, location: ok.location });

  const tokenRes = await fetch(asm.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: ok.verifier, resource: `${BASE}/mcp` }),
  });
  const tokens: any = await tokenRes.json();
  check("code exchanges for access and refresh tokens", !!tokens.access_token && !!tokens.refresh_token, tokens);

  const list = await mcp(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  check("the OAuth token can list tools", list.status === 200, list.status);

  const tool = async (name: string, args: unknown) => {
    const res = await mcp(tokens.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });
    const text = await res.text();
    const json = text.includes("data:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text;
    const result = JSON.parse(json).result;
    return { isError: !!result?.isError, text: String(result?.content?.[0]?.text ?? "") };
  };
  const listText = await list.text();
  check("both tools are offered", listText.includes("get_health_data") && listText.includes("save_health_data"), listText.slice(0, 300));
  check("the macro target tools are offered", listText.includes("set_macro_targets") && listText.includes("get_macro_targets"), listText.slice(0, 300));
  const readMe = await tool("read_me_first", {});
  check("an app without the server's instructions can read them", !readMe.isError && readMe.text.includes("YOU ARE ALSO HIS COACH"), readMe.text.slice(0, 200));
  // A made-up check-in long ago: saved with a receipt, read back, then undone so it leaves nothing behind.
  const set = await tool("set_macro_targets", { effective_date: "2001-01-01", kcal: 2400, protein_g: 170, carbs_g: 250, fat_g: 80 });
  check("a check-in from his food app can be saved, with a one-line receipt", !set.isError && set.text.includes("Targets from Jan 1 (MacroFactor): 2,400 kcal"), set.text.slice(0, 300));
  const targets = JSON.parse((await tool("get_macro_targets", { from: "2001-01-01", to: "2001-01-31" })).text);
  check("and read back", targets.history?.[0]?.kcal === 2400 && targets.history[0].fiber_min_g === 30, targets);
  const undone = await tool("undo_last", {});
  check("and undone", undone.text.includes("1 set of macro targets"), undone.text.slice(0, 300));

  // Rows shaped the way Apple Health returns them (The owner's spec), for a day long ago.
  const bucket = (stats: Record<string, number>, unit: string) => ({ period_start: "2001-01-01T05:00:00Z", period_end: "2001-01-02T05:00:00Z", ...stats, unit });
  const saved = await tool("save_health_data", {
    statistics: [
      { type: "dietaryEnergyConsumed", rows: [bucket({ sum: 2000.0789999999995 }, "kcal")] },
      { type: "stepCount", rows: [bucket({ sum: 8000 }, "count")] },
      { type: "bodyMass", rows: [bucket({ average: 82 }, "kg")] },
    ],
    workouts: [{ start: "2001-01-01T15:00:00Z", end: "2001-01-01T16:00:00Z", value: { workout: { activity_type: "cycling", duration: 3600, total_distance: 20000 } } }],
  });
  check("a pull can be saved, with a one-line receipt", !saved.isError && saved.text.includes("Saved Jan 1: daily numbers for 1 day, 1 weigh-in, 1 workout."), saved.text.slice(0, 300));

  const read = JSON.parse((await tool("get_health_data", { from: "2001-01-01", to: "2001-01-01" })).text);
  const day = read.days?.[0] ?? {};
  check("the day reads back rounded, in pounds, on his local date, without numbers never sent", day.date === "2001-01-01" && day.kcal_eaten === 2000 && day.steps === 8000 && day.weight_lb === 180.8 && !("protein_g" in day), day);
  check("the workout reads back, in miles", read.workouts?.[0]?.activity_type === "cycling" && read.workouts[0].distance_mi === 12.4, read.workouts);

  const again = await tool("save_health_data", { workouts: [{ start: "2001-01-01T15:00:00Z", end: "2001-01-01T16:00:00Z", value: { workout: { activity_type: "cycling", duration: 3600 } } }] });
  check("pulling the same workout again adds no second copy", again.text.includes('"workouts_added": 0'), again.text.slice(0, 300));

  const slip = await tool("save_health_data", { statistics: [{ type: "stepCount", rows: [{ period_start: "2001-01-02T05:00:00Z", sum: 9e9 }] }] });
  check("a slip is refused in plain words", slip.isError && slip.text.includes("looks like a slip"), slip.text.slice(0, 300));
  const after = JSON.parse((await tool("get_health_data", { from: "2001-01-02", to: "2001-01-02" })).text);
  check("and nothing was saved for it", after.days.length === 0, after.days);

  const refreshed: any = await (
    await fetch(asm.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.client_id }),
    })
  ).json();
  check("the refresh token gets a new access token", !!refreshed.access_token, refreshed);

  const junk = await mcp("not-a-real-token", { jsonrpc: "2.0", id: 4, method: "tools/list" });
  check("a made-up token is refused", junk.status === 401, junk.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
