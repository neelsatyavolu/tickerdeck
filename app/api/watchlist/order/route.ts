import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { firstIssue, symbolSchema } from "@/lib/validation";
import { reorderWatchlist } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

const body = z.object({ symbols: z.array(symbolSchema).max(500), watchlistId: z.uuid().nullable().optional() });

// PUT /api/watchlist/order — save the user's custom order (first = top).
export function PUT(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    await reorderWatchlist(user.id, parsed.data.symbols, parsed.data.watchlistId);
    return ok(null);
  });
}
