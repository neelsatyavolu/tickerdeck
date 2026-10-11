import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { newSigningKey, signBody, type SigningKey } from "../../test/neonWebhook";
import { createKeyLookup, MAX_AGE_MS, verifySignature } from "./webhookSignature";

const JWKS_URL = "https://ep-test.neonauth.example/neondb/auth/.well-known/jwks.json";
const NOW = 1_800_000_000_000;
const BODY = '{"event_type":"send.magic_link"}';

/** A JWKS endpoint whose key set and clock the test can change. */
function jwks(initial: SigningKey[]) {
  const state = { keys: initial.map((k) => k.jwk as Record<string, unknown>), now: NOW, status: 200 };
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ keys: state.keys }, { status: state.status }));
  return { state, fetchImpl, findKey: createKeyLookup(() => JWKS_URL, fetchImpl, () => state.now) };
}

const signed = (key: SigningKey, body = BODY, timestamp: number | string = NOW) => ({
  signature: signBody(key, body, timestamp),
  kid: key.kid,
  timestamp: String(timestamp),
  rawBody: Buffer.from(body),
});

describe("verifySignature", () => {
  it("accepts a body signed by a published key", async () => {
    const key = newSigningKey("kid-1");
    expect(await verifySignature(signed(key), jwks([key]).findKey, NOW)).toEqual({ ok: true });
  });

  it("rejects a body that was changed after signing", async () => {
    const key = newSigningKey("kid-1");
    const input = { ...signed(key), rawBody: Buffer.from(BODY.replace("magic_link", "otp")) };
    expect(await verifySignature(input, jwks([key]).findKey, NOW)).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects a timestamp that was changed after signing", async () => {
    const key = newSigningKey("kid-1");
    const input = { ...signed(key, BODY, NOW - 1000), timestamp: String(NOW) };
    expect(await verifySignature(input, jwks([key]).findKey, NOW)).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects a key id that is not published", async () => {
    const { findKey } = jwks([newSigningKey("kid-1")]);
    expect(await verifySignature(signed(newSigningKey("kid-2")), findKey, NOW)).toEqual({ ok: false, reason: "unknown key" });
  });

  it("rejects another key signing under a published key id", async () => {
    const { findKey } = jwks([newSigningKey("kid-1")]);
    expect(await verifySignature(signed(newSigningKey("kid-1")), findKey, NOW)).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects timestamps older than five minutes and ones that are not a number", async () => {
    const key = newSigningKey("kid-1");
    const { findKey } = jwks([key]);
    expect(await verifySignature(signed(key, BODY, NOW - MAX_AGE_MS), findKey, NOW)).toEqual({ ok: true });
    expect(await verifySignature(signed(key, BODY, NOW - MAX_AGE_MS - 1), findKey, NOW)).toEqual({ ok: false, reason: "stale timestamp" });
    // Signed over the odd value itself, so only the timestamp check can turn these away.
    for (const bad of ["soon", "1e99", "-5", "0x1A3185C5000", `${NOW}.5`, ` ${NOW}`]) {
      expect(await verifySignature(signed(key, BODY, bad), findKey, NOW), bad).toEqual({ ok: false, reason: "stale timestamp" });
    }
  });

  it("rejects when a signature header is missing, before fetching any key", async () => {
    const key = newSigningKey("kid-1");
    const { findKey, fetchImpl } = jwks([key]);
    for (const missing of ["signature", "kid", "timestamp"] as const) {
      expect(await verifySignature({ ...signed(key), [missing]: null }, findKey, NOW)).toEqual({ ok: false, reason: "missing signature headers" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects anything that is not a detached JWS", async () => {
    const key = newSigningKey("kid-1");
    const { findKey } = jwks([key]);
    const [header, , signature] = signed(key).signature.split(".");
    for (const bad of ["garbage", `${header}.payload.${signature}`, `${header}..`, `..${signature}`, `${header}..${signature}.extra`, `${header}..AAAA`, `${header}..***`]) {
      const verdict = await verifySignature({ ...signed(key), signature: bad }, findKey, NOW);
      expect(verdict.ok).toBe(false);
    }
  });

  it("refuses a published key that is not Ed25519", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    const key = newSigningKey("kid-1");
    const { state, findKey } = jwks([]);
    state.keys = [{ ...rsa, kid: "kid-1" }, { kid: "kid-broken", kty: "OKP", crv: "Ed25519", x: 42 }];
    expect(await verifySignature(signed(key), findKey, NOW)).toEqual({ ok: false, reason: "unknown key" });
    expect(await verifySignature({ ...signed(key), kid: "kid-broken" }, findKey, NOW)).toEqual({ ok: false, reason: "unknown key" });
  });
});

describe("createKeyLookup", () => {
  it("fetches the key set once and reuses it", async () => {
    const key = newSigningKey("kid-1");
    const { findKey, fetchImpl } = jwks([key]);
    expect(await findKey("kid-1")).not.toBeNull();
    expect(await findKey("kid-1")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(JWKS_URL);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetches again after ten minutes", async () => {
    const { state, findKey, fetchImpl } = jwks([newSigningKey("kid-1")]);
    await findKey("kid-1");
    state.now += 10 * 60_000 + 1;
    await findKey("kid-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetches once more for a key id it has not seen, so a rotated key works straight away", async () => {
    const { state, findKey, fetchImpl } = jwks([newSigningKey("kid-1")]);
    await findKey("kid-1");
    const rotated = newSigningKey("kid-2");
    state.keys = [rotated.jwk as Record<string, unknown>];
    state.now += 60_000;
    expect(await findKey("kid-2")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not let unknown key ids trigger a fetch more than once every 30 seconds", async () => {
    const { state, findKey, fetchImpl } = jwks([newSigningKey("kid-1")]);
    expect(await findKey("nope-1")).toBeNull();
    expect(await findKey("nope-2")).toBeNull();
    state.now += 29_000;
    expect(await findKey("nope-3")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    state.now += 2_000;
    expect(await findKey("nope-4")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the key set cannot be loaded, and tries again next time", async () => {
    const { state, findKey } = jwks([newSigningKey("kid-1")]);
    state.status = 503;
    await expect(findKey("kid-1")).rejects.toThrow("JWKS request failed (HTTP 503)");
    state.status = 200;
    expect(await findKey("kid-1")).not.toBeNull();
  });

  it("throws on a key set that is not shaped like one", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ nope: true }));
    await expect(createKeyLookup(() => JWKS_URL, fetchImpl, () => NOW)("kid-1")).rejects.toThrow();
  });
});
