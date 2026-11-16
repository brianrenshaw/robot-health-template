import { describe, expect, it } from "vitest";
import { verifyAccess } from "../src/access";

const configured = { ENVIRONMENT: "production", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud", OWNER_EMAIL: "me@example.com" };

describe("Access verification fails closed", () => {
  it("refuses when Access is not configured", async () => {
    const r = await verifyAccess(new Request("https://health.example.com/api/status"), { ENVIRONMENT: "production" });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("refuses without a token", async () => {
    const r = await verifyAccess(new Request("https://health.example.com/api/status"), configured);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses a garbage token", async () => {
    const req = new Request("https://health.example.com/api/status", { headers: { "Cf-Access-Jwt-Assertion": "not.a.jwt" } });
    expect(await verifyAccess(req, configured)).toMatchObject({ ok: false, status: 401 });
  });
  it("only allows the dev bypass on localhost with ENVIRONMENT=local", async () => {
    expect((await verifyAccess(new Request("http://localhost:8787/api/status"), { ENVIRONMENT: "local" })).ok).toBe(true);
    expect((await verifyAccess(new Request("https://health.example.com/api/status"), { ENVIRONMENT: "local" })).ok).toBe(false);
    expect((await verifyAccess(new Request("http://localhost:8787/api/status"), { ENVIRONMENT: "production" })).ok).toBe(false);
  });
});
