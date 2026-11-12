import type { SkippedPosition } from "./map";

export const ITEM_STATUSES = ["ok", "login_required"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** A linked brokerage as the browser sees it. The access token never leaves the server. */
export type PlaidItem = {
  id: string;
  institution: string;
  status: ItemStatus;
  last_synced_at: string | null;
  last_error: string | null;
};

export type SyncResult = { portfolios: number; lots: number; skipped: SkippedPosition[] };
