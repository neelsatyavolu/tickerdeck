import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { firstIssue, symbolSchema } from "@/lib/validation";
import { addToWatchlist, listWatchlists } from "@/lib/watchlist/repo";

export const dynamic = "force-dynamic";

const body = z.object({ symbol: symbolSchema, name: z.string().max(200).nullable().optional(), watchlistId: z.uuid().nullable().optional() });

// GET /api/watchlist — the primary list's symbols, in the user's order.
export function GET() {
  return withUser(async ({ user }) => ok((await listWatchlists(user.id)).find((l) => l.is_primary)?.items ?? []));
}

// POST /api/watchlist — add a symbol to a list (the primary one by default).
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    await addToWatchlist(user.id, parsed.data.symbol, parsed.data.name, parsed.data.watchlistId);
    return ok(null, { status: 201 });
  });
}
