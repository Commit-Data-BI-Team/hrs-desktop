create table if not exists public.sprint_task_completions (
  id uuid primary key default gen_random_uuid(),
  shared_fictive_task_id uuid not null references public.shared_fictive_tasks(id) on delete cascade,
  employee_id bigint not null,
  employee_name text not null,
  completed_by uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shared_fictive_task_id, employee_id)
);

create index if not exists sprint_task_completions_task_idx
  on public.sprint_task_completions (shared_fictive_task_id, completed_at);

drop trigger if exists sprint_task_completions_touch_updated_at
  on public.sprint_task_completions;
create trigger sprint_task_completions_touch_updated_at
before update on public.sprint_task_completions
for each row execute function public.touch_updated_at();

alter table public.sprint_task_completions enable row level security;

drop policy if exists "sprint completions authenticated read"
  on public.sprint_task_completions;
create policy "sprint completions authenticated read"
on public.sprint_task_completions
for select
using (auth.uid() is not null);

drop policy if exists "sprint completions employees insert own"
  on public.sprint_task_completions;
create policy "sprint completions employees insert own"
on public.sprint_task_completions
for insert
with check (
  completed_by = auth.uid()
  and employee_id = (
    select profile.employee_id
    from public.profiles profile
    where profile.id = auth.uid()
  )
);

drop policy if exists "sprint completions employees delete own"
  on public.sprint_task_completions;
create policy "sprint completions employees delete own"
on public.sprint_task_completions
for delete
using (completed_by = auth.uid() or public.is_manager());

create or replace function public.set_sprint_task_completion(
  task_id_input uuid,
  completed_input boolean default true
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_employee_id bigint;
  viewer_name text;
  completion_time timestamptz;
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;

  select profile.employee_id, coalesce(nullif(trim(profile.display_name), ''), profile.email)
    into viewer_employee_id, viewer_name
  from public.profiles profile
  where profile.id = auth.uid();

  if viewer_employee_id is null then
    raise exception 'employee profile is not linked to HRS';
  end if;

  if completed_input then
    if not exists (
      select 1
      from public.work_reports report
      where report.shared_fictive_task_id = task_id_input
        and report.employee_id = viewer_employee_id
    ) then
      raise exception 'report hours on this task before marking it done';
    end if;

    insert into public.sprint_task_completions (
      shared_fictive_task_id,
      employee_id,
      employee_name,
      completed_by,
      completed_at
    )
    values (
      task_id_input,
      viewer_employee_id,
      coalesce(viewer_name, 'Employee ' || viewer_employee_id::text),
      auth.uid(),
      now()
    )
    on conflict (shared_fictive_task_id, employee_id) do update
      set employee_name = excluded.employee_name,
          completed_by = excluded.completed_by,
          completed_at = excluded.completed_at;

    select completed_at into completion_time
    from public.sprint_task_completions
    where shared_fictive_task_id = task_id_input
      and employee_id = viewer_employee_id;
    return completion_time;
  end if;

  delete from public.sprint_task_completions
  where shared_fictive_task_id = task_id_input
    and employee_id = viewer_employee_id;
  return null;
end;
$$;

create or replace function public.get_sprint_task_completion_status(
  task_ids_input uuid[] default null
)
returns table (
  task_id uuid,
  required_count bigint,
  completed_count bigint,
  completions jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with reporters as (
    select
      report.shared_fictive_task_id as task_id,
      report.employee_id,
      max(report.employee_name) as employee_name
    from public.work_reports report
    where auth.uid() is not null
      and report.shared_fictive_task_id is not null
      and (task_ids_input is null or report.shared_fictive_task_id = any(task_ids_input))
    group by report.shared_fictive_task_id, report.employee_id
  )
  select
    reporter.task_id,
    count(*)::bigint as required_count,
    count(completion.completed_at)::bigint as completed_count,
    jsonb_agg(
      jsonb_build_object(
        'employeeId', reporter.employee_id,
        'employeeName', reporter.employee_name,
        'completedAt', completion.completed_at
      )
      order by reporter.employee_name asc
    ) as completions
  from reporters reporter
  left join public.sprint_task_completions completion
    on completion.shared_fictive_task_id = reporter.task_id
   and completion.employee_id = reporter.employee_id
  group by reporter.task_id;
$$;

grant select, insert, delete on public.sprint_task_completions to authenticated;
revoke all on function public.set_sprint_task_completion(uuid, boolean) from public;
grant execute on function public.set_sprint_task_completion(uuid, boolean) to authenticated;
revoke all on function public.get_sprint_task_completion_status(uuid[]) from public;
grant execute on function public.get_sprint_task_completion_status(uuid[]) to authenticated;
