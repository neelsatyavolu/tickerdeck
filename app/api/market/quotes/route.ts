import { fail, ok, withUser } from "@/lib/api";
import { quotes } from "@/lib/market/sources";
import { firstIssue, symbolListSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// GET /api/market/quotes?symbols=AAPL,MSFT — latest price and previous close.
export function GET(req: Request) {
  return withUser(async () => {
    const parsed = symbolListSchema.safeParse(new URL(req.url).searchParams.get("symbols") ?? "");
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await quotes([...new Set(parsed.data)]));
  }, "marketLight");
}
