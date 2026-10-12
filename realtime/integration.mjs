// Optional platform check: bundle with `wrangler deploy --dry-run --outdir <bundle>` first.
// MINIFLARE_PATH may point to an existing Wrangler installation's miniflare package.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createStreamTicket } from "../lib/market/streamTicket.ts";

const require = createRequire(import.meta.url);
const { Miniflare, Response, WebSocketPair } = require(process.env.MINIFLARE_PATH || "miniflare");
const secret = "local-test-price-secret";
const providerSockets = [];
const subscriptions = [];
const mf = new Miniflare({
  modules: true,
  scriptPath: resolve(process.argv[2]),
  modulesRoot: dirname(resolve(process.argv[2])),
  compatibilityDate: "2026-10-12",
  bindings: { PRICE_STREAM_SECRET: secret, FINNHUB_API_KEY: "local-test-provider-key" },
  durableObjects: { PRICE_STREAM: { className: "PriceStream", useSQLite: true } },
  outboundService: async (request) => {
    // Yahoo is tried first; refusing it here exercises the Finnhub fallback.
    if (new URL(request.url).hostname === "streamer.finance.yahoo.com") return new Response("Unavailable", { status: 503 });
    assert.equal(new URL(request.url).hostname, "ws.finnhub.io");
    assert.equal(request.headers.get("Upgrade"), "websocket");
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener("message", (event) => subscriptions.push(JSON.parse(event.data)));
    server.addEventListener("close", () => server.close());
    providerSockets.push(server);
    return new Response(null, { status: 101, webSocket: client });
  },
});

async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Platform check timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

try {
  const unauthenticated = await mf.dispatchFetch("https://prices.test/stream?ticket=invalid", { headers: { Upgrade: "websocket" } });
  assert.equal(unauthenticated.status, 401);
  assert.equal(providerSockets.length, 0);
  const ticket = await createStreamTicket(secret);
  const missingUpgrade = await mf.dispatchFetch(`https://prices.test/stream?ticket=${ticket}`);
  assert.equal(missingUpgrade.status, 426);
  const connected = [];
  for (let i = 0; i < 2; i++) {
    const response = await mf.dispatchFetch(`https://prices.test/stream?ticket=${ticket}`, { headers: { Upgrade: "websocket" } });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    socket.accept();
    const frames = [];
    socket.addEventListener("message", (event) => frames.push(JSON.parse(event.data)));
    connected.push({ socket, frames });
    socket.send(JSON.stringify({ type: "subscribe", symbol: "AAPL" }));
  }
  connected[1].socket.send(JSON.stringify({ type: "subscribe", symbol: "MSFT" }));
  await until(() => subscriptions.length === 2);
  assert.equal(providerSockets.length, 1);
  assert.deepEqual(subscriptions, [{ type: "subscribe", symbol: "AAPL" }, { type: "subscribe", symbol: "MSFT" }]);
  await until(() => connected.every(({ frames }) => frames.some((frame) => frame.type === "status" && frame.connected)));
  providerSockets[0].send(JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 123, t: 1 }, { s: "MSFT", p: 456, t: 2 }] }));
  await until(() => connected.every(({ frames }) => frames.some((frame) => frame.type === "trade")));
  assert.deepEqual(connected[0].frames.find((frame) => frame.type === "trade").data, [{ s: "AAPL", p: 123, t: 1 }]);
  assert.deepEqual(connected[1].frames.find((frame) => frame.type === "trade").data, [{ s: "AAPL", p: 123, t: 1 }, { s: "MSFT", p: 456, t: 2 }]);
  // A handshake timeout must never abort an already-upgraded provider connection.
  await new Promise((resolve) => setTimeout(resolve, 12000));
  assert.equal(providerSockets.length, 1, "Provider must remain connected beyond the handshake timeout");
  assert.equal(providerSockets[0].readyState, 1);
  providerSockets[0].send(JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 124, t: 3 }, { s: "MSFT", p: 457, t: 4 }] }));
  await until(() => connected.every(({ frames }) => frames.filter((frame) => frame.type === "trade").length === 2));
  for (const { frames } of connected) {
    assert.deepEqual(frames.filter((frame) => frame.type === "status").map((frame) => frame.connected), [false, true]);
    assert.equal(frames.filter((frame) => frame.type === "trade")[1].data[0].t, 3);
  }
  connected[0].socket.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(providerSockets[0].readyState, 1);
  connected[1].socket.close();
  await until(() => providerSockets[0].readyState === 3);
  console.log("Miniflare: authentication, single upstream, sustained trades beyond handshake timeout, subscription filtering, and last-client cleanup passed");
} finally {
  await mf.dispose();
}
