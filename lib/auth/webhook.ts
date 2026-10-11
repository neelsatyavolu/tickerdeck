import { z } from "zod";
import { authEmail, isLinkType } from "../mail/authEmails";
import type { Mail } from "../mail/send";
import { verifySignature, type KeyLookup } from "./webhookSignature";

// Neon Auth calls this instead of sending its own email once the project subscribes to
// `send.magic_link`: sign-in links, email confirmations and password resets all arrive here.
// Nothing here may log the link, its token, the recipient or a key.

const TAG = "[auth-webhook]";
const MAGIC_LINK_EVENT = "send.magic_link";
/** Resend's limit for an idempotency key. */
const MAX_EVENT_ID_LENGTH = 256;

const envelopeSchema = z.object({
  // Only used to stop duplicates, so an id we cannot use is dropped rather than failing the email.
  event_id: z.string().min(1).max(MAX_EVENT_ID_LENGTH).optional().catch(undefined),
  event_type: z.string().min(1),
});

const magicLinkSchema = z.object({
  user: z.object({ email: z.email() }),
  event_data: z.object({ link_type: z.string().min(1), link_url: z.string().min(1) }),
});

export type WebhookDeps = {
  findKey: KeyLookup;
  now: () => number;
  /** Sends one email; throws when it could not be handed over. */
  send: (mail: Mail) => Promise<void>;
};

type Parsed =
  | { kind: "mail"; mail: Mail }
  | { kind: "ignored"; what: string }
  | { kind: "malformed"; why: string };

const reply = (status: number, error?: string) => Response.json(error ? { ok: false, error } : { ok: true }, { status });

/** Names the field that failed, never its value. */
const invalidField = (error: z.ZodError) => `invalid ${error.issues[0]?.path.join(".") || "payload"}`;

/** Short and printable, for the log. */
const label = (value: string) => JSON.stringify(value.slice(0, 64));

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Turns a verified body into the email to send, or says why there is none. */
export function readEvent(rawBody: string, eventIdHeader: string | null): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { kind: "malformed", why: "body is not JSON" };
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return { kind: "malformed", why: invalidField(envelope.error) };
  if (envelope.data.event_type !== MAGIC_LINK_EVENT) return { kind: "ignored", what: `event type ${label(envelope.data.event_type)}` };

  const event = magicLinkSchema.safeParse(json);
  if (!event.success) return { kind: "malformed", why: invalidField(event.error) };
  const { link_type: linkType, link_url: url } = event.data.event_data;
  if (!isLinkType(linkType)) return { kind: "ignored", what: `link type ${label(linkType)}` };
  if (!isHttps(url)) return { kind: "malformed", why: "link is not https" };

  // The id in the body is signed; the X-Neon-Event-Id header carries the same value but is not.
  const idempotencyKey = envelope.data.event_id ?? (eventIdHeader?.slice(0, MAX_EVENT_ID_LENGTH) || undefined);
  return { kind: "mail", mail: { ...authEmail(linkType, url), to: event.data.user.email, idempotencyKey } };
}

const message = (err: unknown) => (err instanceof Error ? err.message : "unknown error");

/**
 * Answers one webhook delivery. Neon retries on 5xx and gives up on 4xx, so only
 * failures that a retry could fix (key set or Resend unavailable) answer 500.
 */
export async function handleAuthWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signed = {
    signature: request.headers.get("x-neon-signature"),
    kid: request.headers.get("x-neon-signature-kid"),
    timestamp: request.headers.get("x-neon-timestamp"),
    rawBody,
  };
  let verdict;
  try {
    verdict = await verifySignature(signed, deps.findKey, deps.now());
  } catch (err) {
    console.error(`${TAG} could not load the signing keys: ${message(err)}`);
    return reply(500, "Signing keys unavailable.");
  }
  if (!verdict.ok) {
    console.warn(`${TAG} rejected: ${verdict.reason}`);
    return reply(401, "Invalid signature.");
  }

  const parsed = readEvent(rawBody.toString("utf8"), request.headers.get("x-neon-event-id"));
  if (parsed.kind === "malformed") {
    console.warn(`${TAG} malformed payload: ${parsed.why}`);
    return reply(400, "Malformed payload.");
  }
  if (parsed.kind === "ignored") {
    console.warn(`${TAG} ignored ${parsed.what}`);
    return reply(200);
  }
  try {
    await deps.send(parsed.mail);
  } catch (err) {
    console.error(`${TAG} could not send the email: ${message(err)}`);
    return reply(500, "Could not send the email.");
  }
  return reply(200);
}
