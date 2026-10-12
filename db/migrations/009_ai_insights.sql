-- AI insights: the latest set the model wrote for each user, stored as
-- validated JSON. Generating a new set replaces the row; there is no history.
create table if not exists ai_insights (
  user_id text primary key,
  insights jsonb not null check (jsonb_typeof(insights) = 'array'),
  provider text not null,
  model text not null,
  generated_at timestamptz not null default now()
);
