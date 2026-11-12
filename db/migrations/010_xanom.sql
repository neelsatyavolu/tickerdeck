-- Xanom accounts (accounts.xanom.co). Neon Auth owns the user table, so the
-- link from a TickerQuill user to their Xanom account lives here, one each way.
create table if not exists xanom_links (
  user_id text primary key,
  xanom_sub text not null unique,
  email text not null,
  linked_at timestamptz not null default now()
);

-- A Neon Auth sign-in (or password reset) the Xanom callback asked for. Neon
-- hands the link's token to our webhook instead of emailing it; the callback
-- picks it up and spends it within the minute. Rows are deleted when used.
create table if not exists xanom_handoffs (
  id text primary key,
  email text not null,
  purpose text not null check (purpose in ('sign-in', 'forget-password')),
  token text,
  expires_at timestamptz not null
);

create index if not exists xanom_handoffs_expiry_idx on xanom_handoffs (expires_at);
