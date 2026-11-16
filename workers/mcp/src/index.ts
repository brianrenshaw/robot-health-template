// The chatbot Worker.
//   /mcp            Remote MCP server (Streamable HTTP, stateless). One way in: an OAuth token,
//                   which a chat app (Claude on the phone and the web) gets only after the owner
//                   signs in on /authorize and presses Allow.
//   /authorize      The sign-in and Allow / Deny page. Behind Cloudflare Access, and the login is
//                   verified again here.
//   /oauth/token, /oauth/register, /.well-known/...   Served by the OAuth library.
//   /health         Liveness check, no data.
// Fails closed: without a valid OAuth token, /mcp answers 401.
//
// Unlike the project dashboard's chatbot Worker there is NO long-lived token that opens /mcp.
// MCP_TOKEN works only on a developer's own machine (ENVIRONMENT=local and a localhost address),
// for scripts/mcp-smoke.ts. Do not add one for production without the owner asking.

import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { d1, dbKv, type AccessEnv, type Ctx } from "@health/core";
import { clientSlug, handleAuthorize } from "./authorize";
import { buildServer } from "./tools";

interface Env extends AccessEnv {
  DB: D1Database;
  /** Local development only. Ignored unless ENVIRONMENT=local and the request is to localhost. */
  MCP_TOKEN?: string;
  /** The page's address, for the links the chatbot hands back. */
  APP_URL: string;
  /** Public address of this Worker, no trailing slash. Overridden with --var for local dev. */
  PUBLIC_URL: string;
  /** Set to "1" to record each sign-in request (never tokens, never /mcp bodies) for one day. */
  DEBUG_LOG?: string;
  OAUTH_KV: ReturnType<typeof dbKv>;
  OAUTH_PROVIDER: OAuthHelpers;
}

interface Props {
  /** Short client label: "claude", ... Becomes the actor "mcp:<client>" in the change record. */
  client: string;
}

const SCOPE = "health";

/** Compare two secrets without leaking, through timing, how much of them matched. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function isLocal(req: Request, env: Env): boolean {
  const host = new URL(req.url).hostname;
  return env.ENVIRONMENT === "local" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

/** The protected MCP endpoint. Only reached with a valid OAuth token. */
const mcpHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: Props }).props;
    // One request is one tool call. Everything it changes shares this `op`, so "undo that" takes
    // the whole thing back together (packages/core/src/audit.ts).
    const callCtx: Ctx = { db: d1(env.DB), actor: `mcp:${props?.client ?? "unknown"}`, op: crypto.randomUUID() };
    return createMcpHandler(() => buildServer(callCtx, env.APP_URL), { route: "/mcp" })(req, env, ctx);
  },
};

/** Everything that is not /mcp or an OAuth library endpoint. */
const defaultHandler = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/authorize") return handleAuthorize(req, env, env.OAUTH_PROVIDER);
    return new Response("Not found", { status: 404 });
  },
};

function provider(env: Env) {
  const resource = `${env.PUBLIC_URL}/mcp`;
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpHandler as any,
    defaultHandler: defaultHandler as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    // Apps register themselves through /oauth/register, the route confirmed working with Claude
    // on the project dashboard (Nov 2026). Client ID Metadata Documents stay off, as there.
    clientIdMetadataDocumentEnabled: false,
    scopesSupported: [SCOPE],
    requiredScopes: [SCOPE],
    resourceMetadata: { resource, authorization_servers: [env.PUBLIC_URL], resource_name: "Health" },
    accessTokenTTL: 3600,
    // Stay connected as long as the app is used at least once every 90 days.
    refreshTokenTTL: 90 * 86400,
    refreshTokenIdleTTL: 90 * 86400,
    onError: (e) => {
      if (env.DEBUG_LOG === "1") {
        void env.OAUTH_KV.put(`debug:${Date.now()}:oauth-error`, JSON.stringify({ code: e.code, description: e.description, status: e.status }), { expirationTtl: 86400 });
      }
    },
    // Local development only (see the note at the top of this file).
    resolveExternalToken: async ({ token, request, env }) => {
      if (!isLocal(request, env) || !env.MCP_TOKEN || !safeEqual(token, env.MCP_TOKEN)) return null;
      return { props: { client: clientSlug(request.headers.get("X-Client-Name")) ?? "local" } satisfies Props, audience: resource };
    },
  });
}

// Some apps look for the discovery documents at alternate addresses. Answer those with the same
// documents the OAuth library serves at its standard ones.
const DISCOVERY_ALIASES: Record<string, string> = {
  "/.well-known/oauth-protected-resource": "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server/mcp": "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration": "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration/mcp": "/.well-known/oauth-authorization-server",
  "/mcp/.well-known/openid-configuration": "/.well-known/oauth-authorization-server",
};

/**
 * Troubleshooting aid (DEBUG_LOG=1): records what a chat app asked for while signing in and what
 * it was answered. Never tokens or cookies, and never the body of anything sent to or from /mcp,
 * because that is where health records travel.
 */
async function debugLogged(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const signIn = url.pathname.startsWith("/oauth/");
  let reqBody = "";
  if (req.method === "POST" && signIn) reqBody = (await req.clone().text()).slice(0, 600).replace(/(code|refresh_token|code_verifier|client_secret|access_token)=[^&]+/g, "$1=…");
  let res: Response;
  let thrown = "";
  try {
    res = await provider(env).fetch(req, env, ctx);
  } catch (e) {
    thrown = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    res = new Response("Internal error", { status: 500 });
  }
  let resBody = "";
  if (res.status >= 400 && url.pathname !== "/mcp") resBody = (await res.clone().text()).slice(0, 400);
  const auth = req.headers.get("Authorization");
  await env.OAUTH_KV.put(
    `debug:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
    JSON.stringify({
      m: req.method, path: url.pathname, query: url.search.replace(/=[^&]*/g, "").slice(0, 200), client_id: url.searchParams.get("client_id"),
      redirect_uri: url.searchParams.get("redirect_uri"), ua: req.headers.get("User-Agent"), accept: req.headers.get("Accept"),
      proto: req.headers.get("MCP-Protocol-Version"), auth: auth ? `${auth.split(" ")[0]} (${auth.length} chars)` : null,
      access_jwt: !!req.headers.get("Cf-Access-Jwt-Assertion"), status: res.status, location: (res.headers.get("Location") ?? "").replace(/code=[^&]+/, "code=…").slice(0, 200),
      reqBody, resBody, thrown,
    }),
    { expirationTtl: 86400 },
  );
  return res;
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The OAuth library stores its records through env.OAUTH_KV; back it with the D1 table.
    const withStore: Env = { ...env, OAUTH_KV: dbKv(d1(env.DB)) };
    const alias = DISCOVERY_ALIASES[new URL(req.url).pathname];
    if (alias && req.method === "GET") req = new Request(new URL(alias, req.url), req);
    if (env.DEBUG_LOG !== "1") return provider(withStore).fetch(req, withStore, ctx);
    return debugLogged(req, withStore, ctx);
  },
} satisfies ExportedHandler<Env>;
