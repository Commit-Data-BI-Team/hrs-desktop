import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import { previewSQL, transactionSQL, restoreSQL } from '../../scripts/hrs-report-rekey.mjs'
// Pure in-memory PostgreSQL. Set HRS_TEST_PGLITE to an installed PGlite module path if needed.
const { PGlite }=await import(process.env.HRS_TEST_PGLITE || '@electric-sql/pglite')
async function setup() {
  const db=new PGlite()
  await db.exec(`create role anon; create role authenticated;
  create table public.profiles(id text primary key, employee_id bigint, display_name text);
  insert into public.profiles values ('actor',101,'Fixture A'),('unlinked',null,'New User');
  create table public.work_reports(id text primary key, employee_id bigint, employee_name text,report_date date,
    seconds int,task_name text,shared_fictive_task_id text,source text,synced_by text,synced_at timestamptz,updated_at timestamptz);
  create function public.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
  create trigger work_reports_touch_updated_at before update on public.work_reports for each row execute function public.touch_updated_at();`)
  async function add(id,day,index=0,task='One',who='actor',name='Fixture A') {
    const date='2026-10-'+String(day).padStart(2,'0')
    await db.query(`insert into public.work_reports values($1,$2,$3,$4,3600,$5,'shared-fixture','hrs',$6,now(),now())`,
      ['hrs|'+id+'|'+date+'|task|'+index,id,name,date,task,who])
  }
  await add(7,1); await add(7,2); await add(8,2); await add(101,2)
  await add(7,3); await add(8,3)
  await add(7,4); await add(7,4,1); await add(8,4)
  await add(7,5,0,'Label A'); await add(8,5,0,'Label B')
  await add(9,6,0,'Unassigned','unlinked','New User')
  const preview=(await db.query(previewSQL)).rows[0]
  return {db,digest:preview.plan_digest,summary:preview.summary}
}
test('backs up, rekeys and merges exact copies only; contradictory days, NULL profile and accounts are untouched',async()=>{
  const {db,digest,summary}=await setup()
  try {
    assert.deepEqual(Object.fromEntries(summary.map(r=>[r.action,r.rows])),{hold:5,'merge identical':3,rekey:2})
    const before=(await db.query('select * from work_reports where report_date>=\'2026-10-04\' order by id')).rows
    const originals=(await db.query('select * from work_reports order by id')).rows
    await db.exec(transactionSQL(digest,[2,3,5]))
    const backup='hrs_rekey_'+digest
    assert.deepEqual((await db.query('select * from work_reports where report_date>=\'2026-10-04\' order by id')).rows,before)
    const [counts]=(await db.query(`select (select count(*)::integer from ${backup}.originals) as copies,
      (select count(*)::integer from ${backup}.manifest) as actions,(select count(*)::integer from ${backup}.canonical_after) as kept,
      (select count(*)::integer from work_reports where employee_id=101) as current,(select count(*)::integer from profiles) as profiles,
      has_schema_privilege('authenticated','${backup}','usage') as exposed`)).rows
    assert.deepEqual(counts,{copies:5,actions:5,kept:3,current:3,profiles:2,exposed:false})
    assert.equal((await db.query(previewSQL)).rows[0].summary.every(r=>r.action==='hold'),true)
    await assert.rejects(db.exec(transactionSQL(digest,[2,3,5])),/changed since preview/)
    await db.exec('rollback')
    await db.exec(restoreSQL(digest))
    assert.deepEqual((await db.query('select * from work_reports order by id')).rows,originals)
  } finally { await db.close() }
})
test('a changed reviewed row or incorrect approved counts abort before backup and writes',async()=>{
  const {db,digest}=await setup()
  try {
    await assert.rejects(db.exec(transactionSQL(digest,[2,99,5])),/counts do not match/); await db.exec('rollback')
    await db.exec("update work_reports set seconds=42 where employee_id=7 and report_date='2026-10-01'")
    await assert.rejects(db.exec(transactionSQL(digest,[2,3,5])),/changed since preview/); await db.exec('rollback')
    assert.equal((await db.query("select count(*)::int as n from pg_namespace where nspname like 'hrs_rekey_%'")).rows[0].n,0)
    assert.equal((await db.query('select count(*)::int as n from work_reports')).rows[0].n,12)
  } finally {await db.close()}
})
test('optional mapping guard protects client RPCs while supporting trusted administration and unassigned new users',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table public.profiles(id text primary key,employee_id bigint,display_name text);
      insert into public.profiles values('a',135,'A'),('b',null,'B');
      create function public.legacy_self_edit(n bigint) returns void language sql security definer as $$update public.profiles set employee_id=n where id='a'$$;`)
    await db.exec(readFileSync(new URL('../../supabase/maintenance/optional-admin-mappings.sql',import.meta.url),'utf8'))
    await db.exec("set role authenticated; set request.jwt.claim.role='authenticated'")
    await assert.rejects(db.exec("select public.legacy_self_edit(1757)"),/administrator/)
    await db.exec("select public.legacy_self_edit(135);reset role;reset request.jwt.claim.role")
    await db.exec("update profiles set employee_id=1757 where id='b';insert into profiles values('c',null,'C')")
    await assert.rejects(db.exec("update profiles set employee_id=135 where id='b'"),/duplicate/)
    await assert.rejects(db.exec("update profiles set employee_id=0 where id='b'"),/check constraint/)
  } finally {await db.close()}
})
