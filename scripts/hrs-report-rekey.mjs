// This utility never executes writes. Default output is an aggregate read-only
// preview. The optional maintenance transaction is generated for review only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const plan = readFileSync(new URL('../supabase/maintenance/hrs_report_rekey_plan.sql', import.meta.url), 'utf8').trim()
const digest = `md5(coalesce(string_agg(md5(jsonb_build_array(old_key,target,actor,assigned,old_hash,target_hash,action,hold_reason)::text),'' order by old_key),''))`
const untouched = `select md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by r.id),'')) from public.work_reports r
 where not exists(select from pg_temp.hrs_rekey_plan p where (p.action<>'hold' and p.old_key=r.id) or (p.action='rekey' and p.target=r.id))`
const profileDigest = `select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by p.id),'')) from public.profiles p`
export const previewSQL = `with plan as (${plan}), summary as (
  select employee_name,assigned,action,hold_reason,count(*) as rows,round(sum(seconds)::numeric/3600,2) as hours,
    array_agg(distinct report_date order by report_date) filter(where action='hold') as review_dates
  from plan group by 1,2,3,4)
select (select ${digest} from plan) as plan_digest,
       (select jsonb_agg(to_jsonb(s) order by employee_name,action) from summary s) as summary`

export function transactionSQL(approvedDigest, counts) {
  if (!/^[0-9a-f]{32}$/.test(approvedDigest)) throw Error('Supply the exact approved preview digest.')
  if (!Array.isArray(counts) || counts.length!==3 || !counts.every(n=>Number.isSafeInteger(n)&&n>=0)) {
    throw Error('Approve exact counts: rekey, merge identical, hold.')
  }
  const backup = 'hrs_rekey_' + approvedDigest
  return `begin;
set local lock_timeout='4s'; set local statement_timeout='30s';
set local timezone='UTC';
lock table public.profiles in share mode;
lock table public.work_reports in share row exclusive mode;
create temp table hrs_rekey_plan on commit drop as ${plan};
do $$ begin
 if (select ${digest} from pg_temp.hrs_rekey_plan) <> '${approvedDigest}' then
   raise exception 'Data changed since preview; no writes allowed'; end if;
 if (select count(*) from pg_temp.hrs_rekey_plan where action='rekey')<>${counts[0]}
 or (select count(*) from pg_temp.hrs_rekey_plan where action='merge identical')<>${counts[1]}
 or (select count(*) from pg_temp.hrs_rekey_plan where action='hold')<>${counts[2]} then raise exception 'Approved counts do not match'; end if;
 if not exists(select from pg_temp.hrs_rekey_plan where action<>'hold') then raise exception 'No approved rows'; end if;
 if exists(select from pg_catalog.pg_constraint where contype='f' and confrelid='public.work_reports'::regclass) then
   raise exception 'Incoming foreign keys require separate review'; end if;
 if exists(select from pg_catalog.pg_trigger where tgrelid='public.work_reports'::regclass and not tgisinternal and tgenabled<>'D'
   and not(tgname='work_reports_touch_updated_at' and tgfoid=to_regprocedure('public.touch_updated_at()'))) then
   raise exception 'Unexpected report trigger; review before writing'; end if;
end $$;
create temp table hrs_rekey_guard on commit drop as select (${untouched}) as other_reports,(${profileDigest}) as profiles,
 (select count(*) from public.work_reports) as n,(select coalesce(sum(seconds),0) from public.work_reports) as duration;
-- Fail rather than reuse an existing backup. Never copy passwords or auth data.
create schema ${backup};
revoke all on schema ${backup} from public,anon,authenticated;
create table ${backup}.originals as select r.* from public.work_reports r
 join pg_temp.hrs_rekey_plan p on r.id=p.old_key where p.action<>'hold';
create table ${backup}.manifest as select old_key,target,actor,assigned,old_hash,target_hash,action
 from pg_temp.hrs_rekey_plan where action<>'hold';
revoke all on all tables in schema ${backup} from public,anon,authenticated;
alter table ${backup}.originals enable row level security;
alter table ${backup}.manifest enable row level security;
do $$ declare touched integer; begin
 if (select count(*) from ${backup}.originals)<>(select count(*) from ${backup}.manifest) then raise exception 'Incomplete backup'; end if;
 update public.work_reports r set employee_id=p.assigned,id=p.target
 from pg_temp.hrs_rekey_plan p where p.action='rekey' and r.id=p.old_key and r.synced_by=p.actor;
 get diagnostics touched=row_count;
 if touched<>(select count(*) from pg_temp.hrs_rekey_plan where action='rekey') then raise exception 'Unexpected rekey count'; end if;
 -- Require a canonical copy with the exact same business data, including the
 -- shared task, work times and uploader, before retiring any duplicate.
 if exists(select from pg_temp.hrs_rekey_plan p join ${backup}.originals o on o.id=p.old_key
   left join public.work_reports t on t.id=p.target where t.id is null or t.employee_id<>p.assigned or
   (to_jsonb(o)-array['id','employee_id','updated_at','synced_at']) is distinct from
   (to_jsonb(t)-array['id','employee_id','updated_at','synced_at'])) then raise exception 'Canonical copy does not match'; end if;
 delete from public.work_reports r using pg_temp.hrs_rekey_plan p
 where p.action='merge identical' and r.id=p.old_key and r.synced_by=p.actor;
 get diagnostics touched=row_count;
 if touched<>(select count(*) from pg_temp.hrs_rekey_plan where action='merge identical') then raise exception 'Unexpected merge count'; end if;
 if exists(select from ${backup}.manifest m join public.work_reports r on r.id=m.old_key) then raise exception 'Old key still present'; end if;
 if exists(select from pg_temp.hrs_rekey_plan p left join public.work_reports r on r.id=p.old_key
   where p.action='hold' and md5(to_jsonb(r)::text) is distinct from p.old_hash) then raise exception 'A held row changed'; end if;
 if exists(select from pg_temp.hrs_rekey_guard g where g.other_reports is distinct from (${untouched})
   or g.profiles is distinct from (${profileDigest})
   or g.n-(select count(*) from public.work_reports)<>(select count(*) from pg_temp.hrs_rekey_plan where action='merge identical')
   or g.duration-(select coalesce(sum(seconds),0) from public.work_reports)<>(select coalesce(sum(seconds),0) from pg_temp.hrs_rekey_plan where action='merge identical'))
   then raise exception 'Unrelated data, report count or hours changed unexpectedly'; end if;
end $$;
create table ${backup}.canonical_after as select r.* from public.work_reports r
 where exists(select from ${backup}.manifest m where m.target=r.id);
revoke all on ${backup}.canonical_after from public,anon,authenticated;
alter table ${backup}.canonical_after enable row level security;
commit;`
}

// Generate only; restoring production needs separate authorization.
export function restoreSQL(id) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw Error('Invalid backup ID')
  const b='hrs_rekey_'+id
  return `begin;
set local lock_timeout='4s'; set local statement_timeout='30s';
lock table public.work_reports in share row exclusive mode;
do $$begin
 if exists(select from ${b}.originals o join public.work_reports r on r.id=o.id) then raise exception 'An original key is in use'; end if;
 if exists(select from ${b}.canonical_after c left join public.work_reports r on r.id=c.id where to_jsonb(r) is distinct from to_jsonb(c))
   then raise exception 'A canonical report changed; review before restoring'; end if;
 if exists(select from pg_catalog.pg_constraint where contype='f' and confrelid='public.work_reports'::regclass) then raise exception 'Incoming foreign key'; end if;
 delete from public.work_reports r using ${b}.manifest m where m.action='rekey' and r.id=m.target and r.synced_by=m.actor;
 insert into public.work_reports select o.* from ${b}.originals o;
 if exists(select from ${b}.originals o left join public.work_reports r on r.id=o.id where to_jsonb(r) is distinct from to_jsonb(o))
   then raise exception 'Restore was not exact'; end if;
end $$; commit;`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, arg, ...extra] = process.argv.slice(2)
  if (mode==='--preview-cli' && arg && extra.length===0) {
    const cmd=spawnSync(arg,['db','query','--remote=qyafofkruvflczsxhqbt','--read-only',previewSQL,'-o','json'],{stdio:'inherit'})
    process.exitCode=cmd.status??1
  } else if (mode==='--emit-reviewed-sql' && arg) console.log(transactionSQL(arg,extra.map(n=>/^\d+$/.test(n)?Number(n):NaN)))
  else if (mode==='--emit-restore-sql' && arg && !extra.length) console.log(restoreSQL(arg))
  else if (mode===undefined || (mode==='--preview-sql' && !arg && !extra.length)) console.log(previewSQL)
  else throw Error('Use --preview-sql, --preview-cli PATH, or --emit-reviewed-sql DIGEST REKEY MERGE HOLD (prints only)')
}
