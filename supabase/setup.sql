-- Office Daily Dashboard: database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then click "Run".
-- It is safe to run more than once.

-- 1. One row per user, holding that user's whole dashboard as JSON.
create table if not exists public.dashboards (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb  not null,
  version    bigint not null default 1,          -- goes up by 1 on every save; used to detect edits from another device
  updated_at timestamptz not null default now()
);

-- 2. Row Level Security: each signed-in user can only see and change their own row.
--    This is what makes it safe for the app's public key to be visible in the code.
alter table public.dashboards enable row level security;

drop policy if exists "Users can read their own dashboard" on public.dashboards;
create policy "Users can read their own dashboard" on public.dashboards
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own dashboard" on public.dashboards;
create policy "Users can create their own dashboard" on public.dashboards
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own dashboard" on public.dashboards;
create policy "Users can update their own dashboard" on public.dashboards
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.dashboards to authenticated;
revoke all on public.dashboards from anon;

-- 3. Live updates: tell other open devices the moment a row changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dashboards'
  ) then
    alter publication supabase_realtime add table public.dashboards;
  end if;
end $$;

-- 4. Keep-alive: a tiny function the GitHub scheduled job calls every few days,
--    so the free project is never paused for inactivity. It reads no user data.
create or replace function public.keepalive()
returns timestamptz
language sql
stable
as $$ select now() $$;

grant execute on function public.keepalive() to anon, authenticated;
