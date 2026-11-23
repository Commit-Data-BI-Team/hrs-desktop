-- No login or report mutations. Do not interpret zero activity as approval to delete an account.
select p.display_name,p.employee_id,p.role,
  (select count(*) from public.work_reports r where r.source='hrs' and r.employee_id=p.employee_id) as rows_under_current_id,
  (select count(*) from public.work_reports r where r.source='hrs' and r.synced_by=p.id) as uploaded_rows,
  (select count(*) from public.work_reports r where r.source='hrs' and r.synced_by=p.id and r.employee_id is distinct from p.employee_id) as mismatched_uploads,
  (select count(*) from public.sync_runs s where s.synced_by=p.id) as sync_runs,
  exists(select from public.shared_fictive_tasks t where t.created_by=p.id or p.employee_id=any(t.assigned_employee_ids)) as has_task_relationship,
  exists(select from public.shared_project_hour_budgets b where b.created_by=p.id) as created_budget,
  exists(select from public.sprint_task_completions c where c.completed_by=p.id) as confirmed_completion
from public.profiles p order by p.employee_id nulls last,p.display_name;
