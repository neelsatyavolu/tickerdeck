import { z } from "zod";
import { symbolSchema } from "../validation";

// A dashboard is an ordered list of panels on a 12-column grid. Each panel
// type knows how many symbols it takes and which options it understands.

export const PANEL_TYPES = [
  "tiles",
  "price",
  "compare",
  "heatmap",
  "returns",
  "movers",
  "forecast",
  "stats",
  "analysts",
  "news",
  "portfolio",
] as const;
export type PanelType = (typeof PANEL_TYPES)[number];

export const PANEL_WIDTHS = [3, 4, 6, 8, 12] as const;
export type PanelWidth = (typeof PANEL_WIDTHS)[number];

export const CHART_RANGES = ["1M", "3M", "6M", "1Y", "2Y", "5Y"] as const;
export const FORECAST_HORIZONS = ["1w", "1m", "3m", "6m", "1y"] as const;

type Meta = { label: string; description: string; minSymbols: number; maxSymbols: number; width: PanelWidth };

export const PANEL_META: Record<PanelType, Meta> = {
  tiles: { label: "Quote tiles", description: "Price and today's change for each symbol.", minSymbols: 1, maxSymbols: 12, width: 12 },
  price: { label: "Price chart", description: "One symbol's price over a chosen range, with volume.", minSymbols: 1, maxSymbols: 1, width: 8 },
  compare: { label: "Compare", description: "Several symbols' % change on one chart, all starting at 0%.", minSymbols: 2, maxSymbols: 8, width: 8 },
  heatmap: { label: "Heatmap", description: "Squares coloured by today's move.", minSymbols: 2, maxSymbols: 40, width: 6 },
  returns: { label: "Returns table", description: "1M/3M/YTD/1Y returns with 3-month trend lines.", minSymbols: 1, maxSymbols: 25, width: 6 },
  movers: { label: "Movers", description: "Biggest gainers and losers today among the symbols.", minSymbols: 2, maxSymbols: 40, width: 4 },
  forecast: { label: "Forecast", description: "Monte Carlo price range for one symbol.", minSymbols: 1, maxSymbols: 1, width: 6 },
  stats: { label: "Key stats", description: "Valuation, margins, growth and 52-week range.", minSymbols: 1, maxSymbols: 1, width: 6 },
  analysts: { label: "Analysts", description: "Price-target range and buy/hold/sell counts.", minSymbols: 1, maxSymbols: 1, width: 4 },
  news: { label: "News", description: "Recent headlines for a symbol (an index gives market news).", minSymbols: 1, maxSymbols: 1, width: 4 },
  portfolio: { label: "Portfolio", description: "Value, today, total gain and allocation of one of your portfolios.", minSymbols: 0, maxSymbols: 0, width: 6 },
};

export const panelSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(PANEL_TYPES),
    title: z.string().trim().max(80).optional(),
    symbols: z.array(symbolSchema).max(40).default([]),
    width: z.union(PANEL_WIDTHS.map((w) => z.literal(w)) as [z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<6>, z.ZodLiteral<8>, z.ZodLiteral<12>]),
    range: z.enum(CHART_RANGES).optional(),
    horizon: z.enum(FORECAST_HORIZONS).optional(),
    portfolioId: z.uuid().optional(),
  })
  .superRefine((p, ctx) => {
    const meta = PANEL_META[p.type];
    const unique = new Set(p.symbols).size;
    if (unique < meta.minSymbols) ctx.addIssue({ code: "custom", message: `${meta.label} needs at least ${meta.minSymbols} symbol${meta.minSymbols === 1 ? "" : "s"}` });
    if (unique > meta.maxSymbols && meta.maxSymbols > 0) ctx.addIssue({ code: "custom", message: `${meta.label} takes at most ${meta.maxSymbols} symbol${meta.maxSymbols === 1 ? "" : "s"}` });
    if (p.type === "portfolio" && !p.portfolioId) ctx.addIssue({ code: "custom", message: "Pick a portfolio" });
  });

export type Panel = z.infer<typeof panelSchema>;

export const panelsSchema = z.array(panelSchema).max(40, "A dashboard holds up to 40 panels");

export const dashboardInputSchema = z.object({
  name: z.string().trim().min(1, "Name it").max(80),
  panels: panelsSchema.default([]),
});

export const dashboardPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  panels: panelsSchema.optional(),
});

export type Dashboard = { id: string; name: string; panels: Panel[]; updated_at: string };

export function newPanelId(): string {
  return Math.random().toString(36).slice(2, 10);
}
