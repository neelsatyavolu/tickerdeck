import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_MAIL_FROM } from "../mail/authEmails";
import { sendEmail } from "../mail/send";
import { EVENT_ID, LINK_TOKEN, LINK_URL, magicLinkEvent, newSigningKey, signedRequest, type SigningKey } from "../../test/neonWebhook";
import { handleAuthWebhook } from "./webhook";
import { createKeyLookup } from "./webhookSignature";

const JWKS_URL = "https://ep-test.neonauth.example/neondb/auth/.well-known/jwks.json";
const RESEND_URL = "https://api.resend.com/emails";
const API_KEY = "re_test_secret_key";
const NOW = 1_800_000_000_000;

type Sent = { headers: Record<string, string>; body: { from: string; to: string[]; subject: string; html: string; text: string } };

/** Neon's key set and Resend behind one fake fetch, wired into the handler the way the route wires them. */
function world(keys: SigningKey[], options: { resend?: number | "down"; jwks?: number } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    if (input === JWKS_URL) return Response.json({ keys: keys.map((k) => k.jwk) }, { status: options.jwks ?? 200 });
    if (input !== RESEND_URL) throw new Error(`unexpected request to ${String(input)}`);
    if (options.resend === "down") throw new TypeError("fetch failed");
    sent.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return Response.json({ id: "email-1" }, { status: options.resend ?? 200 });
  });
  const deps = {
    findKey: createKeyLookup(() => JWKS_URL, fetchImpl, () => NOW),
    now: () => NOW,
    send: (mail: Parameters<typeof sendEmail>[0]) => sendEmail(mail, { apiKey: API_KEY, from: AUTH_MAIL_FROM }, fetchImpl),
  };
  return { sent, fetchImpl, post: (request: Request) => handleAuthWebhook(request, deps) };
}

const key = newSigningKey("kid-1");
const body = (eventData?: Record<string, unknown>, rest?: Record<string, unknown>) => JSON.stringify(magicLinkEvent(eventData, rest));

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
});

afterEach(() => {
  // Nothing the handler logs may let someone use the link or the keys.
  for (const line of logged) {
    expect(line).not.toContain(LINK_TOKEN);
    expect(line).not.toContain("reset-password/");
    expect(line).not.toContain(API_KEY);
    expect(line).not.toContain("ada@example.com");
  }
  vi.restoreAllMocks();
});

describe("handleAuthWebhook", () => {
  it("emails the reset link to the user and answers 200", async () => {
    const { post, sent } = world([key]);
    const response = await post(signedRequest(key, body(), { timestamp: NOW }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.from).toBe("TickerQuill <no-reply@n3el.dev>");
    expect(sent[0].body.to).toEqual(["ada@example.com"]);
    expect(sent[0].body.subject).toBe("Reset your TickerQuill password");
    expect(sent[0].body.html).toContain(`href="${LINK_URL.replace(/&/g, "&amp;")}"`);
    expect(sent[0].body.text).toContain(`Reset password: ${LINK_URL}`);
    expect(sent[0].headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("picks the copy by link type", async () => {
    const subjects = {
      "forget-password": "Reset your TickerQuill password",
      "email-verification": "Confirm your email for TickerQuill",
      "sign-in": "Your TickerQuill sign-in link",
    };
    for (const [link_type, subject] of Object.entries(subjects)) {
      const { post, sent } = world([key]);
      const response = await post(signedRequest(key, body({ link_type }), { timestamp: NOW }));
      expect(response.status).toBe(200);
      expect(sent.map((s) => s.body.subject)).toEqual([subject]);
    }
  });

  it("passes the event id to Resend so a retried delivery cannot email twice", async () => {
    const { post, sent } = world([key]);
    await post(signedRequest(key, body(), { timestamp: NOW }));
    await post(signedRequest(key, body(), { timestamp: NOW, headers: { "x-neon-delivery-attempt": "2" } }));
    expect(sent.map((s) => s.headers["Idempotency-Key"])).toEqual([EVENT_ID, EVENT_ID]);
  });

  it("takes the event id from the signed body, and from the header only when the body has none", async () => {
    const { post, sent } = world([key]);
    await post(signedRequest(key, body(), { timestamp: NOW, headers: { "x-neon-event-id": "changed-in-transit" } }));
    await post(signedRequest(key, body({}, { event_id: undefined }), { timestamp: NOW, headers: { "x-neon-event-id": "from-header" } }));
    await post(signedRequest(key, body({}, { event_id: undefined }), { timestamp: NOW, headers: { "x-neon-event-id": null } }));
    expect(sent.map((s) => s.headers["Idempotency-Key"])).toEqual([EVENT_ID, "from-header", undefined]);
  });

  it("still sends the email when the event id in the body is unusable", async () => {
    const { post, sent } = world([key]);
    for (const event_id of [null, "", 42, "x".repeat(300)]) {
      const response = await post(signedRequest(key, body({}, { event_id }), { timestamp: NOW, headers: { "x-neon-event-id": "from-header" } }));
      expect(response.status, String(event_id).slice(0, 10)).toBe(200);
    }
    expect(sent.map((s) => s.headers["Idempotency-Key"])).toEqual(["from-header", "from-header", "from-header", "from-header"]);
  });

  it("answers 401 to a body that was changed after signing", async () => {
    const { post, sent } = world([key]);
    const original = signedRequest(key, body(), { timestamp: NOW });
    const tampered = new Request(original.url, { method: "POST", headers: original.headers, body: body({ link_url: "https://evil.example/phish" }) });
    const response = await post(tampered);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Invalid signature." });
    expect(sent).toHaveLength(0);
  });

  it("answers 401 to a key id Neon has not published", async () => {
    const { post, sent } = world([key]);
    const response = await post(signedRequest(newSigningKey("kid-other"), body(), { timestamp: NOW }));
    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("answers 401 to a stale timestamp", async () => {
    const { post, sent } = world([key]);
    const response = await post(signedRequest(key, body(), { timestamp: NOW - 5 * 60_000 - 1 }));
    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("answers 401 when the signature headers are missing", async () => {
    const { post, sent, fetchImpl } = world([key]);
    for (const header of ["x-neon-signature", "x-neon-signature-kid", "x-neon-timestamp"]) {
      const response = await post(signedRequest(key, body(), { timestamp: NOW, headers: { [header]: null } }));
      expect(response.status).toBe(401);
    }
    expect(sent).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 200 without emailing for an event type it does not handle, and logs it", async () => {
    const { post, sent } = world([key]);
    const response = await post(signedRequest(key, JSON.stringify({ event_id: EVENT_ID, event_type: "user.created", user: { id: "user-1" } }), { timestamp: NOW }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(logged.join("\n")).toContain("user.created");
  });

  it("answers 200 without emailing for a link type it does not handle, and logs it", async () => {
    const { post, sent } = world([key]);
    const response = await post(signedRequest(key, body({ link_type: "delete-account" }), { timestamp: NOW }));

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(logged.join("\n")).toContain("delete-account");
  });

  it("answers 400 to a signed payload that is malformed", async () => {
    const { post, sent } = world([key]);
    const malformed = [
      "not json",
      "null",
      JSON.stringify({ event_id: EVENT_ID }),
      body({}, { user: undefined }),
      body({}, { user: { id: "user-1", email: "not-an-email" } }),
      body({ link_url: undefined }),
      body({ link_type: 7 }),
      body({}, { event_data: "nope" }),
    ];
    for (const raw of malformed) {
      const response = await post(signedRequest(key, raw, { timestamp: NOW }));
      expect(response.status, raw.slice(0, 60)).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "Malformed payload." });
    }
    expect(sent).toHaveLength(0);
  });

  it("answers 400 to a link that is not https", async () => {
    const { post, sent } = world([key]);
    for (const link_url of ["http://ep-test.neonauth.example/reset-password/abc", "javascript:alert(1)", "//evil.example/x", "ftp://x.example/y", "not a url"]) {
      const response = await post(signedRequest(key, body({ link_url }), { timestamp: NOW }));
      expect(response.status, link_url).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });

  it("answers 500 when Resend refuses or cannot be reached, so Neon retries", async () => {
    for (const resend of [500, 429, 401, "down"] as const) {
      const response = await world([key], { resend }).post(signedRequest(key, body(), { timestamp: NOW }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: "Could not send the email." });
    }
    expect(logged.join("\n")).toContain("Resend refused the email (HTTP 500)");
  });

  it("answers 500 when the signing keys cannot be loaded, so Neon retries", async () => {
    const { post, sent } = world([key], { jwks: 503 });
    const response = await post(signedRequest(key, body(), { timestamp: NOW }));
    expect(response.status).toBe(500);
    expect(sent).toHaveLength(0);
  });

  it("logs a missing setting by name", async () => {
    const deps = {
      findKey: createKeyLookup(() => JWKS_URL, world([key]).fetchImpl, () => NOW),
      now: () => NOW,
      send: async () => { throw new Error("RESEND_API_KEY is not set"); },
    };
    const response = await handleAuthWebhook(signedRequest(key, body(), { timestamp: NOW }), deps);
    expect(response.status).toBe(500);
    expect(logged.join("\n")).toContain("RESEND_API_KEY is not set");
  });

  it("answers 500 even when the failure is not an Error", async () => {
    const deps = { findKey: createKeyLookup(() => JWKS_URL, world([key]).fetchImpl, () => NOW), now: () => NOW, send: async () => { throw "boom"; } };
    const response = await handleAuthWebhook(signedRequest(key, body(), { timestamp: NOW }), deps);
    expect(response.status).toBe(500);
    expect(logged.join("\n")).toContain("could not send the email: unknown error");
  });

  it("keeps every answer far below Neon's 10 KB limit", async () => {
    const { post } = world([key]);
    const answers = [
      await post(signedRequest(key, body(), { timestamp: NOW })),
      await post(signedRequest(key, "not json", { timestamp: NOW })),
      await post(signedRequest(key, body(), { timestamp: 1 })),
    ];
    for (const response of answers) expect((await response.text()).length).toBeLessThan(200);
  });
});
