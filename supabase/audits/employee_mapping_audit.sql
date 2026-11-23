-- Read-only. Use the HRS source project (not the team-projects mirror).
-- A name is a clue, never proof of ownership. synced_by is the uploading
-- account; e.g. a manager can historically have uploaded another employee's row.
with
p as (
  select id, employee_id, display_name, role,
    nullif(lower(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g')), '') as norm
  from public.profiles
),
mapped as (
  select employee_id, count(*) as n from p where employee_id is not null group by employee_id
),
names as (
  select norm, count(*) as n, min(employee_id) as id_when_unique
  from p where norm is not null group by norm
),
facts as (
  select r.id, r.report_date, r.seconds, r.employee_id as recorded, r.employee_name,
    (to_jsonb(r) - array['id','employee_id','synced_at','updated_at']) as payload,
    u.employee_id as assigned, u.role as uploader_role, u.id as uploader,
    coalesce(m.n,0) as id_owners, coalesce(n.n,0) as name_matches,
    case when n.n=1 then n.id_when_unique end as name_hint,
    split_part(r.id,'|',1)='hrs' and split_part(r.id,'|',2)=r.employee_id::text
      and split_part(r.id,'|',3)=r.report_date::text as key_matches,
    case when r.synced_by is not null and u.employee_id is distinct from r.employee_id
      and split_part(r.id,'|',1)='hrs' and split_part(r.id,'|',2)=r.employee_id::text
      then 'hrs|' || u.employee_id || '|' || substr(r.id,length('hrs|' || r.employee_id || '|')+1) end as proposed_key
  from public.work_reports r
  left join p u on u.id=r.synced_by
  left join mapped m on m.employee_id=r.employee_id
  left join names n on n.norm=nullif(lower(regexp_replace(trim(r.employee_name),'[[:space:]]+',' ','g')),'')
  where r.source='hrs'
),
proposals as (
  select proposed_key,count(*) as n,count(distinct payload) as variants
  from facts where proposed_key is not null group by proposed_key
),
classified as (
  select f.*, case
    when not key_matches then 'review: stored primary key has a different format or owner'
    when id_owners>1 then 'review: multiple profiles have the recorded employee ID'
    when uploader is null then 'review: no uploader profile'
    when assigned is null then 'review: uploader profile has no assigned ID'
    when assigned<>recorded and target.id is not null then case
      when (to_jsonb(target) - array['id','employee_id','synced_at','updated_at'])=f.payload then 'overlap: identical payload at current primary key'
      else 'conflict: current primary key already exists with different data' end
    when assigned<>recorded and prop.n>1 then case when prop.variants=1 then 'overlap: multiple old rows map to one key with identical payload'
      else 'conflict: multiple old rows map to one key with different data' end
    when assigned<>recorded and name_matches=1 and name_hint=assigned
      then 'candidate only: uploader and unique name suggest a different ID'
    when assigned<>recorded then 'review: uploader and report IDs differ'
    when name_matches=1 and name_hint is distinct from recorded then 'review: name suggests a different employee'
    else 'no ID discrepancy detected'
  end as finding
  from facts f left join public.work_reports target on target.id=f.proposed_key
  left join proposals prop on prop.proposed_key=f.proposed_key
)
select finding,
  case when finding<>'no ID discrepancy detected' then employee_name end as recorded_name,
  case when finding<>'no ID discrepancy detected' then recorded end as stored_employee_id,
  case when finding<>'no ID discrepancy detected' then assigned end as uploader_profile_employee_id,
  case when finding<>'no ID discrepancy detected' then name_hint end as unique_name_hint,
  count(*) as report_rows, round(sum(seconds)::numeric/3600,2) as hours,
  min(report_date) as from_date, max(report_date) as to_date
from classified
group by 1,2,3,4,5 order by 1,2,3,4;
