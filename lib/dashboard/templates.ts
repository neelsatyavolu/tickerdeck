import { newPanelId, panelsSchema, type Panel } from "./schema";

// Starting layouts. Each is built from what the user has (portfolios,
// watchlist) and an optional focus symbol, then validated like any dashboard.

export type TemplateContext = {
  portfolios: { id: string; name: string; symbols: string[] }[];
  watchlist: string[];
  symbol?: string;
  /** For the wall: "all", "watchlist", or a portfolio id. */
  source?: string;
};

type Template = {
  id: string;
  name: string;
  description: string;
  needsSymbol?: boolean;
  needsSource?: boolean;
  build: (ctx: TemplateContext) => Omit<Panel, "id">[];
};

const WALL_MAX_CHARTS = 39; // plus the heatmap = the 40-panel limit

/** Symbols for the wall: one portfolio, the watchlist, or everything (holdings first). */
export function wallSymbols({ portfolios, watchlist, source = "all" }: TemplateContext): string[] {
  const fromPortfolios = (ps: TemplateContext["portfolios"]) => ps.flatMap((p) => p.symbols);
  const list = source === "watchlist" ? watchlist : source === "all" ? [...fromPortfolios(portfolios), ...watchlist] : fromPortfolios(portfolios.filter((p) => p.id === source));
  return [...new Set(list)];
}

function wallName({ portfolios, source = "all" }: TemplateContext): string {
  if (source === "watchlist") return "Watchlist wall";
  if (source === "all") return "Everything wall";
  return `${portfolios.find((p) => p.id === source)?.name ?? "Portfolio"} wall`;
}

const MEGA_CAPS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "BRK.B", "JPM", "LLY", "V", "XOM", "UNH", "WMT", "COST"];
const BIG_TECH = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA"];
const FUNDS = ["SPY", "VOO", "VTI", "QQQ", "SCHD", "VYM", "BND", "VTSAX"];
const INDEXES = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"];

export const TEMPLATES: Template[] = [
  {
    id: "wall",
    name: "Everything wall",
    description: "A screen full of small charts: one per symbol in a portfolio, your watchlist, or all of them, with a heatmap on top.",
    needsSource: true,
    build: (ctx) => {
      const symbols = wallSymbols(ctx);
      const shown = (symbols.length ? symbols : MEGA_CAPS).slice(0, WALL_MAX_CHARTS);
      const panels: Omit<Panel, "id">[] = [];
      if (shown.length >= 2) panels.push({ type: "heatmap", title: "Today", symbols: shown, width: 12 });
      for (const s of shown) panels.push({ type: "price", title: s, symbols: [s], range: "3M", width: 3 });
      return panels;
    },
  },
  {
    id: "market",
    name: "Market overview",
    description: "Major indexes, how they compare this year, mega-cap heatmap and market news.",
    build: () => [
      { type: "tiles", title: "Indexes", symbols: INDEXES, width: 12 },
      { type: "compare", title: "Indexes, 1 year", symbols: ["^GSPC", "^DJI", "^IXIC", "^RUT"], range: "1Y", width: 8 },
      { type: "news", title: "Market news", symbols: ["^GSPC"], width: 4 },
      { type: "heatmap", title: "Mega caps today", symbols: MEGA_CAPS, width: 6 },
      { type: "movers", title: "Mega-cap movers", symbols: MEGA_CAPS, width: 3 },
      { type: "price", title: "Volatility (VIX)", symbols: ["^VIX"], range: "6M", width: 3 },
    ],
  },
  {
    id: "tech",
    name: "Big tech",
    description: "The largest tech names side by side: moves, returns, a 1-year race and NVDA's outlook.",
    build: () => [
      { type: "tiles", symbols: BIG_TECH, width: 12 },
      { type: "compare", title: "1-year race", symbols: BIG_TECH.slice(0, 6), range: "1Y", width: 8 },
      { type: "movers", symbols: BIG_TECH, width: 4 },
      { type: "returns", symbols: BIG_TECH, width: 6 },
      { type: "forecast", symbols: ["NVDA"], horizon: "3m", width: 6 },
    ],
  },
  {
    id: "portfolio",
    name: "My portfolio",
    description: "Your first portfolio: summary, today's heatmap, movers, returns and its biggest holdings over time.",
    build: ({ portfolios, watchlist }) => {
      const p = portfolios.find((x) => x.symbols.length > 0) ?? portfolios[0];
      const symbols = (p?.symbols.length ? p.symbols : watchlist.length ? watchlist : MEGA_CAPS.slice(0, 6)).slice(0, 25);
      const panels: Omit<Panel, "id">[] = [];
      if (p) panels.push({ type: "portfolio", title: p.name, portfolioId: p.id, symbols: [], width: 6 });
      panels.push(
        { type: "heatmap", title: "Holdings today", symbols, width: p ? 6 : 12 },
        { type: "returns", title: "Holdings returns", symbols, width: 8 },
        { type: "movers", title: "Holdings movers", symbols: symbols.length >= 2 ? symbols : [...symbols, "^GSPC"], width: 4 },
      );
      if (symbols.length >= 2) panels.push({ type: "compare", title: "Holdings vs S&P 500", symbols: [...symbols.slice(0, 6), "^GSPC"].filter((s, i, a) => a.indexOf(s) === i).slice(0, 8), range: "1Y", width: 12 });
      return panels;
    },
  },
  {
    id: "stock",
    name: "Single-stock deep dive",
    description: "Everything on one ticker: chart, stats, analysts, forecast, news, and how it compares to the market.",
    needsSymbol: true,
    build: ({ symbol }) => {
      const s = symbol ?? "AAPL";
      return [
        { type: "tiles", symbols: [s, "^GSPC", "^IXIC"], width: 12 },
        { type: "price", symbols: [s], range: "1Y", width: 8 },
        { type: "analysts", symbols: [s], width: 4 },
        { type: "stats", symbols: [s], width: 6 },
        { type: "forecast", symbols: [s], horizon: "3m", width: 6 },
        { type: "compare", title: `${s} vs the market`, symbols: [s, "^GSPC", "^IXIC"], range: "2Y", width: 8 },
        { type: "news", symbols: [s], width: 4 },
      ];
    },
  },
  {
    id: "funds",
    name: "Funds & income",
    description: "Popular index funds, dividend ETFs and bonds: long-run returns, a 5-year comparison and today's moves.",
    build: () => [
      { type: "tiles", symbols: FUNDS, width: 12 },
      { type: "compare", title: "5 years", symbols: ["VOO", "QQQ", "SCHD", "BND"], range: "5Y", width: 8 },
      { type: "movers", symbols: FUNDS, width: 4 },
      { type: "returns", symbols: FUNDS, width: 6 },
      { type: "forecast", title: "S&P 500 fund outlook", symbols: ["VOO"], horizon: "1y", width: 6 },
    ],
  },
];

export function buildTemplate(id: string, ctx: TemplateContext): { name: string; panels: Panel[] } {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error("Unknown layout");
  const panels = panelsSchema.parse(t.build(ctx).map((p) => ({ ...p, id: newPanelId() })));
  const name = t.needsSymbol && ctx.symbol ? `${ctx.symbol} deep dive` : t.needsSource ? wallName(ctx) : t.name;
  return { name, panels };
}
