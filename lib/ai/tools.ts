import "server-only";
import { z } from "zod";
import { HORIZONS } from "../forecast/montecarlo";
import { marketNews, news, peers } from "../market/finnhub";
import { UpstreamError } from "../market/http";
import { history, quotes, search } from "../market/sources";
import { HISTORY_RANGES, type NewsItem } from "../market/types";
import { firstIssue, symbolSchema } from "../validation";
import { pct, symbolBlock, usd } from "./context";
import { symbolContext } from "./gather";

// Market data the model can ask for mid-answer, for any ticker. Read-only:
// nothing here changes the user's portfolios, watchlists or dashboards.
// Results are plain text; failures come back as "Error: …" for the model to
// work around, never as exceptions.

const MAX_RESULT_CHARS = 8_000;
const MAX_HISTORY_POINTS = 60;
const MAX_SUMMARY_CHARS = 200;

export type ToolSpec = { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: false };
export type PreparedTool = { /** Shown to the user while it runs. */ status: string; run: () => Promise<string> };
type Tool = { spec: ToolSpec; prepare: (argsJson: string) => PreparedTool };

function parseArgs(argsJson: string): unknown {
  if (!argsJson.trim()) return {};
  try {
    return JSON.parse(argsJson);
  } catch {
    return undefined;
  }
}

async function guarded(run: () => Promise<string>): Promise<string> {
  try {
    const out = await run();
    return out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}\n(truncated)` : out;
  } catch (err) {
    if (err instanceof UpstreamError) return `Error: ${err.message}`;
    console.error("[ai] tool failed", err instanceof Error ? err.message : err);
    return "Error: the lookup failed.";
  }
}

function define<S extends z.ZodObject>(def: {
  name: string;
  description: string;
  /** Status when the arguments can't be read. */
  label: string;
  schema: S;
  status: (args: z.output<S>) => string;
  run: (args: z.output<S>) => Promise<string>;
}): Tool {
  const parameters = Object.fromEntries(Object.entries(z.toJSONSchema(def.schema, { io: "input" })).filter(([key]) => key !== "$schema"));
  return {
    spec: { type: "function", name: def.name, description: def.description, parameters, strict: false },
    prepare(argsJson) {
      const parsed = def.schema.safeParse(parseArgs(argsJson));
      if (!parsed.success) return { status: def.label, run: async () => `Error: invalid arguments: ${firstIssue(parsed.error)}` };
      return { status: def.status(parsed.data), run: () => guarded(() => def.run(parsed.data)) };
    },
  };
}

/** At most `max` items, evenly spaced, always keeping the first and the last. */
export function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const price = (symbol: string, n: number) => (symbol.startsWith("^") ? n.toFixed(2) : usd(n));

function newsLines(items: NewsItem[]): string {
  if (items.length === 0) return "No recent stories.";
  return items
    .map((n) => {
      const summary = n.summary && n.summary !== n.headline ? `. ${n.summary.slice(0, MAX_SUMMARY_CHARS)}` : "";
      return `- ${day(n.time)} ${n.source}: ${n.headline}${summary} ${n.url}`;
    })
    .join("\n");
}

const TOOLS: Tool[] = [
  define({
    name: "get_quotes",
    description: "Live price, today's change and previous close for up to 10 US tickers or indexes (^GSPC, ^IXIC, ^DJI, ^VIX).",
    label: "Getting quotes",
    schema: z.object({ symbols: z.array(symbolSchema).min(1).max(10) }),
    status: ({ symbols }) => `Getting quotes for ${symbols.join(", ")}`,
    run: async ({ symbols }) => {
      const { quotes: found, failed } = await quotes(symbols);
      const rows = found.map(
        (q) => `${q.symbol}: ${price(q.symbol, q.price)} (${pct((q.price - q.prevClose) / q.prevClose)} today, previous close ${price(q.symbol, q.prevClose)}, as of ${new Date(q.time).toISOString()})`,
      );
      return [...rows, ...(failed.length ? [`No quote for: ${failed.join(", ")}`] : [])].join("\n");
    },
  }),
  define({
    name: "get_stock_details",
    description:
      "Everything on one ticker: company profile, price, key statistics (valuation, margins, growth, dividend), period returns, latest earnings, analyst targets and ratings, a statistical price range over the chosen horizon, and recent headlines.",
    label: "Reading stock details",
    schema: z.object({ symbol: symbolSchema, forecast_horizon: z.enum(Object.keys(HORIZONS) as [keyof typeof HORIZONS]).default("3m") }),
    status: ({ symbol }) => `Reading ${symbol} details`,
    run: async ({ symbol, forecast_horizon }) => {
      const context = await symbolContext(symbol, true, forecast_horizon);
      return context ? symbolBlock(context) : `No data for ${symbol}. It may not be a US-listed ticker; try search_symbols.`;
    },
  }),
  define({
    name: "get_price_history",
    description: "Daily closing prices for one ticker or index over a range, sampled to about 60 points, with the range's high, low and total change.",
    label: "Reading price history",
    schema: z.object({ symbol: symbolSchema, range: z.enum(HISTORY_RANGES) }),
    status: ({ symbol, range }) => `Reading ${symbol} price history (${range})`,
    run: async ({ symbol, range }) => {
      const points = await history(symbol, range);
      if (points.length === 0) return `No price history for ${symbol}.`;
      const closes = points.map((p) => p.close);
      const [first, last] = [points[0], points[points.length - 1]];
      return [
        `${symbol} ${range}: first close ${price(symbol, first.close)} on ${day(first.t)} · last close ${price(symbol, last.close)} on ${day(last.t)} · change ${pct(last.close / first.close - 1)} · high ${price(symbol, Math.max(...closes))} · low ${price(symbol, Math.min(...closes))}`,
        "date close",
        ...sample(points, MAX_HISTORY_POINTS).map((p) => `${day(p.t)} ${p.close.toFixed(2)}`),
      ].join("\n");
    },
  }),
  define({
    name: "get_company_news",
    description: "Recent news stories about one company (date, source, headline, summary, link) from the last 1-30 days.",
    label: "Reading company news",
    schema: z.object({ symbol: symbolSchema, days: z.number().int().min(1).max(30).default(7) }),
    status: ({ symbol }) => `Reading ${symbol} news`,
    run: async ({ symbol, days }) => newsLines(await news(symbol, days)),
  }),
  define({
    name: "get_market_news",
    description: "The latest general market headlines (date, source, headline, summary, link).",
    label: "Reading market news",
    schema: z.object({}),
    status: () => "Reading market news",
    run: async () => newsLines(await marketNews()),
  }),
  define({
    name: "search_symbols",
    description: "Find the ticker for a company, fund or index by name or partial ticker.",
    label: "Searching tickers",
    schema: z.object({ query: z.string().trim().min(1).max(60) }),
    status: ({ query }) => `Searching tickers for “${query}”`,
    run: async ({ query }) => {
      const matches = await search(query);
      return matches.length ? matches.map((m) => `- ${m.symbol}: ${m.name} (${m.type})`).join("\n") : `No tickers match "${query}".`;
    },
  }),
  define({
    name: "get_peers",
    description: "Tickers of companies in the same industry as the given one.",
    label: "Finding peers",
    schema: z.object({ symbol: symbolSchema }),
    status: ({ symbol }) => `Finding ${symbol} peers`,
    run: async ({ symbol }) => {
      const list = await peers(symbol);
      return list.length ? list.join(", ") : `No peers found for ${symbol}.`;
    },
  }),
];

/** The function tools, as both providers' "responses" APIs take them. */
export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);

/** Looks up a tool the model called. Unknown names and bad arguments become error results. */
export function prepareTool(name: string, argsJson: string): PreparedTool {
  const tool = TOOLS.find((t) => t.spec.name === name);
  return tool ? tool.prepare(argsJson) : { status: "Working", run: async () => `Error: unknown tool ${name}` };
}
