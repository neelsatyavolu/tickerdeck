import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { forecastExposures } from "@/lib/forecast/service";
import { firstIssue, horizonSchema, symbolSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({
  horizon: horizonSchema,
  exposures: z.array(z.object({ symbol: symbolSchema, value: z.number().nonnegative().finite() })).min(1).max(50),
});

// POST /api/forecast — Monte Carlo range for one stock (value = price) or a
// portfolio (value = each position's market value).
export function POST(req: Request) {
  return withUser(async () => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await forecastExposures(parsed.data.exposures, parsed.data.horizon));
  }, "marketHeavy");
}
