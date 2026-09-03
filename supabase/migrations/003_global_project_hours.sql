create table if not exists public.shared_project_hour_budgets (
  scope_key text primary key check (length(trim(scope_key)) > 0),
  customer text not null check (length(trim(customer)) > 0),
  project text not null check (length(trim(project)) > 0),
  capped_seconds bigint not null check (capped_seconds >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_project_hour_budgets_customer_project_idx
  on public.shared_project_hour_budgets (customer, project);

drop trigger if exists shared_project_hour_budgets_touch_updated_at
  on public.shared_project_hour_budgets;
create trigger shared_project_hour_budgets_touch_updated_at
before update on public.shared_project_hour_budgets
for each row execute function public.touch_updated_at();

alter table public.shared_project_hour_budgets enable row level security;

drop policy if exists "shared project budgets authenticated read"
  on public.shared_project_hour_budgets;
create policy "shared project budgets authenticated read"
on public.shared_project_hour_budgets
for select
using (auth.uid() is not null);

drop policy if exists "shared project budgets users create"
  on public.shared_project_hour_budgets;
create policy "shared project budgets users create"
on public.shared_project_hour_budgets
for insert
with check (created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists "shared project budgets owners update"
  on public.shared_project_hour_budgets;
create policy "shared project budgets owners update"
on public.shared_project_hour_budgets
for update
using (created_by = auth.uid())
with check (created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists "shared project budgets managers update"
  on public.shared_project_hour_budgets;
create policy "shared project budgets managers update"
on public.shared_project_hour_budgets
for update
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "shared project budgets owners delete"
  on public.shared_project_hour_budgets;
create policy "shared project budgets owners delete"
on public.shared_project_hour_budgets
for delete
using (created_by = auth.uid());

drop policy if exists "shared project budgets managers delete"
  on public.shared_project_hour_budgets;
create policy "shared project budgets managers delete"
on public.shared_project_hour_budgets
for delete
using (public.is_manager());

drop function if exists public.get_shared_fictive_task_usage(uuid[]);
create function public.get_shared_fictive_task_usage(
  task_ids uuid[] default null
)
returns table (
  task_id uuid,
  used_seconds bigint,
  contributor_count bigint,
  last_reported_at timestamptz,
  employees jsonb
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
    max(report.updated_at) as last_reported_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'employeeId', employee_usage.employee_id,
            'employeeName', employee_usage.employee_name,
            'seconds', employee_usage.seconds
          )
          order by employee_usage.seconds desc, employee_usage.employee_name asc
        )
        from (
          select
            employee_report.employee_id,
            max(employee_report.employee_name) as employee_name,
            sum(employee_report.seconds)::bigint as seconds
          from public.work_reports employee_report
          where employee_report.shared_fictive_task_id = task.id
          group by employee_report.employee_id
        ) employee_usage
      ),
      '[]'::jsonb
    ) as employees
  from public.shared_fictive_tasks task
  left join public.work_reports report
    on report.shared_fictive_task_id = task.id
  where auth.uid() is not null
    and (task_ids is null or task.id = any(task_ids))
  group by task.id;
$$;

grant select, insert, update, delete on public.shared_project_hour_budgets to authenticated;
revoke all on function public.get_shared_fictive_task_usage(uuid[]) from public;
grant execute on function public.get_shared_fictive_task_usage(uuid[]) to authenticated;
