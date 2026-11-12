import { ok, withUser } from "@/lib/api";
import { XANOM_HOME } from "@/lib/xanom/config";
import { linkOf } from "@/lib/xanom/repo";

export const dynamic = "force-dynamic";

// GET /api/xanom/status — whether the signed-in user's account is linked to Xanom (for Settings).
export function GET() {
  return withUser(async ({ user }) => {
    const link = await linkOf(user.id);
    return ok({ linked: Boolean(link), email: link?.email ?? null, manageUrl: XANOM_HOME });
  });
}
