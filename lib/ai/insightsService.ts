import "server-only";
import { UserFacingError } from "../errors";
import type { SymbolContext } from "./context";
import { gatherContext, symbolContext } from "./gather";
import { parseInsights, readAnswer, type InsightSet } from "./insights";
import { buildInsightsPrompt, INSIGHTS_REQUEST } from "./insightsPrompt";
import { saveInsights } from "./insightsRepo";
import type { Effort } from "./options";
import type { Provider, Tokens } from "./providers";
import { streamChat } from "./stream";

// Each detailed ticker costs about six market-data requests, so this stays
// well inside the free Finnhub tier even with the model's own tool calls.
const DETAILED_HOLDINGS = 6;
const MARKET_SYMBOLS = ["^GSPC", "^IXIC", "^VIX"];

type Options = { provider: Provider; tokens: Tokens; model: string; effort?: Effort; fast?: boolean };

/** Writes a new set of insights with the user's subscription and saves it over the old one. */
export async function generateInsights(userId: string, opts: Options): Promise<InsightSet> {
  const context = await gatherContext(userId, { lastUserMessage: "" });
  const held = context.portfolios.filter((p) => p.portfolio.kind !== "watchlist").flatMap((p) => p.positions);
  const watched = [...context.portfolios.filter((p) => p.portfolio.kind === "watchlist").flatMap((p) => p.positions.map((x) => x.symbol)), ...(context.watchlists ?? []).flatMap((l) => l.items.map((w) => w.symbol))];
  if (held.length === 0 && watched.length === 0) throw new UserFacingError("Hold or watch a few stocks first, then insights can be written about them.", 400);

  // Full detail for the largest holdings (or, with none, the first watched stocks); the indexes get price and returns.
  const value = new Map<string, number>();
  for (const p of held) value.set(p.symbol, (value.get(p.symbol) ?? 0) + (p.marketValue ?? 0));
  const largest = [...value].sort((a, b) => b[1] - a[1]).map(([symbol]) => symbol);
  const detailed = [...new Set([...largest, ...watched])].filter((s) => !s.startsWith("^")).slice(0, DETAILED_HOLDINGS);
  const symbols = (await Promise.all([...detailed.map((s) => symbolContext(s, true)), ...MARKET_SYMBOLS.map((s) => symbolContext(s, false))])).filter((s): s is SymbolContext => s !== null);

  const stream = streamChat({
    provider: opts.provider,
    tokens: opts.tokens,
    model: opts.model,
    system: buildInsightsPrompt({ ...context, symbols }),
    messages: [{ role: "user", content: INSIGHTS_REQUEST }],
    effort: opts.effort,
    fast: opts.fast,
  });
  const answer = readAnswer(await new Response(stream).text());
  if (answer.error) throw new UserFacingError(answer.error, 502);
  const insights = parseInsights(answer.text, answer.sources);
  if (insights.length === 0) {
    console.warn(`[ai] ${opts.provider} returned no usable insights (${answer.text.length} characters)`);
    throw new UserFacingError("The model didn't return usable insights. Try again.", 502);
  }
  return saveInsights(userId, { insights, provider: opts.provider, model: opts.model });
}
