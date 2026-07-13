create table if not exists public.shared_fictive_tasks (
  id uuid primary key default gen_random_uuid(),
  customer text not null check (length(trim(customer)) > 0),
  project text,
  original_hrs_task_id bigint not null check (original_hrs_task_id > 0),
  original_hrs_task_name text,
  jira_issue_key text not null unique check (
    length(trim(jira_issue_key)) > 0
    and jira_issue_key = upper(trim(jira_issue_key))
  ),
  name text not null check (length(trim(name)) > 0),
  planned_seconds integer check (planned_seconds is null or planned_seconds >= 0),
  capped_seconds integer check (capped_seconds is null or capped_seconds >= 0),
  status text not null default 'in_progress' check (
    status in ('todo', 'in_progress', 'blocked', 'done', 'archived')
  ),
  notes text,
  assigned_employee_ids bigint[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.work_reports
  add column if not exists shared_fictive_task_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_reports_shared_fictive_task_id_fkey'
      and conrelid = 'public.work_reports'::regclass
  ) then
    alter table public.work_reports
      add constraint work_reports_shared_fictive_task_id_fkey
      foreign key (shared_fictive_task_id)
      references public.shared_fictive_tasks(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists shared_fictive_tasks_customer_idx
  on public.shared_fictive_tasks (customer, name)
  where archived_at is null;

create index if not exists work_reports_shared_fictive_task_idx
  on public.work_reports (shared_fictive_task_id, report_date)
  where shared_fictive_task_id is not null;

drop trigger if exists shared_fictive_tasks_touch_updated_at on public.shared_fictive_tasks;
create trigger shared_fictive_tasks_touch_updated_at
before update on public.shared_fictive_tasks
for each row execute function public.touch_updated_at();

alter table public.shared_fictive_tasks enable row level security;

drop policy if exists "shared fictive tasks authenticated read" on public.shared_fictive_tasks;
create policy "shared fictive tasks authenticated read"
on public.shared_fictive_tasks
for select
using (auth.uid() is not null);

drop policy if exists "shared fictive tasks users create" on public.shared_fictive_tasks;
create policy "shared fictive tasks users create"
on public.shared_fictive_tasks
for insert
with check (created_by = auth.uid());

drop policy if exists "shared fictive tasks owners update" on public.shared_fictive_tasks;
create policy "shared fictive tasks owners update"
on public.shared_fictive_tasks
for update
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "shared fictive tasks managers update" on public.shared_fictive_tasks;
create policy "shared fictive tasks managers update"
on public.shared_fictive_tasks
for update
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "shared fictive tasks owners delete" on public.shared_fictive_tasks;
create policy "shared fictive tasks owners delete"
on public.shared_fictive_tasks
for delete
using (created_by = auth.uid());

drop policy if exists "shared fictive tasks managers delete" on public.shared_fictive_tasks;
create policy "shared fictive tasks managers delete"
on public.shared_fictive_tasks
for delete
using (public.is_manager());

create or replace function public.get_shared_fictive_task_usage(
  task_ids uuid[] default null
)
returns table (
  task_id uuid,
  used_seconds bigint,
  contributor_count bigint,
  last_reported_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    task.id as task_id,
    coalesce(sum(report.seconds), 0)::bigint as used_seconds,
    count(distinct report.employee_id)::bigint as contributor_count,
    max(report.updated_at) as last_reported_at
  from public.shared_fictive_tasks task
  left join public.work_reports report
    on report.shared_fictive_task_id = task.id
  where auth.uid() is not null
    and (task_ids is null or task.id = any(task_ids))
  group by task.id;
$$;

grant select, insert, update, delete on public.shared_fictive_tasks to authenticated;
grant select (shared_fictive_task_id) on public.work_reports to authenticated;
revoke all on function public.get_shared_fictive_task_usage(uuid[]) from public;
grant execute on function public.get_shared_fictive_task_usage(uuid[]) to authenticated;
