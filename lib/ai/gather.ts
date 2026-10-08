import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { forecastExposures } from "../forecast/service";
import { news, profile, quote, quotes, recommendations } from "../market/finnhub";
import { analystTargets } from "../market/yahoo";
import { aggregatePositions, portfolioTotals, uniqueSymbols } from "../portfolio/math";
import { listPortfolios } from "../portfolio/repo";
import type { Quote } from "../portfolio/types";
import { mentionedSymbols, type ContextInput, type SymbolContext } from "./context";

const MAX_PORTFOLIO_SYMBOLS = 40;
const MAX_FOCUS_SYMBOLS = 4;
const FOCUS_HORIZON = "3m" as const;

const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function symbolContext(symbol: string): Promise<SymbolContext | null> {
  const q = await orNull(quote(symbol));
  if (!q) return null; // not a real ticker (e.g. an acronym we didn't filter)
  const [p, targets, recs, headlines, forecast] = await Promise.all([
    orNull(profile(symbol)),
    orNull(analystTargets(symbol)),
    orNull(recommendations(symbol)),
    orNull(news(symbol, 7)),
    orNull(forecastExposures([{ symbol, value: q.price }], FOCUS_HORIZON)),
  ]);
  return {
    symbol,
    quote: q,
    profile: p,
    targets,
    recommendations: recs ?? [],
    news: headlines ?? [],
    forecast: forecast ? { ...forecast, horizonLabel: "3 months" } : null,
  };
}

/** Everything the assistant should know for this turn. Failures degrade to less context, never to an error. */
export async function gatherContext(
  db: SupabaseClient,
  opts: { lastUserMessage: string; focusPortfolioId?: string; focusSymbol?: string },
): Promise<ContextInput> {
  const portfolios = await listPortfolios(db);
  const symbols = uniqueSymbols(portfolios).slice(0, MAX_PORTFOLIO_SYMBOLS);
  const snap = symbols.length ? await quotes(symbols).catch(() => ({ quotes: [], failed: symbols })) : { quotes: [] };
  const priceMap: Record<string, Quote> = Object.fromEntries(snap.quotes.map((q) => [q.symbol, { price: q.price, prevClose: q.prevClose }]));

  const contexts = portfolios.map((portfolio) => {
    const positions = aggregatePositions(portfolio.holdings, priceMap);
    return { portfolio, positions, totals: portfolioTotals(portfolio, positions) };
  });

  // Detail for the open stock, tickers named in the question, and the open portfolio's largest positions.
  const largest = contexts.find((c) => c.portfolio.id === opts.focusPortfolioId)?.positions.slice(0, 3).map((p) => p.symbol) ?? [];
  const focus = [...new Set([opts.focusSymbol, ...mentionedSymbols(opts.lastUserMessage), ...largest].filter((s): s is string => Boolean(s)))].slice(0, MAX_FOCUS_SYMBOLS);
  const symbolContexts = (await Promise.all(focus.map(symbolContext))).filter((s): s is SymbolContext => s !== null);

  return { now: new Date(), focusPortfolioId: opts.focusPortfolioId, portfolios: contexts, symbols: symbolContexts };
}
