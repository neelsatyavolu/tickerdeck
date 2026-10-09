import "server-only";
import { sql } from "./db";
import { UserFacingError } from "./errors";

// Per-user request limits for routes that fan out to upstream APIs or AI
// providers. Counters live in Postgres so every serverless instance shares
// them (fixed one-minute windows).

export const LIMITS = {
  ai: 20,
  marketHeavy: 60,
  marketLight: 240,
  sensitive: 10,
  write: 120,
} as const;
export type Bucket = keyof typeof LIMITS;

const WINDOW_SECONDS = 60;

/** Count this request; throws a 429 once the user is over the bucket's limit for the current minute. */
export async function enforceLimit(userId: string, bucket: Bucket): Promise<void> {
  const rows = (await sql().query(
    `insert into rate_limits (key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [`${bucket}:${userId}`, WINDOW_SECONDS],
  )) as { count: number }[];
  // Occasionally sweep old windows so the table stays small.
  if (Math.random() < 0.01) sql().query(`delete from rate_limits where window_start < now() - interval '1 hour'`).catch(() => {});
  if ((rows[0]?.count ?? 0) > LIMITS[bucket]) throw new UserFacingError("Too many requests. Wait a minute and try again.", 429);
}
