import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { MAX_IMPORT_ROWS } from "@/lib/portfolio/importCsv";
import { importHoldings } from "@/lib/portfolio/repo";
import { firstIssue, holdingInputSchema, portfolioInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const body = z.union([
  z.object({ portfolioId: z.uuid(), holdings: z.array(holdingInputSchema).min(1).max(MAX_IMPORT_ROWS) }),
  z.object({ portfolio: portfolioInputSchema, holdings: z.array(holdingInputSchema).min(1).max(MAX_IMPORT_ROWS) }),
]);

// POST /api/portfolios/import — add many lots at once, into an existing
// portfolio or a new one. All rows go in, or none do.
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const raw = await req.json().catch(() => null);
    const parsed = body.safeParse(raw);
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { holdings } = parsed.data;
    // Re-read the raw portfolio input so the repo applies the schema's transform once.
    const target = "portfolioId" in parsed.data ? { portfolioId: parsed.data.portfolioId } : { portfolio: (raw as { portfolio: z.input<typeof portfolioInputSchema> }).portfolio };
    const id = await importHoldings(user.id, target, holdings);
    return ok({ id, imported: holdings.length }, { status: 201 });
  }, "write");
}
