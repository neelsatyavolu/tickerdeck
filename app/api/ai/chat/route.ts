import { fail, withUser } from "@/lib/api";
import { buildSystemPrompt } from "@/lib/ai/context";
import { gatherContext } from "@/lib/ai/gather";
import { resolveModel } from "@/lib/ai/models";
import { PROVIDERS } from "@/lib/ai/providers";
import { getActiveSession } from "@/lib/ai/session";
import { streamChat } from "@/lib/ai/stream";
import { chatRequestSchema, firstIssue } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/ai/chat — answer with the user's connected ChatGPT or Grok
// subscription, grounded in their portfolios and live market data.
// Streams NDJSON: {"t": text} … {"done": true} | {"e": error}.
export function POST(req: Request) {
  return withUser(async ({ user }) => {
    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { provider, model, messages, focus } = parsed.data;

    const tokens = await getActiveSession(provider, user.id);
    if (!tokens) return fail(`Connect ${PROVIDERS[provider].label} in Settings first.`, 409);

    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const context = await gatherContext(user.id, {
      lastUserMessage: lastUser,
      focusPortfolioId: focus?.portfolioId,
      focusSymbol: focus?.symbol,
      focusDashboardId: focus?.dashboardId,
    });

    const stream = streamChat({
      provider,
      tokens,
      model: await resolveModel(provider, model, PROVIDERS[provider].defaultModel),
      system: buildSystemPrompt(context),
      messages,
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  });
}
