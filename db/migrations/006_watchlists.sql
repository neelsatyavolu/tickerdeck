-- Multiple watchlists per user: one primary list plus named custom lists.
create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null check (char_length(name) between 1 and 60),
  is_primary boolean not null default false,
  position double precision,
  created_at timestamptz not null default now()
);
create unique index if not exists watchlists_one_primary on watchlists (user_id) where is_primary;
create index if not exists watchlists_user_idx on watchlists (user_id, position, created_at);

-- Existing rows move into each user's primary list.
alter table watchlist add column if not exists watchlist_id uuid references watchlists (id) on delete cascade;
insert into watchlists (user_id, name, is_primary, position)
select distinct w.user_id, 'Watchlist', true, 0 from watchlist w
where not exists (select 1 from watchlists l where l.user_id = w.user_id and l.is_primary);
update watchlist w set watchlist_id = l.id
from watchlists l where l.user_id = w.user_id and l.is_primary and w.watchlist_id is null;
alter table watchlist alter column watchlist_id set not null;

-- A symbol is unique per list now, not per user.
alter table watchlist drop constraint if exists watchlist_user_id_symbol_key;
create unique index if not exists watchlist_list_symbol on watchlist (watchlist_id, symbol);
