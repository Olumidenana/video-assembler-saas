-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Lets bigger AI jobs (e.g. viral clip analysis of a long transcript) count as
-- several units of a user's daily allowance.

drop function if exists public.consume_ai_request(uuid, integer);

create or replace function public.consume_ai_request(p_user_id uuid, p_limit integer, p_cost integer default 1)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.ai_usage (user_id, day, count)
  values (p_user_id, (now() at time zone 'utc')::date, p_cost)
  on conflict (user_id, day) do update
    set count = public.ai_usage.count + p_cost
    where public.ai_usage.count + p_cost <= p_limit
  returning count into new_count;
  -- A first request that is already over the limit inserts nothing useful; undo it.
  if new_count is not null and new_count > p_limit then
    delete from public.ai_usage where user_id = p_user_id and day = (now() at time zone 'utc')::date;
    return false;
  end if;
  return new_count is not null;
end;
$$;

revoke all on function public.consume_ai_request(uuid, integer, integer) from public, anon, authenticated;
