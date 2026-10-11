import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from "node:crypto";

// Builds webhook requests signed the way Neon Auth signs them, for tests:
// https://neon.com/docs/auth/guides/webhooks#signature-verification

export type SigningKey = { kid: string; privateKey: KeyObject; jwk: JsonWebKey };

export function newSigningKey(kid: string): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "EdDSA", use: "sig" } };
}

const b64url = (value: string) => Buffer.from(value).toString("base64url");

/** Detached JWS (`header..signature`) over `header.base64url(timestamp.base64url(body))`. */
export function signBody(key: SigningKey, body: string, timestamp: number | string): string {
  const header = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWS", kid: key.kid }));
  const signingInput = `${header}.${b64url(`${timestamp}.${b64url(body)}`)}`;
  return `${header}..${sign(null, Buffer.from(signingInput), key.privateKey).toString("base64url")}`;
}

export const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";
export const LINK_TOKEN = "tok_Zx81secretTOKEN";
export const LINK_URL = `https://ep-test.neonauth.example/neondb/auth/reset-password/${LINK_TOKEN}?callbackURL=https%3A%2F%2Ftickerquill.n3el.dev%2Flogin%2Freset`;

/** A `send.magic_link` event as documented; pass overrides for the parts under test. */
export function magicLinkEvent(eventData: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    event_type: "send.magic_link",
    timestamp: "2026-10-11T20:00:00.000Z",
    context: { endpoint_id: "ep-test", project_name: "tickerquill" },
    user: { id: "user-1", name: "Ada", email: "ada@example.com", email_verified: true },
    event_data: { link_type: "forget-password", link_url: LINK_URL, token: LINK_TOKEN, expires_at: "2026-10-11T21:00:00.000Z", ip_address: "203.0.113.7", user_agent: "test", ...eventData },
    ...rest,
  };
}

type SignedOptions = { timestamp: number; headers?: Record<string, string | null>; url?: string };

/** A POST carrying `body`, signed with `key`. A null header value removes that header. */
export function signedRequest(key: SigningKey, body: string, { timestamp, headers = {}, url = "https://tickerquill.n3el.dev/api/webhooks/neon-auth" }: SignedOptions): Request {
  const all: Record<string, string | null> = {
    "content-type": "application/json",
    "x-neon-signature": signBody(key, body, timestamp),
    "x-neon-signature-kid": key.kid,
    "x-neon-timestamp": String(timestamp),
    "x-neon-event-type": "send.magic_link",
    "x-neon-event-id": EVENT_ID,
    "x-neon-delivery-attempt": "1",
    ...headers,
  };
  const present = Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null);
  return new Request(url, { method: "POST", headers: Object.fromEntries(present), body });
}
