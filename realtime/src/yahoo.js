// Yahoo Finance's streamer sends about one price a second for every symbol,
// thin stocks included, as base64 protobuf. This adapter makes its socket look
// like the Finnhub one the fanout speaks to: same commands in, same trades out.

export const YAHOO_STREAM = "https://streamer.finance.yahoo.com/?version=2";

const ID = 1;
const PRICE = 2;
const TIME = 3;

/** Read the symbol, price and trade time (ms) out of one pricing message, or null if it isn't one. */
export function decodePricing(base64) {
  let bytes;
  try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { return null; }
  const fields = {};
  let i = 0;
  const varint = () => {
    let value = 0, scale = 1, byte;
    do { byte = bytes[i++] ?? 0; value += (byte & 127) * scale; scale *= 128; } while (byte & 128);
    return value;
  };
  while (i < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 0) fields[field] = varint();
    else if (wire === 1) i += 8;
    else if (wire === 2) {
      const length = varint();
      if (field === ID) fields[field] = new TextDecoder().decode(bytes.subarray(i, i + length));
      i += length;
    } else if (wire === 5) {
      if (i + 4 > bytes.length) return null;
      fields[field] = new DataView(bytes.buffer, i, 4).getFloat32(0, true);
      i += 4;
    } else return null;
  }
  const id = fields[ID], price = fields[PRICE], zigzag = fields[TIME];
  if (typeof id !== "string" || !id || !Number.isFinite(price) || price <= 0 || !Number.isFinite(zigzag) || zigzag <= 0 || zigzag % 2) return null;
  // Prices arrive as 32-bit floats (339.94500732421875); four decimals is all they carry.
  return { id, price: Math.round(price * 10000) / 10000, time: zigzag / 2 };
}

// Share classes are BRK.B to the app and BRK-B to Yahoo.
const toYahoo = (symbol) => symbol.replaceAll(".", "-");

/** Wrap an accepted streamer socket so it takes Finnhub-style commands and emits Finnhub-style trade frames. */
export function yahooUpstream(socket) {
  const upstream = new EventTarget();
  const symbols = new Map();

  upstream.send = (raw) => {
    const { type, symbol } = JSON.parse(raw);
    const id = toYahoo(symbol);
    if (type === "subscribe") symbols.set(id, symbol);
    else symbols.delete(id);
    socket.send(JSON.stringify({ [type]: [id] }));
  };
  upstream.close = (code, reason) => socket.close(code, reason);

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    const pricing = frame?.type === "pricing" && typeof frame.message === "string" ? decodePricing(frame.message) : null;
    const symbol = pricing && symbols.get(pricing.id);
    if (!symbol) return;
    const data = JSON.stringify({ type: "trade", data: [{ s: symbol, p: pricing.price, t: pricing.time }] });
    upstream.dispatchEvent(new MessageEvent("message", { data }));
  });
  socket.addEventListener("close", () => upstream.dispatchEvent(new Event("close")));
  socket.addEventListener("error", () => upstream.dispatchEvent(new Event("error")));
  return upstream;
}
