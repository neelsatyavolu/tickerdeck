import { fail, ok, withUser } from "@/lib/api";
import { getInsights } from "@/lib/ai/insightsRepo";
import { generateInsights } from "@/lib/ai/insightsService";
import { resolveModel } from "@/lib/ai/models";
import { PROVIDERS } from "@/lib/ai/providers";
import { getActiveSession } from "@/lib/ai/session";
import { firstIssue, insightsRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/ai/insights — the user's saved set, or null if none was written yet.
export function GET() {
  return withUser(async ({ user }) => ok(await getInsights(user.id)));
}

// POST /api/ai/insights — write a new set with the user's connected ChatGPT or
// Grok subscription and save it over the old one. Takes as long as the model
// does (often a minute), so the old set stays until this returns.
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = insightsRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { provider, model, effort, fast } = parsed.data;

    const tokens = await getActiveSession(provider, user.id);
    if (!tokens) return fail(`Connect ${PROVIDERS[provider].label} in Settings first.`, 409);

    const set = await generateInsights(user.id, {
      provider,
      tokens,
      model: await resolveModel(provider, model, PROVIDERS[provider].defaultModel),
      effort,
      fast: provider === "codex" && fast,
    });
    return ok(set);
  }, "ai");
}
