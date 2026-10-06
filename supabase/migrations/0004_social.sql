-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Connected social accounts (YouTube) for posting straight from the editor.
-- Only the long-lived permission (refresh token) is stored, never a video.

create table if not exists public.social_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('youtube')),
  refresh_token text not null,
  account_name text,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.social_connections enable row level security;
-- No policies: only the server (secret key) reads or writes this table.
