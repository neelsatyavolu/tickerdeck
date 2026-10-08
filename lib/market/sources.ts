import "server-only";
import * as nasdaq from "./nasdaq";
import * as yahoo from "./yahoo";
import { UpstreamError } from "./http";
import type { AnalystTargets, HistoryRange, PricePoint, TargetPoint } from "./types";

// Price history and analyst targets: Nasdaq first (it works from Vercel),
// Yahoo as the fallback (it works from most home connections but returns 429
// to cloud hosts).

export async function history(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
  try {
    return await nasdaq.history(symbol, range);
  } catch (first) {
    try {
      return await yahoo.history(symbol, range);
    } catch {
      throw first instanceof UpstreamError ? first : new UpstreamError("nasdaq", 0, `No price history for ${symbol}`);
    }
  }
}

export async function analystTargets(symbol: string): Promise<{ targets: AnalystTargets; history: TargetPoint[] } | null> {
  const fromNasdaq = await nasdaq.analystTargets(symbol).catch(() => null);
  if (fromNasdaq) return fromNasdaq;
  const fromYahoo = await yahoo.analystTargets(symbol).catch(() => null);
  return fromYahoo ? { targets: fromYahoo, history: [] } : null;
}
