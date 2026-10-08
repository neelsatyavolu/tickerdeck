-- Portfolios and holdings, owned by the signed-in user.

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'holdings' check (kind in ('holdings', 'watchlist', 'paper')),
  starting_cash numeric(18, 2) check (starting_cash is null or starting_cash > 0),
  start_date date,
  created_at timestamptz not null default now()
);

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  shares numeric(24, 8) not null default 0 check (shares >= 0),
  cost_basis numeric(18, 6) not null default 0 check (cost_basis >= 0),
  bought_at date,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index portfolios_user_idx on public.portfolios (user_id, created_at);
create index holdings_portfolio_idx on public.holdings (portfolio_id);
create index holdings_user_idx on public.holdings (user_id);

alter table public.portfolios enable row level security;
alter table public.holdings enable row level security;

create policy "own portfolios" on public.portfolios
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A holding must belong to the user and sit in one of the user's portfolios.
create policy "own holdings" on public.holdings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid()))
  );

revoke all on public.portfolios, public.holdings from anon;
grant select, insert, update, delete on public.portfolios, public.holdings to authenticated;
