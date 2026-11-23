-- Optional, separately authorized hardening, NOT part of the historical repair.
-- Run in the Supabase SQL editor as a database administrator only after
-- reviewing existing IDs and moving staff off clients that self-link profiles.
begin;
set local lock_timeout='4s';
create unique index hrs_profiles_one_assigned_employee
  on public.profiles(employee_id) where employee_id is not null;
alter table public.profiles add constraint hrs_profile_employee_id_valid
  check (employee_id is null or employee_id between 1 and 9007199254740991);

create function public.guard_admin_employee_mapping() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    if new.employee_id is null then return new; end if;
  elsif new.employee_id is not distinct from old.employee_id then
    return new;
  end if;
  -- JWT identity / request role survives older SECURITY DEFINER RPCs.
  -- This is an administrator-managed mapping, not an app-manager grant.
  if coalesce(auth.role(),'') in ('anon','authenticated')
     or current_setting('role',true) in ('anon','authenticated')
     or (auth.uid() is not null and auth.role() is distinct from 'service_role') then
    raise exception 'Employee IDs must be assigned by a Supabase administrator' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_admin_employee_mapping() from public, anon, authenticated;
create trigger hrs_profiles_guard_admin_mapping before insert or update of employee_id on public.profiles
  for each row execute function public.guard_admin_employee_mapping();
commit;
