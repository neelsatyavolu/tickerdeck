import { z } from "zod";
import { PORTFOLIO_KINDS } from "./portfolio/types";
import { HORIZONS } from "./forecast/montecarlo";

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/, "Use a US ticker like AAPL or BRK.B");

export const symbolListSchema = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(symbolSchema).min(1, "Pass at least one symbol").max(50, "At most 50 symbols"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const portfolioInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name it").max(80),
    kind: z.enum(PORTFOLIO_KINDS),
    starting_cash: z.coerce.number().positive().max(1e12).nullable().optional(),
    start_date: isoDate.nullable().optional(),
  })
  .transform((v) => ({
    ...v,
    starting_cash: v.kind === "paper" ? v.starting_cash ?? null : null,
    start_date: v.kind === "paper" ? v.start_date ?? null : null,
  }));

export const holdingInputSchema = z.object({
  symbol: symbolSchema,
  shares: z.coerce.number().min(0, "Shares can't be negative").max(1e12),
  cost_basis: z.coerce.number().min(0, "Cost can't be negative").max(1e9),
  bought_at: isoDate.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const horizonSchema = z.enum(Object.keys(HORIZONS) as [keyof typeof HORIZONS, ...(keyof typeof HORIZONS)[]]);

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});

export const chatRequestSchema = z.object({
  provider: z.enum(["codex", "grok"]),
  model: z.string().max(80).optional(),
  messages: z.array(chatMessageSchema).min(1).max(40),
  /** Page the user is looking at, so the assistant can focus on it. */
  focus: z
    .object({ portfolioId: z.uuid().optional(), symbol: symbolSchema.optional() })
    .optional(),
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
