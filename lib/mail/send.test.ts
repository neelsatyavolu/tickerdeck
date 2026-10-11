import { describe, expect, it, vi } from "vitest";
import { MailError, sendEmail, type Mail } from "./send";

const API_KEY = "re_test_secret_key";
const config = { apiKey: API_KEY, from: "TickerQuill <no-reply@n3el.dev>" };
const mail: Mail = { to: "ada@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

const respond = (status: number) => vi.fn<typeof fetch>(async () => new Response(status < 300 ? '{"id":"1"}' : '{"message":"nope"}', { status }));

describe("sendEmail", () => {
  it("posts the message to Resend with the key as a bearer token", async () => {
    const fetchImpl = respond(200);
    await sendEmail(mail, config, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ from: config.from, to: ["ada@example.com"], subject: "Hello", html: "<p>Hi</p>", text: "Hi" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the idempotency key as a header, not in the body", async () => {
    const fetchImpl = respond(200);
    await sendEmail({ ...mail, idempotencyKey: "evt-123" }, config, fetchImpl);

    const init = fetchImpl.mock.calls[0][1];
    expect(init?.headers).toMatchObject({ "Idempotency-Key": "evt-123" });
    expect(String(init?.body)).not.toContain("evt-123");
  });

  it("throws on a non-2xx answer without leaking the key", async () => {
    for (const status of [401, 422, 429, 500]) {
      const error = await sendEmail(mail, config, respond(status)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MailError);
      expect((error as MailError).status).toBe(status);
      expect((error as MailError).message).toBe(`Resend refused the email (HTTP ${status})`);
      expect(JSON.stringify(error) + String(error) + (error as MailError).stack).not.toContain(API_KEY);
    }
  });

  it("lets a network failure reach the caller", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError("fetch failed"); });
    await expect(sendEmail(mail, config, fetchImpl)).rejects.toThrow("fetch failed");
  });
});
