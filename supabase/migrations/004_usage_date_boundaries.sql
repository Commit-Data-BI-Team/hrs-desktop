create index if not exists work_reports_project_usage_idx
  on public.work_reports (customer, project, report_date);

drop function if exists public.get_shared_fictive_task_usage(uuid[]);
create function public.get_shared_fictive_task_usage(
  task_ids uuid[] default null,
  start_date_input date default null,
  end_date_input date default null
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
            and employee_report.report_date >= greatest(
              (task.created_at at time zone 'Asia/Jerusalem')::date,
              coalesce(start_date_input, '-infinity'::date)
            )
            and employee_report.report_date <= coalesce(end_date_input, 'infinity'::date)
          group by employee_report.employee_id
        ) employee_usage
      ),
      '[]'::jsonb
    ) as employees
  from public.shared_fictive_tasks task
  left join public.work_reports report
    on report.shared_fictive_task_id = task.id
   and report.report_date >= greatest(
     (task.created_at at time zone 'Asia/Jerusalem')::date,
     coalesce(start_date_input, '-infinity'::date)
   )
   and report.report_date <= coalesce(end_date_input, 'infinity'::date)
  where auth.uid() is not null
    and (task_ids is null or task.id = any(task_ids))
  group by task.id;
$$;

revoke all on function public.get_shared_fictive_task_usage(uuid[], date, date) from public;
grant execute on function public.get_shared_fictive_task_usage(uuid[], date, date) to authenticated;
