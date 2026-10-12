import "server-only";
import { forecastExposures } from "../forecast/service";
import type { Horizon } from "../forecast/montecarlo";
import { earnings, metrics, news, profile, recommendations } from "../market/finnhub";
import { summary } from "../market/nasdaq";
import { buildKeyStats, withHistoryVolume } from "../market/stats";
import { analystTargets, history, quote, quotes } from "../market/sources";
import { namedSymbols } from "../market/companyNames";
import { periodReturns } from "../market/performance";
import { aggregatePositions, portfolioTotals, uniqueSymbols } from "../portfolio/math";
import { listPortfolios } from "../portfolio/repo";
import { listWatchlists } from "../watchlist/repo";
import { listDashboards } from "../dashboard/repo";
import type { Quote } from "../portfolio/types";
import { mentionedSymbols, type ContextInput, type SymbolContext } from "./context";

const MAX_PORTFOLIO_SYMBOLS = 40;
const MAX_FOCUS_SYMBOLS = 12;
const DETAILED_SYMBOLS = 3; // the rest get quote, key stats and returns only
const FOCUS_HORIZON = "3m" as const;
const HORIZON_LABEL: Record<Horizon, string> = { "1w": "1 week", "1m": "1 month", "3m": "3 months", "6m": "6 months", "1y": "1 year" };

const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** One ticker's data. Detailed adds the profile, analysts, earnings, headlines and a forecast over the horizon. */
export async function symbolContext(symbol: string, detailed: boolean, horizon: Horizon = FOCUS_HORIZON): Promise<SymbolContext | null> {
  const q = await orNull(quote(symbol));
  if (!q) return null; // not a real ticker (e.g. an acronym we didn't filter)
  const [m, sum, hist] = await Promise.all([orNull(metrics(symbol)), orNull(summary(symbol)), orNull(history(symbol, "10y"))]);
  const base = {
    symbol,
    quote: q,
    stats: m || sum ? withHistoryVolume(buildKeyStats(m ?? {}, sum), hist) : null,
    returns: hist ? periodReturns(hist, q.price) : [],
  };
  if (!detailed) return { ...base, profile: null, targets: null, recommendations: [], news: [], forecast: null, earnings: [] };
  const [p, targets, recs, headlines, forecast, earn] = await Promise.all([
    orNull(profile(symbol)),
    orNull(analystTargets(symbol).then((r) => r?.targets ?? null)),
    orNull(recommendations(symbol)),
    orNull(news(symbol, 7)),
    orNull(forecastExposures([{ symbol, value: q.price }], horizon)),
    orNull(earnings(symbol)),
  ]);
  return {
    ...base,
    profile: p,
    targets,
    recommendations: recs ?? [],
    news: headlines ?? [],
    forecast: forecast ? { ...forecast, horizonLabel: HORIZON_LABEL[horizon] } : null,
    earnings: earn ?? [],
  };
}

/** Everything the assistant should know for this turn. Failures degrade to less context, never to an error. */
export async function gatherContext(
  userId: string,
  opts: { lastUserMessage: string; focusPortfolioId?: string; focusSymbol?: string; focusDashboardId?: string },
): Promise<ContextInput> {
  const [portfolios, watchlists, dashboards] = await Promise.all([
    listPortfolios(userId),
    listWatchlists(userId).catch(() => []),
    listDashboards(userId).catch(() => []),
  ]);
  const symbols = [...new Set([...uniqueSymbols(portfolios), ...watchlists.flatMap((l) => l.items.map((w) => w.symbol))])].slice(0, MAX_PORTFOLIO_SYMBOLS);
  const snap = symbols.length ? await quotes(symbols).catch(() => ({ quotes: [], failed: symbols })) : { quotes: [] };
  const priceMap: Record<string, Quote> = Object.fromEntries(snap.quotes.map((q) => [q.symbol, { price: q.price, prevClose: q.prevClose }]));

  const contexts = portfolios.map((portfolio) => {
    const positions = aggregatePositions(portfolio.holdings, priceMap);
    return { portfolio, positions, totals: portfolioTotals(portfolio, positions) };
  });

  // Detail for the open stock, tickers named in the question, and the open portfolio's largest positions.
  const largest = contexts.find((c) => c.portfolio.id === opts.focusPortfolioId)?.positions.slice(0, 3).map((p) => p.symbol) ?? [];
  const text = opts.lastUserMessage;
  const focus = [...new Set([opts.focusSymbol, ...namedSymbols(text), ...mentionedSymbols(text, MAX_FOCUS_SYMBOLS), ...largest].filter((s): s is string => Boolean(s)))].slice(0, MAX_FOCUS_SYMBOLS);
  const symbolContexts = (await Promise.all(focus.map((s, i) => symbolContext(s, i < DETAILED_SYMBOLS)))).filter((s): s is SymbolContext => s !== null);

  return {
    now: new Date(),
    focusPortfolioId: opts.focusPortfolioId,
    portfolios: contexts,
    dashboards: dashboards.map((d) => ({ id: d.id, name: d.name, panels: d.panels })),
    focusDashboardId: opts.focusDashboardId,
    watchlists: watchlists.map((l) => ({
      name: l.name,
      primary: l.is_primary,
      items: l.items.map((w) => ({ symbol: w.symbol, name: w.name, price: priceMap[w.symbol]?.price ?? null, prevClose: priceMap[w.symbol]?.prevClose ?? null })),
    })),
    symbols: symbolContexts,
  };
}
