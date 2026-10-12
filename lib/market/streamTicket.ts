const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A one-minute handshake credential; the Finnhub key never goes to a browser. */
export async function createStreamTicket(secret: string): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify({ expires: Date.now() + 60_000, nonce: crypto.randomUUID() })));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

export async function verifyStreamTicket(ticket: string, secret: string): Promise<boolean> {
  if (!secret || ticket.length > 512) return false;
  try {
    const parts = ticket.split(".");
    if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return false;
    const [payload, signature] = parts;
    if (!(await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(payload)))) return false;
    const { expires } = JSON.parse(new TextDecoder().decode(decode(payload))) as { expires: number };
    return Number.isFinite(expires) && expires > Date.now() && expires <= Date.now() + 60_000;
  } catch {
    return false;
  }
}
