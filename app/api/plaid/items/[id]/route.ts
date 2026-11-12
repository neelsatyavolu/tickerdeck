import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { withPlaid } from "@/lib/plaid/route";
import { unlinkBrokerage } from "@/lib/plaid/sync";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

// DELETE /api/plaid/items/:id — unlink a brokerage. Its portfolios stay.
export function DELETE(_req: Request, { params }: Ctx) {
  return withPlaid(async ({ user, plaid }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail("Brokerage link not found.", 404);
    await unlinkBrokerage(plaid, user.id, id.data);
    return ok(null);
  }, "sensitive");
}
