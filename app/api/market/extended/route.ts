import { fail, ok, withUser } from "@/lib/api";
import { isCrypto } from "@/lib/market/crypto";
import { extended, type ExtendedQuote } from "@/lib/market/nasdaq";
import { firstIssue, symbolListSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 20;

// GET /api/market/extended?symbols=AAPL,MSFT — pre-market / after-hours prices
// (only symbols that have one right now).
export function GET(req: Request) {
  return withUser(async () => {
    const parsed = symbolListSchema.safeParse(new URL(req.url).searchParams.get("symbols") ?? "");
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const symbols = [...new Set(parsed.data)].filter((s) => !s.startsWith("^") && !isCrypto(s)).slice(0, MAX_SYMBOLS);
    const rows = await Promise.all(symbols.map((s) => extended(s).then((q) => [s, q] as const, () => [s, null] as const)));
    return ok(Object.fromEntries(rows.filter((r): r is readonly [string, ExtendedQuote] => r[1] !== null)));
  }, "marketHeavy");
}
