-- Portfolios and holdings. Ownership is enforced in every server query by
-- user_id (the Neon Auth user id); the browser never talks to the database.

create table if not exists portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'holdings' check (kind in ('holdings', 'watchlist', 'paper')),
  starting_cash numeric(18, 2) check (starting_cash is null or starting_cash > 0),
  start_date date,
  created_at timestamptz not null default now()
);

create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios (id) on delete cascade,
  user_id text not null,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  shares numeric(24, 8) not null default 0 check (shares >= 0),
  cost_basis numeric(18, 6) not null default 0 check (cost_basis >= 0),
  bought_at date,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists portfolios_user_idx on portfolios (user_id, created_at);
create index if not exists holdings_portfolio_idx on holdings (portfolio_id);
create index if not exists holdings_user_idx on holdings (user_id);
