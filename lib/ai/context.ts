import { panelGuide } from "../dashboard/aiPanels";
import type { Forecast } from "../forecast/montecarlo";
import type { AnalystTargets, NewsItem, Profile, QuoteSnapshot, Recommendation } from "../market/types";
import type { Position, Totals } from "../portfolio/math";
import type { Portfolio } from "../portfolio/types";

// Turns the user's data into the assistant's system prompt. Pure, so it can be
// tested without network or database.

export type PortfolioContext = { portfolio: Portfolio; positions: Position[]; totals: Totals };

export type SymbolContext = {
  symbol: string;
  quote: QuoteSnapshot | null;
  profile: Profile | null;
  targets: AnalystTargets | null;
  recommendations: Recommendation[];
  news: NewsItem[];
  forecast: (Forecast & { horizonLabel: string }) | null;
};

export type WatchContext = { symbol: string; name: string | null; price: number | null; prevClose: number | null };

export type DashboardContext = { id: string; name: string; panels: { type: string; title?: string; symbols: string[] }[] };

export type ContextInput = {
  now: Date;
  portfolios: PortfolioContext[];
  dashboards?: DashboardContext[];
  focusDashboardId?: string;
  watchlist?: WatchContext[];
  focusPortfolioId?: string;
  symbols: SymbolContext[];
};

const STOPWORDS = new Set([
  "A", "I", "AI", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BUT", "BY", "CEO", "CFO", "DO", "EPS", "ETF", "EV", "FOR", "GDP", "GO",
  "IF", "IN", "IPO", "IS", "IT", "ME", "MY", "NO", "NOT", "OF", "OK", "ON", "OR", "PE", "SO", "THE", "TO", "UK", "UP", "US", "USA",
  "USD", "VS", "WE", "WHAT", "WHY", "YOY", "YTD", "FED", "CPI", "API", "AND", "ALL", "ANY", "CAN", "HOW", "NEW", "NOW", "OUT", "WHO",
]);

/** Tickers the user probably means: $AAPL anywhere, or bare all-caps words that aren't common acronyms. */
export function mentionedSymbols(text: string, limit = 3): string[] {
  const found: string[] = [];
  const add = (s: string) => {
    if (!found.includes(s) && found.length < limit) found.push(s);
  };
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9.-]{0,9})\b/g)) add(m[1].toUpperCase());
  for (const m of text.matchAll(/\b([A-Z]{2,5}(?:\.[A-Z])?)\b/g)) if (!STOPWORDS.has(m[1])) add(m[1]);
  return found;
}

const usd = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "n/a"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;

function portfolioBlock({ portfolio, positions, totals }: PortfolioContext, focused: boolean): string {
  const header = [
    `### ${portfolio.name}${focused ? " (currently open)" : ""} [portfolioId ${portfolio.id}]`,
    `type: ${portfolio.kind}${portfolio.kind === "paper" && portfolio.starting_cash ? `, starting cash ${usd(portfolio.starting_cash)}${portfolio.start_date ? ` on ${portfolio.start_date}` : ""}, cash left ${usd(totals.cash)}` : ""}`,
    portfolio.kind === "watchlist"
      ? null
      : `value ${usd(totals.marketValue)} · today ${usd(totals.dayChange)} (${pct(totals.dayChangePct)}) · total gain ${usd(totals.totalGain)} (${pct(totals.totalGainPct)})`,
    totals.missing.length ? `no price yet for: ${totals.missing.join(", ")}` : null,
  ].filter(Boolean);
  if (positions.length === 0) return [...header, "(empty)"].join("\n");
  const rows = positions.map((p) =>
    portfolio.kind === "watchlist" || p.shares === 0
      ? `- ${p.symbol}: price ${usd(p.price)} (${pct(p.dayChangePct)} today)`
      : `- ${p.symbol}: ${p.shares} sh @ avg ${usd(p.avgCost)} · price ${usd(p.price)} (${pct(p.dayChangePct)} today) · value ${usd(p.marketValue)} · gain ${usd(p.totalGain)} (${pct(p.totalGainPct)}) · weight ${pct(p.weight).replace("+", "")}`,
  );
  return [...header, ...rows].join("\n");
}

function symbolBlock(s: SymbolContext): string {
  const lines = [`### ${s.symbol}${s.profile ? ` — ${s.profile.name}` : ""}`];
  if (s.profile) lines.push(`industry ${s.profile.industry ?? "n/a"} · market cap ${s.profile.marketCap ? usd(s.profile.marketCap / 1e9, 1) + "B" : "n/a"}`);
  if (s.quote) lines.push(`price ${usd(s.quote.price)} · prev close ${usd(s.quote.prevClose)} (${pct((s.quote.price - s.quote.prevClose) / s.quote.prevClose)}) · as of ${new Date(s.quote.time).toISOString()}`);
  if (s.targets) lines.push(`analyst targets: low ${usd(s.targets.low)} · mean ${usd(s.targets.mean)} · high ${usd(s.targets.high)} · ${s.targets.analysts ?? "?"} analysts · consensus ${s.targets.rating ?? "n/a"}`);
  const r = s.recommendations[0];
  if (r) lines.push(`ratings (${r.period}): strong buy ${r.strongBuy}, buy ${r.buy}, hold ${r.hold}, sell ${r.sell}, strong sell ${r.strongSell}`);
  if (s.forecast) {
    const f = s.forecast;
    lines.push(
      `statistical range over ${f.horizonLabel} (Monte Carlo, ${Math.round(f.annualVol * 100)}% annual vol, median assumed to grow ${Math.round(f.annualDrift * 100)}%/yr): 5th ${usd(f.end.p5)} · 25th ${usd(f.end.p25)} · median ${usd(f.end.p50)} · 75th ${usd(f.end.p75)} · 95th ${usd(f.end.p95)} · P(gain) ${Math.round(f.probGain * 100)}%`,
    );
  }
  if (s.news.length) {
    lines.push("recent headlines:");
    for (const n of s.news.slice(0, 6)) lines.push(`- ${new Date(n.time).toISOString().slice(0, 10)} ${n.source}: ${n.headline}`);
  }
  return lines.join("\n");
}

export function buildSystemPrompt(input: ContextInput): string {
  const parts = [
    `You are the research assistant inside tickerdeck, a personal stock and portfolio tracker. Today is ${input.now.toISOString().slice(0, 10)} (${input.now.toISOString()}).`,
    "Answer using the user's data below. Quote numbers from it rather than from memory, and say when something you need is missing. Prices may be a few seconds old.",
    "Be direct and concise. Use short paragraphs or tight bullet lists, and markdown tables only when comparing several items.",
    "You can analyse, explain and compare, but you cannot change portfolios or the watchlist; tell the user which edits to make themselves. You can propose dashboard panels (see below); the user adds them with one click.",
    "Forecast ranges are statistical spreads from past volatility, not predictions. Do not present anything as a guaranteed outcome. When asked for an outlook, give bull, base and bear cases with the evidence behind each.",
    "",
    "## Portfolios",
    input.portfolios.length
      ? input.portfolios.map((p) => portfolioBlock(p, p.portfolio.id === input.focusPortfolioId)).join("\n\n")
      : "The user has no portfolios yet.",
  ];
  if (input.watchlist?.length) {
    parts.push(
      "",
      "## Watchlist (followed, not held)",
      ...input.watchlist.map((w) => `- ${w.symbol}${w.name ? ` (${w.name})` : ""}: price ${usd(w.price)} (${pct(w.price !== null && w.prevClose ? w.price / w.prevClose - 1 : null)} today)`),
    );
  }
  if (input.symbols.length) parts.push("", "## Symbols in focus", input.symbols.map(symbolBlock).join("\n\n"));
  if (input.dashboards?.length) {
    parts.push("", "## The user's dashboards");
    for (const d of input.dashboards) {
      const open = d.id === input.focusDashboardId;
      parts.push(`- ${d.name}${open ? " (currently open; panels you propose go here)" : ""}: ${d.panels.length} panels`);
      if (open) for (const p of d.panels) parts.push(`  - ${p.type}${p.title ? ` "${p.title}"` : ""}${p.symbols.length ? ` ${p.symbols.join(", ")}` : ""}`);
    }
  }
  parts.push("", panelGuide());
  return parts.join("\n");
}
