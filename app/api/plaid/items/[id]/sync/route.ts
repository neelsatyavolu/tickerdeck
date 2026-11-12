import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { withPlaid } from "@/lib/plaid/route";
import { syncBrokerage } from "@/lib/plaid/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

// POST /api/plaid/items/:id/sync — replace the link's portfolios with the
// brokerage's current positions.
export function POST(_req: Request, { params }: Ctx) {
  return withPlaid(async ({ user, plaid }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Brokerage link not found.", 404);
    return ok(await syncBrokerage(plaid, user.id, id.data));
  }, "sensitive");
}
