-- Fixed-window request counters per user and bucket (see lib/rateLimit.ts).
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);
