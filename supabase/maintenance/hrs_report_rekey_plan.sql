-- Relation used by scripts/hrs-report-rekey.mjs, not a data migration.
-- The key can contain report text. Only return grouped counts to the CLI.
with profiles as (
  select p.*, nullif(lower(regexp_replace(trim(display_name),'[[:space:]]+',' ','g')),'') as norm,
    count(*) over(partition by employee_id) as id_owners,
    count(*) over(partition by lower(regexp_replace(trim(display_name),'[[:space:]]+',' ','g'))) as name_owners
  from public.profiles p
), rows as (
  select r.id as old_key,r.employee_id as stored,p.employee_id as assigned,p.id as actor,
    r.employee_name,r.report_date,r.seconds,r.synced_at,md5(to_jsonb(r)::text) as old_hash,
    to_jsonb(r)-array['id','employee_id','updated_at','synced_at'] as business,
    'hrs|'||p.employee_id||'|'||substr(r.id,length('hrs|'||r.employee_id||'|')+1) as target,
    split_part(r.id,'|',1)='hrs' and split_part(r.id,'|',2)=r.employee_id::text
      and split_part(r.id,'|',3)=r.report_date::text and r.id ~ '[|][0-9]+$' as valid_key,
    p.id_owners=1 and p.name_owners=1 and p.norm is not null and
      lower(regexp_replace(trim(r.employee_name),'[[:space:]]+',' ','g'))=p.norm
      and not exists(select from profiles other where other.employee_id=r.employee_id and other.id<>p.id) as identity_supported
  from public.work_reports r join profiles p on p.id=r.synced_by
  where r.source='hrs' and p.employee_id between 1 and 9007199254740991
), snapshots as (
  select actor,report_date,stored,jsonb_agg(jsonb_build_array(target,business) order by target) as version
  from rows group by actor,report_date,stored
), days as (
  select actor,report_date,count(distinct version)>1 as different_day_versions
  from snapshots group by actor,report_date
), old_rows as (
  select r.*,d.different_day_versions,
    row_number() over(partition by target order by synced_at desc nulls last,old_key) as choice
  from rows r join days d using(actor,report_date) where stored<>assigned
), candidates as (
  select o.*, t.id is not null as target_exists,md5(to_jsonb(t)::text) as target_hash,
    case when not valid_key then 'unexpected report key'
         when identity_supported is not true then 'owner/name/assignment ambiguous'
         when t.id is not null and (to_jsonb(t)-array['id','employee_id','updated_at','synced_at']
            is distinct from o.business or t.employee_id<>o.assigned) then 'existing target differs'
         when different_day_versions then 'different snapshots of the same HRS day'
    end as hold_reason
  from old_rows o left join public.work_reports t on t.id=o.target
)
select old_key,target,actor,assigned,stored,employee_name,report_date,seconds,old_hash,target_hash,
  case when hold_reason is not null then 'hold'
       when target_exists or choice>1 then 'merge identical'
       else 'rekey' end as action,
  hold_reason
from candidates
