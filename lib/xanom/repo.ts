import "server-only";
import { sql } from "../db";
import { UserFacingError } from "../errors";
import type { AppUser, LinkLookups } from "./linking";

// xanom_links is ours. neon_auth.* belongs to Neon Auth and is only read here:
// every change to a Neon Auth user goes through its API (lib/xanom/neonAuth.ts).

type Row = Record<string, unknown>;

/** The linked user and their Neon Auth email (which is what signs them in). */
export async function userBySub(sub: string): Promise<{ id: string; email: string } | null> {
  const rows = (await sql().query(
    `select l.user_id, u.email from xanom_links l
     left join neon_auth."user" u on u.id::text = l.user_id
     where l.xanom_sub = $1`,
    [sub],
  )) as Row[];
  const r = rows[0];
  if (!r) return null;
  if (r.email == null) {
    // The TickerQuill account was deleted; the link points nowhere.
    await sql().query("delete from xanom_links where xanom_sub = $1", [sub]);
    return null;
  }
  return { id: String(r.user_id), email: String(r.email) };
}

export async function linkOf(userId: string): Promise<{ sub: string; email: string } | null> {
  const rows = (await sql().query("select xanom_sub, email from xanom_links where user_id = $1", [userId])) as Row[];
  return rows[0] ? { sub: String(rows[0].xanom_sub), email: String(rows[0].email) } : null;
}

export async function subOfUser(userId: string): Promise<string | null> {
  return (await linkOf(userId))?.sub ?? null;
}

export async function userByEmail(email: string): Promise<AppUser | null> {
  const rows = (await sql().query(
    `select u.id::text as id, u.email, u."emailVerified" as verified,
       exists (select 1 from neon_auth.account a
               where a."userId" = u.id and a."providerId" = 'credential' and a.password is not null) as has_password
     from neon_auth."user" u where lower(u.email) = lower($1) limit 1`,
    [email.trim()],
  )) as Row[];
  const r = rows[0];
  return r ? { id: String(r.id), email: String(r.email), emailVerified: r.verified === true, hasPassword: r.has_password === true } : null;
}

/** Whether Neon Auth confirmed this user's email (feeds the convert ticket's email_verified). */
export async function emailVerified(userId: string): Promise<boolean> {
  const rows = (await sql().query(`select "emailVerified" as verified from neon_auth."user" where id::text = $1`, [userId])) as Row[];
  return rows[0]?.verified === true;
}

/**
 * Attaches `sub` to a user. Same pair again is a no-op; the sub on another user,
 * or another sub on this user, is refused (both columns are unique).
 */
export async function attach(userId: string, sub: string, email: string): Promise<void> {
  const rows = (await sql().query(
    `insert into xanom_links (user_id, xanom_sub, email) values ($1, $2, $3)
     on conflict do nothing returning user_id`,
    [userId, sub, email],
  )) as Row[];
  if (rows.length > 0) return;
  const existing = await linkOf(userId);
  if (existing?.sub === sub) {
    if (existing.email !== email) await sql().query("update xanom_links set email = $2 where user_id = $1", [userId, email]);
    return;
  }
  throw new UserFacingError("That Xanom account is already linked to another TickerQuill account.", 409);
}

export async function guardPending(userId: string): Promise<boolean> {
  const rows = (await sql().query("select 1 from xanom_pending_guards where user_id = $1", [userId])) as Row[];
  return rows.length > 0;
}

export async function startGuard(userId: string): Promise<void> {
  await sql().query("insert into xanom_pending_guards (user_id) values ($1) on conflict do nothing", [userId]);
}

export async function finishGuard(userId: string): Promise<void> {
  await sql().query("delete from xanom_pending_guards where user_id = $1", [userId]);
}

export const lookups: LinkLookups = { userBySub, subOfUser, userByEmail, guardPending };
