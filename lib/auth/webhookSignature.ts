import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";

// Neon Auth signs every webhook with Ed25519 as a detached JWS (`header..signature`)
// and publishes the public keys as a JWKS, so its keys can rotate without a shared secret.
// https://neon.com/docs/auth/guides/webhooks#signature-verification

/** Older requests are refused, so a captured one cannot be replayed later. */
export const MAX_AGE_MS = 5 * 60_000;
const JWKS_TTL_MS = 10 * 60_000;
/** Unknown key ids arrive unauthenticated; this keeps them from making us fetch on every request. */
const JWKS_REFETCH_FLOOR_MS = 30_000;
const JWKS_TIMEOUT_MS = 1_500;

const jwksSchema = z.object({ keys: z.array(z.looseObject({ kid: z.string().optional() })) });
type Jwk = z.infer<typeof jwksSchema>["keys"][number];

/** The Ed25519 public key published under `kid`, or null. Throws when the key set cannot be loaded. */
export type KeyLookup = (kid: string) => Promise<KeyObject | null>;

function toEd25519Key(jwk: Jwk): KeyObject | null {
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

/** Looks keys up in the JWKS at `jwksUrl`, kept in memory for ten minutes and refetched early for a key id it has not seen. */
export function createKeyLookup(jwksUrl: () => string, fetchImpl: typeof fetch, now: () => number): KeyLookup {
  let cache: { keys: readonly Jwk[]; at: number } | null = null;

  const load = async () => {
    const response = await fetchImpl(jwksUrl(), { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`JWKS request failed (HTTP ${response.status})`);
    return { keys: jwksSchema.parse(await response.json()).keys, at: now() };
  };

  return async (kid) => {
    const age = cache ? now() - cache.at : Infinity;
    const known = cache?.keys.some((k) => k.kid === kid) ?? false;
    if (!cache || age > JWKS_TTL_MS || (!known && age > JWKS_REFETCH_FLOOR_MS)) cache = await load();
    const jwk = cache.keys.find((k) => k.kid === kid);
    return jwk ? toEd25519Key(jwk) : null;
  };
}

export type SignedBody = {
  /** `X-Neon-Signature` */
  signature: string | null;
  /** `X-Neon-Signature-Kid` */
  kid: string | null;
  /** `X-Neon-Timestamp`, Unix milliseconds */
  timestamp: string | null;
  rawBody: Buffer;
};

export type Verdict = { ok: true } | { ok: false; reason: string };

const reject = (reason: string): Verdict => ({ ok: false, reason });

/** Checks that Neon signed exactly these bytes at this timestamp, and did so within the last five minutes. */
export async function verifySignature({ signature, kid, timestamp, rawBody }: SignedBody, findKey: KeyLookup, now: number): Promise<Verdict> {
  if (!signature || !kid || !timestamp) return reject("missing signature headers");
  if (!/^\d{1,15}$/.test(timestamp) || now - Number(timestamp) > MAX_AGE_MS) return reject("stale timestamp");
  const [header, payload, signed, ...rest] = signature.split(".");
  if (!header || payload !== "" || !signed || rest.length > 0) return reject("malformed signature");
  const key = await findKey(kid);
  if (!key) return reject("unknown key");
  // The timestamp is bound into the JWS payload, which is why the body is base64url-encoded twice.
  const signedPayload = Buffer.from(`${timestamp}.${rawBody.toString("base64url")}`).toString("base64url");
  const valid = verify(null, Buffer.from(`${header}.${signedPayload}`), key, Buffer.from(signed, "base64url"));
  return valid ? { ok: true } : reject("signature mismatch");
}
