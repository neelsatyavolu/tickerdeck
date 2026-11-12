import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "../db";

// Neon Auth has no way to start a session for a user the app vouches for, so the
// Xanom callback asks Neon for a magic link (or a password-reset link) and Neon's
// blocking `send.magic_link` webhook hands the token to us instead of an inbox.
// The handoff id rides in the link's callbackURL, which only our server and
// Neon ever see, so the webhook knows which links to keep. Tokens are spent and
// deleted within seconds.

export const HANDOFF_PARAM = "xh";
const HANDOFF_SECONDS = 120;

export type HandoffPurpose = "sign-in" | "forget-password";

export async function createHandoff(email: string, purpose: HandoffPurpose): Promise<string> {
  const id = randomBytes(24).toString("base64url");
  await sql().query(
    `insert into xanom_handoffs (id, email, purpose, expires_at) values ($1, $2, $3, now() + $4 * interval '1 second')`,
    [id, email.trim().toLowerCase(), purpose, HANDOFF_SECONDS],
  );
  // Now and then, sweep handoffs that were never used.
  if (Math.random() < 0.05) Promise.resolve(sql().query("delete from xanom_handoffs where expires_at < now()")).catch(() => {});
  return id;
}

/** The handoff id in a link's callbackURL, or null. */
export function handoffIdIn(linkUrl: string): string | null {
  try {
    const callback = new URL(linkUrl).searchParams.get("callbackURL");
    if (!callback) return null;
    const id = new URL(callback, "https://placeholder.invalid").searchParams.get(HANDOFF_PARAM);
    return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function tokenIn(linkUrl: string): string | null {
  try {
    const url = new URL(linkUrl);
    return url.searchParams.get("token") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

export type LinkEvent = { linkType: string; linkUrl: string; token?: string; email: string };

/**
 * Called by the Neon Auth webhook for every link. True when the link belongs to a
 * pending handoff and was kept (so no email goes out); false otherwise.
 */
export async function captureLink(event: LinkEvent): Promise<boolean> {
  if (event.linkType !== "sign-in" && event.linkType !== "forget-password") return false;
  const id = handoffIdIn(event.linkUrl);
  if (!id) return false;
  const token = event.token || tokenIn(event.linkUrl);
  if (!token) return false;
  const rows = (await sql().query(
    `update xanom_handoffs set token = $2
     where id = $1 and email = lower($3) and purpose = $4 and token is null and expires_at > now()
     returning id`,
    [id, token, event.email.trim(), event.linkType],
  )) as unknown[];
  return rows.length > 0;
}

/** Takes the token the webhook kept for this handoff; it can be taken once. */
export async function takeToken(id: string): Promise<string | null> {
  const rows = (await sql().query(
    "delete from xanom_handoffs where id = $1 and token is not null and expires_at > now() returning token",
    [id],
  )) as { token: string }[];
  return rows[0]?.token ?? null;
}

/** Drops a handoff that will not be used. */
export async function dropHandoff(id: string): Promise<void> {
  await sql().query("delete from xanom_handoffs where id = $1", [id]);
}
