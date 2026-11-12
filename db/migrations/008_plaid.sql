-- Brokerages linked through Plaid, one row per sign-in at an institution. The
-- access token is encrypted before it gets here (see lib/plaid/tokens.ts).
create table if not exists plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  item_id text not null unique,
  access_token text not null,
  institution_id text not null,
  institution_name text not null check (char_length(institution_name) between 1 and 80),
  status text not null default 'ok' check (status in ('ok', 'login_required')),
  last_synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, institution_id)
);

-- A portfolio that mirrors one brokerage account. While plaid_item_id is set,
-- every sync replaces its holdings and they can't be edited by hand; removing
-- the link leaves an ordinary portfolio behind.
alter table portfolios add column if not exists plaid_item_id uuid references plaid_items (id) on delete set null;
alter table portfolios add column if not exists plaid_account_id text;
create unique index if not exists portfolios_plaid_account on portfolios (plaid_item_id, plaid_account_id) where plaid_item_id is not null;
