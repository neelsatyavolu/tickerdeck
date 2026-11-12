import "server-only";
import { fail, withUser } from "../api";
import type { SessionUser } from "../auth/server";
import type { Bucket } from "../rateLimit";
import { plaidGateway } from "./client";
import { plaidConfigFor } from "./config";
import type { PlaidContext } from "./sync";

type Owner = { user: SessionUser; plaid: PlaidContext };

/** withUser for the brokerage routes: only the deployment's owner gets through; anyone else sees a 404. */
export function withPlaid(handler: (ctx: Owner) => Promise<Response>, limit?: Bucket): Promise<Response> {
  return withUser(async ({ user }) => {
    const config = plaidConfigFor(user.id);
    if (!config) return fail("Not found.", 404);
    return handler({ user, plaid: { gateway: plaidGateway(config), tokenKey: config.tokenKey } });
  }, limit);
}

/** Where a brokerage sends the browser back after its own sign-in. Must be registered in the Plaid dashboard. */
export function redirectUri(req: Request): string {
  return `${new URL(req.url).origin}/plaid/oauth`;
}
