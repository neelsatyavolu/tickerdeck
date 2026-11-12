import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { withPlaid } from "@/lib/plaid/route";
import { linkBrokerage } from "@/lib/plaid/sync";
import { firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  publicToken: z.string().min(1).max(500),
  institutionId: z.string().min(1).max(100),
  // Cut to what plaid_items stores: by now Plaid Link has finished, so a long name mustn't fail the link.
  institutionName: z.string().trim().min(1).max(500).transform((s) => s.slice(0, 80)),
});

// POST /api/plaid/exchange — finish a Plaid Link session: store the new
// link and pull its positions.
export function POST(req: Request) {
  return withPlaid(async ({ user, plaid }) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await linkBrokerage(plaid, user.id, parsed.data), { status: 201 });
  }, "sensitive");
}
