-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Daily per-user counter for AI assistant requests (keeps the Anthropic bill bounded).

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
-- No policies: only the server (secret key) reads or writes this table.

-- Atomically counts one request; returns false once today's limit is reached.
create or replace function public.consume_ai_request(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.ai_usage (user_id, day, count)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning count into new_count;
  return new_count is not null;
end;
$$;

revoke all on function public.consume_ai_request(uuid, integer) from public, anon, authenticated;
