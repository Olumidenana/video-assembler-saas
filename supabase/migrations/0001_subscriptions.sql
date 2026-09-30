-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  -- Paystack subscription status: active | non-renewing | attention | complete | cancelled
  status text not null default 'inactive',
  plan_code text,
  paystack_customer_code text unique,
  paystack_subscription_code text,
  paystack_email_token text,
  -- Pro access lasts until this moment (plus a short grace period in the app).
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Signed-in users can read their own row. There are deliberately no insert,
-- update or delete policies: only the server (using the secret key, which
-- bypasses RLS) writes here, after verifying payments with Paystack.
drop policy if exists "Users can read their own subscription" on public.subscriptions;
create policy "Users can read their own subscription"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);
