-- Symbols a user follows without holding them. One row per symbol per user.
create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  name text check (name is null or char_length(name) <= 200),
  added_at timestamptz not null default now(),
  unique (user_id, symbol)
);

create index if not exists watchlist_user_idx on watchlist (user_id, added_at);
