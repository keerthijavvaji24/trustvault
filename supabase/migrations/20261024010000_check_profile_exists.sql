-- Migration: Add security-definer function to check profile existence
-- This function bypasses RLS for existence check while keeping data safe.

create or replace function public.check_profile_exists(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = '' -- prevent schema poisoning
as $$
  select exists (
    select 1
    from public.profiles
    where id = target_user_id
  );
$$;

-- Revoke execute from public (includes anon) and grant to authenticated users only
revoke execute on function public.check_profile_exists(uuid) from public, anon;
grant execute on function public.check_profile_exists(uuid) to authenticated;
