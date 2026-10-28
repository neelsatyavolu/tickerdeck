import type { QuoteSnapshot } from "./market/types";
import { session } from "./marketHours";

/** `price` is the regular session; trades before 9:30 or after 4:00 ET go to `ext`. */
export type LivePrice = { price: number; prevClose: number; time: number; fromTrade: boolean; ext?: { price: number; time: number } };

/**
 * Fold one streamed trade into a symbol's live price. Extended-hours prints
 * don't move the day's change; they're shown beside it. One that arrives
 * before any regular price has nothing to sit beside, so it's skipped rather
 * than passed off as the regular price (the snapshot comes within a second).
 */
export function applyTrade(cur: LivePrice | undefined, p: number, t: number): LivePrice | undefined {
  if (session(new Date(t)) !== "regular") {
    if (!cur) return undefined;
    return !cur.ext || t >= cur.ext.time ? { ...cur, ext: { price: p, time: t } } : cur;
  }
  return !cur || t >= cur.time ? { price: p, prevClose: cur?.prevClose ?? p, time: t, fromTrade: true } : cur;
}

/** Keep a fresher trade price; always take the snapshot's previous close. */
export function applySnapshot(cur: LivePrice | undefined, q: QuoteSnapshot): LivePrice {
  return cur?.fromTrade && cur.time > q.time ? { ...cur, prevClose: q.prevClose } : { price: q.price, prevClose: q.prevClose, time: q.time, fromTrade: false, ext: cur?.ext };
}
