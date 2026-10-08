import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { history } from "@/lib/market/yahoo";
import { HISTORY_RANGES } from "@/lib/market/types";
import { firstIssue, symbolSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const query = z.object({ symbol: symbolSchema, range: z.enum(HISTORY_RANGES).default("1y") });

// GET /api/market/history?symbol=AAPL&range=1y — daily adjusted closes.
export function GET(req: Request) {
  return withUser(async () => {
    const params = new URL(req.url).searchParams;
    const parsed = query.safeParse({ symbol: params.get("symbol") ?? "", range: params.get("range") ?? undefined });
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await history(parsed.data.symbol, parsed.data.range));
  });
}
