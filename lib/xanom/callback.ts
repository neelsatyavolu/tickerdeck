import "server-only";
import { currentUser } from "../auth/server";
import { xanomConfig } from "./config";
import { decide, type Decision } from "./linking";
import { revokeOtherSessions, scramblePassword, signInAs, type SessionCookies } from "./neonAuth";
import { finishSignIn, issuerKeys, readFlow, XanomError, type Intent, type XanomUser } from "./oidc";
import { attach, lookups, userByEmail } from "./repo";

export type CallbackResult = { intent: Intent; returnTo: string; cookies: SessionCookies };

/** Carries out a linking decision; returns the session cookies to set, if any. */
async function apply(decision: Decision, xanom: XanomUser, origin: string): Promise<SessionCookies> {
  switch (decision.kind) {
    case "refuse":
      throw new XanomError(decision.code);
    case "sign-in":
      return signInAs(origin, decision.email, xanom.name);
    case "attach-current":
      await attach(decision.userId, xanom.sub, xanom.email);
      return [];
    case "attach-and-sign-in": {
      // Guard first, so nobody who knows the old password keeps a way in.
      if (decision.guard) await scramblePassword(origin, decision.email);
      await attach(decision.userId, xanom.sub, xanom.email);
      const cookies = await signInAs(origin, decision.email, xanom.name);
      if (decision.guard) await revokeOtherSessions(origin, cookies);
      return cookies;
    }
    case "create": {
      const cookies = await signInAs(origin, decision.email, decision.name);
      const created = await userByEmail(decision.email);
      if (!created) throw new XanomError("create_failed");
      await attach(created.id, xanom.sub, xanom.email);
      return cookies;
    }
  }
}

/** GET /api/xanom/callback: verifies the Xanom response, links per SPEC.md §2 and starts a Neon Auth session. */
export async function completeCallback(requestUrl: URL, flowCookie: string | undefined): Promise<CallbackResult> {
  const config = xanomConfig();
  const flow = await readFlow(config, flowCookie);
  const xanom = await finishSignIn(config, flow, requestUrl.searchParams, { keys: issuerKeys(config), fetch });

  const current = await currentUser();
  if (flow.intent !== "signin" && (!current || current.id !== flow.userId)) throw new XanomError("session_changed");

  const decision = await decide(xanom, flow.intent, current, lookups);
  const cookies = await apply(decision, xanom, requestUrl.origin);
  return { intent: flow.intent, returnTo: flow.returnTo, cookies };
}
