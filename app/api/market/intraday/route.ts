import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { intraday } from "@/lib/market/sources";
import { INTRADAY_RANGES } from "@/lib/market/types";
import { firstIssue, symbolSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const query = z.object({ symbol: symbolSchema, range: z.enum(INTRADAY_RANGES).default("1d") });

// GET /api/market/intraday?symbol=AAPL&range=1d — minute bars for the last few sessions.
export function GET(req: Request) {
  return withUser(async () => {
    const params = new URL(req.url).searchParams;
    const parsed = query.safeParse({ symbol: params.get("symbol") ?? "", range: params.get("range") ?? undefined });
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await intraday(parsed.data.symbol, parsed.data.range));
  }, "marketLight");
}
