import { describe, expect, it, vi, afterEach } from "vitest";
import { createStreamTicket, verifyStreamTicket } from "./streamTicket";

const secret = "a-test-secret-with-at-least-32-characters";
afterEach(() => vi.useRealTimers());

describe("stream tickets", () => {
  it("accepts a fresh ticket and gives each connection a different ticket", async () => {
    const ticket = await createStreamTicket(secret);
    expect(await verifyStreamTicket(ticket, secret)).toBe(true);
    expect(await createStreamTicket(secret)).not.toBe(ticket);
  });

  it("rejects a ticket signed with another secret or changed after signing", async () => {
    const ticket = await createStreamTicket(secret);
    expect(await verifyStreamTicket(ticket, "different-secret")).toBe(false);
    const [payload, signature] = ticket.split(".");
    expect(await verifyStreamTicket(`${payload}x.${signature}`, secret)).toBe(false);
  });

  it("rejects expired tickets", async () => {
    vi.useFakeTimers();
    const ticket = await createStreamTicket(secret);
    vi.advanceTimersByTime(60_000);
    expect(await verifyStreamTicket(ticket, secret)).toBe(false);
  });

  it.each(["", "garbage", "a.b", "a.b.c", "%%%.$$$"])("rejects malformed ticket %s", async (ticket) => {
    expect(await verifyStreamTicket(ticket, secret)).toBe(false);
  });
});
