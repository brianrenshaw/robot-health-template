// access.ts
// Verifies the Cloudflare Access login on every request. Fails closed:
// if anything is missing or wrong, the request is refused. There is no open fallback.

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessEnv {
  ENVIRONMENT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
}

export type AccessResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function teamOrigin(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${d}`;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export async function verifyAccess(req: Request, env: AccessEnv): Promise<AccessResult> {
  const url = new URL(req.url);

  // Local development only: both the variable and a localhost hostname are required.
  if (env.ENVIRONMENT === "local" && isLocalHost(url.hostname)) {
    return { ok: true, email: "local-dev" };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL) {
    return { ok: false, status: 503, error: "Access is not configured on this Worker. Refusing to serve data." };
  }

  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, error: "Missing Cloudflare Access token. Sign in first." };

  const issuer = teamOrigin(env.ACCESS_TEAM_DOMAIN);
  let jwks = jwksByTeam.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByTeam.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    const email = String(payload.email ?? "").toLowerCase();
    const allowed = env.OWNER_EMAIL.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!email || !allowed.includes(email)) {
      return { ok: false, status: 403, error: "This account is not allowed." };
    }
    return { ok: true, email };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired Cloudflare Access token." };
  }
}
