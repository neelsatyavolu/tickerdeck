import type { Intent, XanomUser } from "./oidc";

// SPEC.md §2 linking rules, as a pure decision over what the database says.
// The callback carries the decision out (lib/xanom/callback.ts).

/** A Neon Auth user, as far as linking cares. */
export type AppUser = { id: string; email: string; emailVerified: boolean; hasPassword: boolean };

export type LinkLookups = {
  /** The user whose xanom_sub is `sub`. */
  userBySub: (sub: string) => Promise<{ id: string; email: string } | null>;
  /** The xanom_sub already on a user. */
  subOfUser: (userId: string) => Promise<string | null>;
  userByEmail: (email: string) => Promise<AppUser | null>;
  /** A guard that started on this user and didn't finish. */
  guardPending: (userId: string) => Promise<boolean>;
};

export type Decision =
  /** Rule 1: already linked; sign in as that user. */
  | { kind: "sign-in"; userId: string; email: string }
  /** Rule 2: link or convert for the signed-in user; their session stays. */
  | { kind: "attach-current"; userId: string }
  /** Rule 3: same email; attach, then sign in. `guard`: revoke the password and sessions first. */
  | { kind: "attach-and-sign-in"; userId: string; email: string; guard: boolean }
  /** Rule 4: a new user with no password. */
  | { kind: "create"; email: string; name: string }
  | { kind: "refuse"; code: RefusalCode };

export type RefusalCode = "sub_taken" | "already_linked" | "email_mismatch" | "email_linked_elsewhere";

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function decide(
  xanom: XanomUser,
  intent: Intent,
  current: { id: string; email: string } | null,
  db: LinkLookups,
): Promise<Decision> {
  const linked = await db.userBySub(xanom.sub);
  const wantsLink = intent === "link" || intent === "convert";

  // Rule 2's refusal comes first: linking must never quietly switch accounts.
  if (wantsLink && current && linked) {
    return linked.id === current.id ? { kind: "attach-current", userId: current.id } : { kind: "refuse", code: "sub_taken" };
  }

  // Rule 1.
  if (linked) return { kind: "sign-in", userId: linked.id, email: linked.email };

  // Rule 2.
  if (wantsLink && current) {
    const existing = await db.subOfUser(current.id);
    if (existing && existing !== xanom.sub) return { kind: "refuse", code: "already_linked" };
    if (intent === "convert" && !sameEmail(current.email, xanom.email)) return { kind: "refuse", code: "email_mismatch" };
    return { kind: "attach-current", userId: current.id };
  }

  // Rule 3.
  const byEmail = await db.userByEmail(xanom.email);
  if (byEmail) {
    const existing = await db.subOfUser(byEmail.id);
    if (existing && existing !== xanom.sub) return { kind: "refuse", code: "email_linked_elsewhere" };
    // Pre-hijacking guard: someone may have registered this address with a password
    // they know but never proved they own the inbox.
    // Signing in confirms the email, so a guard that failed halfway is remembered separately.
    const guard = (!byEmail.emailVerified && byEmail.hasPassword) || (await db.guardPending(byEmail.id));
    return { kind: "attach-and-sign-in", userId: byEmail.id, email: byEmail.email, guard };
  }

  // Rule 4.
  return { kind: "create", email: xanom.email, name: xanom.name.trim() || xanom.email.split("@")[0] };
}
