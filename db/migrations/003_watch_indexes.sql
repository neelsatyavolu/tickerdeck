-- Let the watchlist hold market indexes (Yahoo-style ^GSPC, ^DJI, …).
alter table watchlist drop constraint if exists watchlist_symbol_check;
alter table watchlist add constraint watchlist_symbol_check
  check (symbol ~ '^([A-Z][A-Z0-9.-]{0,9}|\^[A-Z0-9]{2,6})$');
