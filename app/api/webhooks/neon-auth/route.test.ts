import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_ID, magicLinkEvent, newSigningKey, signedRequest } from "@/test/neonWebhook";
import { POST } from "./route";

const AUTH_URL = "https://ep-route.neonauth.example/neondb/auth";
const key = newSigningKey("kid-route");
const body = JSON.stringify(magicLinkEvent());

let resendCalls: RequestInit[] = [];
let logged: string[] = [];

beforeEach(() => {
  resendCalls = [];
  logged = [];
  vi.stubEnv("NEON_AUTH_BASE_URL", `${AUTH_URL}/`);
  vi.stubEnv("RESEND_API_KEY", "re_route_key");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    if (input === `${AUTH_URL}/.well-known/jwks.json`) return Response.json({ keys: [key.jwk] });
    if (input !== "https://api.resend.com/emails") throw new Error(`unexpected request to ${String(input)}`);
    resendCalls.push(init ?? {});
    return Response.json({ id: "email-1" });
  }));
  for (const level of ["warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/neon-auth", () => {
  it("verifies against the project's JWKS and sends through Resend with the configured key", async () => {
    const response = await POST(signedRequest(key, body, { timestamp: Date.now() }));

    expect(response.status).toBe(200);
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].headers).toMatchObject({ Authorization: "Bearer re_route_key", "Idempotency-Key": EVENT_ID });
    expect(JSON.parse(String(resendCalls[0].body))).toMatchObject({ from: "TickerQuill <no-reply@n3el.dev>", to: ["ada@example.com"] });
  });

  it("answers 401 to an unsigned request", async () => {
    const response = await POST(new Request("https://tickerquill.n3el.dev/api/webhooks/neon-auth", { method: "POST", body }));
    expect(response.status).toBe(401);
    expect(resendCalls).toHaveLength(0);
  });

  it("answers 500 and names RESEND_API_KEY when it is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const response = await POST(signedRequest(key, body, { timestamp: Date.now() }));

    expect(response.status).toBe(500);
    expect(resendCalls).toHaveLength(0);
    expect(logged.join("\n")).toContain("RESEND_API_KEY is not set");
  });
});
