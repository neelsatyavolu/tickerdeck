-- User dashboards: a named, ordered list of panels stored as validated JSON.
create table if not exists dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null check (char_length(name) between 1 and 80),
  panels jsonb not null default '[]'::jsonb check (jsonb_typeof(panels) = 'array'),
  position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboards_user_idx on dashboards (user_id, position, created_at);
