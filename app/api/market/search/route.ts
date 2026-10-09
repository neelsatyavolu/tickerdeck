import { z } from "zod";
import { fail, ok, withUser } from "@/lib/api";
import { search } from "@/lib/market/sources";
import { firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";

const querySchema = z.string().trim().min(1, "Type a name or ticker").max(40);

// GET /api/market/search?q=apple — US symbol lookup.
export function GET(req: Request) {
  return withUser(async () => {
    const parsed = querySchema.safeParse(new URL(req.url).searchParams.get("q") ?? "");
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    return ok(await search(parsed.data));
  }, "marketLight");
}
