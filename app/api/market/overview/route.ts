import { fail, ok, withUser } from "@/lib/api";
import { summarize, type Overview } from "@/lib/market/overview";
import { history } from "@/lib/market/sources";
import { firstIssue, symbolListSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const CONCURRENCY = 6;

// GET /api/market/overview?symbols=AAPL,VTSAX — sparkline, returns and
// 52-week range per symbol from a year of daily closes. Missing ones are null.
export function GET(req: Request) {
  return withUser(async () => {
    const parsed = symbolListSchema.safeParse(new URL(req.url).searchParams.get("symbols") ?? "");
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const symbols = [...new Set(parsed.data)];
    const out: Record<string, Overview | null> = {};
    let next = 0;
    async function worker() {
      while (next < symbols.length) {
        const s = symbols[next++];
        out[s] = await history(s, "1y").then(summarize, () => null);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
    return ok(out);
  });
}
