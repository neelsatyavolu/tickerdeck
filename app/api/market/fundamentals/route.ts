import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { fundamentals } from "@/lib/market/fundamentals";
import { firstIssue, symbolSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const query = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(symbolSchema).min(1, "Pass at least one symbol").max(30, "At most 30 symbols"));

// GET /api/market/fundamentals?symbols=NKE,META — exchange, price, 52-week range,
// volume/average volume, dividend/yield and P/E per symbol.
export function GET(req: Request) {
  return withUser(async () => {
    const parsed = query.safeParse(new URL(req.url).searchParams.get("symbols") ?? "");
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await fundamentals([...new Set(parsed.data)]));
  }, "marketHeavy");
}
