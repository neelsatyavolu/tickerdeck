import { expect, it } from "vitest";
import { decodePricing, yahooUpstream } from "./yahoo.js";

// A frame captured from the streamer on 2026-10-12.
const AAPL = "CgRBQVBMFfb4qUMY0JfGl6ZoKgNOTVMwCDgBRYpUez9IwKnPDmUAhVNAsAG8AdgBBPUCAIVTQP0CilR7Pw==";

function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest >= 128) { bytes.push((rest % 128) | 128); rest = Math.floor(rest / 128); }
  return [...bytes, rest];
}

/** Encode the three fields the relay reads: id, price and time. */
function pricing(id, price, time) {
  const float = new Uint8Array(new Float32Array([price]).buffer);
  const bytes = [10, id.length, ...new TextEncoder().encode(id), 21, ...float, 24, ...varint(time * 2)];
  return JSON.stringify({ type: "pricing", message: btoa(String.fromCharCode(...bytes)) });
}

class Socket extends EventTarget {
  sent = [];
  closed = null;
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code, reason) { this.closed = { code, reason }; }
}

const listen = (upstream, type) => {
  const events = [];
  upstream.addEventListener(type, (event) => events.push(event));
  return events;
};

it("decodes the symbol, price and trade time from a pricing frame", () => {
  expect(decodePricing(AAPL)).toEqual({ id: "AAPL", price: 339.945, time: 1791831361000 });
});

it("rejects frames that are not pricing data", () => {
  expect(decodePricing("not base64!")).toBeNull();
  expect(decodePricing(btoa("\u0000"))).toBeNull();
  expect(decodePricing("")).toBeNull();
});

it("translates subscriptions to the streamer's symbols and trades back", () => {
  const socket = new Socket();
  const upstream = yahooUpstream(socket);
  const messages = listen(upstream, "message");
  upstream.send(JSON.stringify({ type: "subscribe", symbol: "BRK.B" }));
  expect(socket.sent).toEqual([{ subscribe: ["BRK-B"] }]);
  socket.dispatchEvent(new MessageEvent("message", { data: pricing("BRK-B", 512.25, 1791831361000) }));
  expect(messages.map((event) => JSON.parse(event.data))).toEqual([{ type: "trade", data: [{ s: "BRK.B", p: 512.25, t: 1791831361000 }] }]);
  upstream.send(JSON.stringify({ type: "unsubscribe", symbol: "BRK.B" }));
  expect(socket.sent[1]).toEqual({ unsubscribe: ["BRK-B"] });
});

it("drops prices for symbols nobody subscribed to and frames it cannot read", () => {
  const socket = new Socket();
  const upstream = yahooUpstream(socket);
  const messages = listen(upstream, "message");
  socket.dispatchEvent(new MessageEvent("message", { data: pricing("TSLA", 379.17, 1791831361000) }));
  socket.dispatchEvent(new MessageEvent("message", { data: "{" }));
  socket.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(4) }));
  expect(messages).toEqual([]);
});

it("passes close and error through and closes the streamer socket", () => {
  const socket = new Socket();
  const upstream = yahooUpstream(socket);
  const closes = listen(upstream, "close");
  const errors = listen(upstream, "error");
  socket.dispatchEvent(new Event("error"));
  socket.dispatchEvent(new Event("close"));
  expect([closes.length, errors.length]).toEqual([1, 1]);
  upstream.close(1000, "No subscribers");
  expect(socket.closed).toEqual({ code: 1000, reason: "No subscribers" });
});
