-- RSVPaw schema. Paste into Supabase → SQL Editor → Run.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,              -- iMessage identity (E.164)
  name text,
  email text,
  company text,
  role text,
  linkedin text,
  bio text,                                -- used to answer "why do you want to attend?" style questions
  interests text,                          -- free-text taste seed, e.g. "AI agents, hackathons, no crypto"
  auto_join_threshold int default 85,      -- auto-register above this match score
  agent37_instance_id text,                -- this user's agent computer
  luma_connected boolean default false,
  partiful_connected boolean default false,
  created_at timestamptz default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('luma','partiful','other')),
  source_id text not null,                 -- e.g. Luma evt-xxx
  url text not null,
  name text not null,
  description text,
  host text,
  cover_url text,
  location text,
  start_at timestamptz,
  end_at timestamptz,
  requires_approval boolean,
  discovered_via text,                     -- 'luma-discover' | 'monid' | ...
  created_at timestamptz default now(),
  unique (source, source_id)
);

-- Per-user view of an event: match score, swipe, registration status
create table if not exists user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  score int,                               -- 0-100 match from the agent
  reason text,                             -- one-line "why you'd like it"
  swipe text check (swipe in ('like','dislike')),
  status text not null default 'suggested' check (status in
    ('suggested','registering','pending','approved','waitlisted','declined','going','cancelled','failed')),
  status_note text,
  reminder_sent_at timestamptz,
  calendar_url text,
  updated_at timestamptz default now(),
  unique (user_id, event_id)
);

-- Activity feed: everything the agent does (shown live on the dashboard)
create table if not exists activity (
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  kind text not null,                      -- 'discovered' | 'scored' | 'registered' | 'approved' | 'imessage_out' | 'imessage_in' | 'cancelled' | ...
  message text not null,
  created_at timestamptz default now()
);

-- iMessages queued by the web app / cron; the bot process sends them
create table if not exists outbox (
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,
  phone text not null,
  body text not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz default now()
);

-- Short-lived chat state per user (e.g. waiting for a Luma OTP, or which event a "yes" refers to)
alter table users add column if not exists pending_action jsonb;

create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
drop trigger if exists user_events_touch on user_events;
create trigger user_events_touch before update on user_events
  for each row execute function touch_updated_at();

-- Live dashboard
alter publication supabase_realtime add table user_events;
alter publication supabase_realtime add table activity;

-- Hackathon mode: server uses the service key; allow public read for the demo dashboard.
alter table users enable row level security;
alter table events enable row level security;
alter table user_events enable row level security;
alter table activity enable row level security;
alter table outbox enable row level security;
create policy "public read events" on events for select using (true);
create policy "public read user_events" on user_events for select using (true);
create policy "public read activity" on activity for select using (true);
create policy "public read users" on users for select using (true);
