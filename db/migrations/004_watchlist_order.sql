-- Custom watchlist order. Existing rows keep the order they were added in.
alter table watchlist add column if not exists position double precision;
update watchlist w set position = r.n
from (select id, row_number() over (partition by user_id order by added_at) as n from watchlist) r
where w.id = r.id and w.position is null;
create index if not exists watchlist_user_position_idx on watchlist (user_id, position);
