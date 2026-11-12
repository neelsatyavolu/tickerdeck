import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { redirectUri, withPlaid } from "@/lib/plaid/route";
import { connectToken, reconnectToken } from "@/lib/plaid/sync";
import { firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

const body = z.object({ itemId: z.uuid().optional() });

// POST /api/plaid/link-token — a short-lived token that opens Plaid Link.
// With itemId it signs in again to that link instead of creating a new one.
export function POST(req: Request) {
  return withPlaid(async ({ user, plaid }) => {
    const parsed = body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { itemId } = parsed.data;
    const linkToken = itemId ? await reconnectToken(plaid, user.id, itemId, redirectUri(req)) : await connectToken(plaid, user.id, redirectUri(req));
    return ok({ linkToken });
  }, "sensitive");
}
