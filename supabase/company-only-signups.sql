-- Workstack: only allow accounts with your company's email address.
-- 1. Replace yourcompany.com below with your company's email domain.
-- 2. Paste into Supabase > SQL Editor > New query, and click Run. Safe to run again.
-- Anyone signing up with another address gets "Accounts are only for company
-- email addresses". Existing accounts are not affected.

create or replace function public.only_company_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(split_part(new.email, '@', 2)) <> 'yourcompany.com' then
    raise exception 'Sign-ups are limited to company email addresses';
  end if;
  return new;
end;
$$;

drop trigger if exists only_company_emails on auth.users;
create trigger only_company_emails
  before insert on auth.users
  for each row execute function public.only_company_emails();


-- ------------------------------------------------------------------
-- If a colleague forgets their password (Supabase's free email service
-- can't send them a reset email), set a temporary one for them here.
-- Replace the email and password, run only these lines, tell them the
-- temporary password, and ask them to use "Change password" after signing in.
-- ------------------------------------------------------------------
-- update auth.users
--   set encrypted_password = extensions.crypt('Temporary-Pass-123', extensions.gen_salt('bf'))
--   where email = 'colleague@yourcompany.com';
