import { z } from "zod";
import type { Source } from "./sse";

// AI insights: a saved set of short findings the model writes about the user's
// money and the market. Pure (no network or database), and shared by the
// browser and the server.

export const INSIGHT_CATEGORIES = ["Portfolio", "Risk", "Movers", "Earnings", "Analysts", "Market"] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];
export const INSIGHT_TONES = ["up", "down", "neutral"] as const;

export const MAX_INSIGHTS = 12;
/** A saved set older than this is regenerated when the page is opened. */
export const STALE_MS = 24 * 60 * 60_000;
const MAX_SYMBOLS = 4;
const MAX_SOURCES = 3;
const TICKER = /^\^?[A-Z0-9][A-Z0-9.-]{0,9}$/;

const httpUrl = (value: unknown): string | null => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const symbolsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((list) => [...new Set(list.filter((s): s is string => typeof s === "string").map((s) => s.trim().toUpperCase()).filter((s) => TICKER.test(s)))].slice(0, MAX_SYMBOLS));

const sourcesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((list) =>
    list.flatMap((s): Source[] => {
      const raw = s && typeof s === "object" ? (s as { url?: unknown; title?: unknown }) : null;
      const url = httpUrl(raw?.url);
      return url ? [{ url, title: typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : null }] : [];
    }),
  );

export const insightSchema = z.object({
  category: z.enum(INSIGHT_CATEGORIES),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(800),
  symbols: symbolsSchema.default([]),
  tone: z.enum(INSIGHT_TONES).catch("neutral").default("neutral"),
  sources: sourcesSchema.default([]),
});

export type Insight = z.infer<typeof insightSchema>;
export type InsightSet = { insights: Insight[]; generated_at: string; provider: "codex" | "grok"; model: string };

/** The model's whole answer, collected from the NDJSON lines lib/ai/stream.ts emits. */
export function readAnswer(raw: string): { text: string; error: string | null; sources: Source[] } {
  let text = "";
  let error: string | null = null;
  let sources: Source[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const msg = JSON.parse(line) as { t?: string; e?: string; src?: Source[] };
    if (msg.t) text += msg.t;
    if (msg.e) error = msg.e;
    if (msg.src) sources = [...sources, ...msg.src];
  }
  return { text, error, sources };
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The list in the answer, whether bare, wrapped in an object, fenced, or surrounded by prose. */
function findList(text: string): unknown[] {
  const whole = tryJson(text.trim());
  const sliced = whole ?? tryJson(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  if (Array.isArray(sliced)) return sliced;
  const wrapped = (sliced as { insights?: unknown } | undefined)?.insights;
  return Array.isArray(wrapped) ? wrapped : [];
}

/**
 * Turns the model's answer into insights. Malformed items are dropped, not
 * fatal. A source is kept only when it is one of the pages the model really
 * cited, so an invented link never reaches the page.
 */
export function parseInsights(text: string, cited: Source[] = []): Insight[] {
  const citedUrls = new Set(cited.map((s) => httpUrl(s.url)).filter((u): u is string => u !== null));
  return findList(text)
    .map((item) => insightSchema.safeParse(item))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, MAX_INSIGHTS)
    .map((insight) => ({ ...insight, sources: insight.sources.filter((s) => citedUrls.has(s.url)).slice(0, MAX_SOURCES) }));
}

export function isStale(generatedAt: string, now = Date.now()): boolean {
  const t = Date.parse(generatedAt);
  return Number.isNaN(t) || now - t >= STALE_MS;
}
