create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  employee_id bigint,
  display_name text,
  role text not null default 'employee' check (role in ('manager', 'employee')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_reports (
  id text primary key,
  employee_id bigint not null,
  employee_name text not null,
  customer text not null,
  project text,
  task_id bigint,
  task_name text not null,
  report_date date not null,
  seconds integer not null default 0 check (seconds >= 0),
  comment text,
  reporting_from text,
  from_time text,
  to_time text,
  source text not null default 'hrs',
  synced_by uuid references auth.users(id),
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_reports_employee_date_idx
  on public.work_reports (employee_id, report_date);

create index if not exists work_reports_customer_date_idx
  on public.work_reports (customer, report_date);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'hrs',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  synced_by uuid references auth.users(id),
  from_date date,
  to_date date,
  rows_count integer not null default 0,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  error text
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists work_reports_touch_updated_at on public.work_reports;
create trigger work_reports_touch_updated_at
before update on public.work_reports
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'manager'
  );
$$;

create or replace function public.claim_first_manager(
  display_name_input text default null,
  employee_id_input bigint default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;

  if exists (select 1 from public.profiles where role = 'manager') then
    raise exception 'manager already exists';
  end if;

  insert into public.profiles (id, email, display_name, employee_id, role)
  values (
    auth.uid(),
    coalesce((select email from auth.users where id = auth.uid()), ''),
    nullif(trim(coalesce(display_name_input, '')), ''),
    employee_id_input,
    'manager'
  )
  on conflict (id) do update
    set role = 'manager',
        display_name = coalesce(nullif(trim(coalesce(display_name_input, '')), ''), public.profiles.display_name),
        employee_id = coalesce(employee_id_input, public.profiles.employee_id);

  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

create or replace function public.update_own_profile(
  display_name_input text default null,
  employee_id_input bigint default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;

  update public.profiles
  set display_name = nullif(trim(coalesce(display_name_input, display_name, '')), ''),
      employee_id = employee_id_input
  where id = auth.uid();

  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

create or replace function public.can_read_work_report(
  report_employee_id bigint,
  report_customer text,
  report_project text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer_employee_id bigint;
begin
  if auth.uid() is null then
    return false;
  end if;

  select employee_id into viewer_employee_id
  from public.profiles
  where id = auth.uid();

  if viewer_employee_id is null then
    return false;
  end if;

  if report_employee_id = viewer_employee_id then
    return true;
  end if;

  return exists (
    select 1
    from public.work_reports own_report
    where own_report.employee_id = viewer_employee_id
      and own_report.customer = report_customer
      and coalesce(own_report.project, '') = coalesce(report_project, '')
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.work_reports enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own"
on public.profiles
for select
using (id = auth.uid());

drop policy if exists "profiles managers read all" on public.profiles;
create policy "profiles managers read all"
on public.profiles
for select
using (public.is_manager());

drop policy if exists "profiles managers update all" on public.profiles;
create policy "profiles managers update all"
on public.profiles
for update
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "work reports employees read own" on public.work_reports;
drop policy if exists "work reports employees read own and shared projects" on public.work_reports;
create policy "work reports employees read own and shared projects"
on public.work_reports
for select
using (public.can_read_work_report(employee_id, customer, project));

drop policy if exists "work reports managers read all" on public.work_reports;
create policy "work reports managers read all"
on public.work_reports
for select
using (public.is_manager());

drop policy if exists "work reports managers insert" on public.work_reports;
create policy "work reports managers insert"
on public.work_reports
for insert
with check (public.is_manager());

drop policy if exists "work reports employees insert own" on public.work_reports;
create policy "work reports employees insert own"
on public.work_reports
for insert
with check (
  employee_id = (
    select profiles.employee_id
    from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "work reports managers update" on public.work_reports;
create policy "work reports managers update"
on public.work_reports
for update
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "work reports employees update own" on public.work_reports;
create policy "work reports employees update own"
on public.work_reports
for update
using (
  employee_id = (
    select profiles.employee_id
    from public.profiles
    where profiles.id = auth.uid()
  )
)
with check (
  employee_id = (
    select profiles.employee_id
    from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "work reports managers delete" on public.work_reports;
create policy "work reports managers delete"
on public.work_reports
for delete
using (public.is_manager());

drop policy if exists "work reports employees delete own" on public.work_reports;
create policy "work reports employees delete own"
on public.work_reports
for delete
using (
  employee_id = (
    select profiles.employee_id
    from public.profiles
    where profiles.id = auth.uid()
  )
);

drop policy if exists "sync runs managers read" on public.sync_runs;
create policy "sync runs managers read"
on public.sync_runs
for select
using (public.is_manager());

drop policy if exists "sync runs users read own" on public.sync_runs;
create policy "sync runs users read own"
on public.sync_runs
for select
using (synced_by = auth.uid());

drop policy if exists "sync runs managers insert" on public.sync_runs;
create policy "sync runs managers insert"
on public.sync_runs
for insert
with check (public.is_manager());

drop policy if exists "sync runs users insert own" on public.sync_runs;
create policy "sync runs users insert own"
on public.sync_runs
for insert
with check (synced_by = auth.uid());

drop policy if exists "sync runs managers update" on public.sync_runs;
create policy "sync runs managers update"
on public.sync_runs
for update
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "sync runs users update own" on public.sync_runs;
create policy "sync runs users update own"
on public.sync_runs
for update
using (synced_by = auth.uid())
with check (synced_by = auth.uid());

grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.work_reports to authenticated;
grant insert, update, delete on public.work_reports to authenticated;
grant select, insert, update on public.sync_runs to authenticated;
grant execute on function public.claim_first_manager(text, bigint) to authenticated;
grant execute on function public.update_own_profile(text, bigint) to authenticated;
grant execute on function public.can_read_work_report(bigint, text, text) to authenticated;
