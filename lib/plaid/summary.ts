import type { SyncResult } from "./types";

const MAX_NAMED = 5;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line telling the user what a sync brought in and what it left out. */
export function syncSummary({ portfolios, lots, skipped }: SyncResult): string {
  const synced = `Synced ${plural(lots, "position")} into ${plural(portfolios, "portfolio")}.`;
  if (skipped.length === 0) return synced;
  const named = skipped.slice(0, MAX_NAMED).map((s) => `${s.name} (${s.reason})`).join(", ");
  const rest = skipped.length > MAX_NAMED ? ` and ${skipped.length - MAX_NAMED} more` : "";
  return `${synced} Skipped ${skipped.length} that tickerdeck can't track: ${named}${rest}.`;
}
