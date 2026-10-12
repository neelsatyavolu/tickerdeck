import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PriceFanout } from "./fanout.js";

class Socket extends EventTarget {
  sent = [];
  attachment = null;
  closed = false;
  send(data) { this.sent.push(JSON.parse(data)); }
  serializeAttachment(data) { this.attachment = data; }
  close() { this.closed = true; this.dispatchEvent(new Event("close")); }
  frame(data) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
}

let upstream, connect, feed;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const command = (socket, symbol, type = "subscribe") => feed.message(socket, JSON.stringify({ type, symbol }));
const client = () => { const socket = new Socket(); feed.addClient(socket); return socket; };
const trades = (socket) => socket.sent.filter((frame) => frame.type === "trade");

beforeEach(() => {
  vi.useFakeTimers();
  upstream = new Socket();
  connect = vi.fn(async () => upstream);
  feed = new PriceFanout(connect);
});
afterEach(() => vi.useRealTimers());

it("shares one upstream and retains overlapping subscriptions until the last owner leaves", async () => {
  const a = client(), b = client();
  command(a, "AAPL"); command(b, "AAPL"); command(b, "MSFT");
  await settle();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(upstream.sent).toEqual([{ type: "subscribe", symbol: "AAPL" }, { type: "subscribe", symbol: "MSFT" }]);
  command(a, "AAPL", "unsubscribe");
  expect(upstream.sent).toHaveLength(2);
  feed.removeClient(b);
  expect(upstream.closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("coalesces the newest trades, filters fanout, and replays the last price for new owners", async () => {
  const a = client(), b = client();
  command(a, "AAPL"); command(b, "MSFT"); await settle();
  upstream.frame({ type: "trade", data: [{ s: "AAPL", p: 10, t: 1 }, { s: "MSFT", p: 20, t: 2 }, { s: "SPY", p: 30, t: 3 }] });
  upstream.frame({ type: "trade", data: [{ s: "AAPL", p: 11, t: 4 }, { s: "AAPL", p: 9, t: 0 }] });
  expect(trades(a)).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(400);
  expect(trades(a)).toEqual([{ type: "trade", data: [{ s: "AAPL", p: 11, t: 4 }] }]);
  expect(trades(b)).toEqual([{ type: "trade", data: [{ s: "MSFT", p: 20, t: 2 }] }]);
  const c = client(); command(c, "AAPL");
  expect(trades(c)[0].data[0].p).toBe(11);
  command(a, "AAPL", "unsubscribe");
  expect(a.attachment).toEqual({ symbols: [] });
});

it("rejects malformed subscriptions and enforces the shared 50-symbol limit", async () => {
  const a = client(), b = client();
  for (const frame of ["garbage", "null", "[]", JSON.stringify({ type: "subscribe", symbol: "BINANCE:BTCUSDT" }), new ArrayBuffer(1)]) feed.message(a, frame);
  expect(connect).not.toHaveBeenCalled();
  for (let i = 0; i < 50; i++) command(a, `S${i}`);
  command(a, "TOOMANY");
  command(b, "S0"); command(b, "EXTRA"); await settle();
  expect(feed.symbols.size).toBe(50);
  expect(a.attachment.symbols).toHaveLength(50);
  expect(b.attachment.symbols).toEqual(["S0", "EXTRA"]);
  expect(b.sent.at(-1)).toEqual({ type: "status", connected: true });
  expect(b.sent.some((frame) => frame.type === "error")).toBe(true);
  upstream.frame({ type: "trade", data: [{ s: "S0", p: -1, t: 1 }, null, { s: "S1", p: 3, t: "invalid" }] });
  await vi.advanceTimersByTimeAsync(400);
  expect(trades(a)).toEqual([]);
});

it("reconnects once, resubscribes current owners, and cancels retries when the last client leaves", async () => {
  const a = client(), b = client(); command(a, "AAPL"); command(b, "AAPL"); await settle();
  upstream.close();
  expect(a.sent.at(-1)).toEqual({ type: "status", connected: false });
  command(b, "MSFT");
  expect(connect).toHaveBeenCalledTimes(1);
  upstream = new Socket(); await vi.advanceTimersByTimeAsync(1000);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(upstream.sent).toEqual([{ type: "subscribe", symbol: "AAPL" }, { type: "subscribe", symbol: "MSFT" }]);
  upstream.close(); feed.removeClient(a); feed.removeClient(b);
  await vi.advanceTimersByTimeAsync(30000);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps increasing backoff until an actual trade succeeds and sanitizes provider errors", async () => {
  const a = client(); command(a, "AAPL"); await settle();
  upstream.frame({ type: "error", msg: "secret-api-key" });
  expect(a.sent).toContainEqual({ type: "error", message: "Market price provider unavailable" });
  expect(JSON.stringify(a.sent)).not.toContain("secret-api-key");
  upstream = new Socket(); await vi.advanceTimersByTimeAsync(1000); upstream.close();
  upstream = new Socket(); await vi.advanceTimersByTimeAsync(1000);
  expect(connect).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(connect).toHaveBeenCalledTimes(3);
  upstream.frame({ type: "trade", data: [{ s: "AAPL", p: 10, t: 1 }] }); upstream.close();
  upstream = new Socket(); await vi.advanceTimersByTimeAsync(1000);
  expect(connect).toHaveBeenCalledTimes(4);
});

it("does not start duplicate connections when clients leave and return during a handshake", async () => {
  let resolve;
  connect.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const a = client(); command(a, "AAPL"); feed.removeClient(a);
  const b = client(); command(b, "MSFT");
  expect(connect).toHaveBeenCalledTimes(1);
  const stale = new Socket(); resolve(stale); await settle();
  expect(stale.closed).toBe(true);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(upstream.sent).toEqual([{ type: "subscribe", symbol: "MSFT" }]);
});

it("restores socket subscription attachments and releases only the last owner", async () => {
  const a = new Socket(), b = new Socket();
  feed.addClient(a, ["AAPL", "MSFT"]); feed.addClient(b, ["AAPL"]); await settle();
  feed.removeClient(a);
  expect(upstream.sent.at(-1)).toEqual({ type: "unsubscribe", symbol: "MSFT" });
  expect(upstream.closed).toBe(false);
  feed.removeClient(b);
  expect(upstream.closed).toBe(true);
});

it("promotes waiting subscriptions when another browser releases capacity", async () => {
  const a = client(), b = client();
  for (let i = 0; i < 50; i++) command(a, `S${i}`);
  command(b, "EXTRA"); await settle();
  expect(feed.symbols.size).toBe(50);
  command(a, "S0", "unsubscribe");
  expect(feed.symbols.size).toBe(50);
  expect(upstream.sent.at(-1)).toEqual({ type: "subscribe", symbol: "EXTRA" });
  expect(b.attachment.symbols).toEqual(["EXTRA"]);
  upstream.frame({ type: "trade", data: [{ s: "EXTRA", p: 10, t: 1 }] });
  await vi.advanceTimersByTimeAsync(400);
  expect(trades(b)).toEqual([{ type: "trade", data: [{ s: "EXTRA", p: 10, t: 1 }] }]);
});

it("does not promote cancelled waiting interests", async () => {
  const a = client(), b = client(), c = client();
  for (let i = 0; i < 50; i++) command(a, `S${i}`);
  command(b, "CANCELLED"); command(c, "GONE"); await settle();
  command(b, "CANCELLED", "unsubscribe"); feed.removeClient(c);
  command(a, "S0", "unsubscribe");
  expect(feed.symbols.size).toBe(49);
  expect(upstream.sent.filter((frame) => frame.type === "subscribe").some((frame) => ["CANCELLED", "GONE"].includes(frame.symbol))).toBe(false);
});
