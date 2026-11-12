const STALE_AFTER_MS = 12 * 60 * 60 * 1000; // Plaid refreshes brokerage holdings about once a day

/** Whether a linked portfolio is due for an automatic sync. */
export function isStale(lastSyncedAt: string | null, now = Date.now()): boolean {
  return lastSyncedAt === null || now - Date.parse(lastSyncedAt) > STALE_AFTER_MS;
}
