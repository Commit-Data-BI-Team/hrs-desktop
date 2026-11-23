import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { adminSessionLogin, employeeFromSelfPage, employeeFromSelfPayload, selectSessionEmployee } from '../../electron/hrs/employeeIdentity'
import { checkPersonalSnapshotScope, confirmedDays, profileForReportSync, type ReportStatus } from '../../src/reportProfile'
import { planPersonalWrites } from '../../src/personalReportInventory'
import { pendingDay, retryDate, validPendingScope } from '../../src/reportSyncScope'

async function launch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-access-test-'))
  const app = await electron.launch({ args: ['.', '--user-data-dir=' + dir], env: {
    ...process.env, HRS_E2E: '1', HRS_SPRINT_E2E: '1', E2E_USE_FILE: '1'
  } })
  const page = await app.firstWindow()
  await page.evaluate(() => window.hrs.setTrayPinned(true))
  return { app, page, close: async () => {
    await app.close()
    await fs.rm(dir, { recursive: true, force: true })
  } }
}

test('typing a meeting password keeps focus and never persists a draft', async () => {
  const { page, close } = await launch()
  try {
    const access = page.getByRole('group', { name: 'Meetings access', exact: true })
    const open = () => page.getByRole('button', { name: 'Settings', exact: true }).click()
    const prefs = () => page.evaluate(async () => {
      const { meetingsUsername, meetingsPassword } = await window.hrs.getPreferences()
      return [meetingsUsername, meetingsPassword]
    })
    await open()
    await access.getByLabel('Username', { exact: true }).fill('calendar-fixture')
    const password = access.getByLabel('Password', { exact: true })
    await password.pressSequentially('x')
    await expect(password).toBeFocused()
    await expect(access).not.toContainText(/\bconnected\b/i)
    expect(await prefs()).toEqual(['', ''])
    await password.fill(' full fixture pass! ')
    await access.getByRole('button', { name: 'Save credentials' }).click()
    await expect(access.getByText('Credentials saved')).toBeVisible()
    expect(await prefs()).toEqual(['calendar-fixture', ' full fixture pass! '])
    await page.reload()
    await open()
    await access.getByRole('button', { name: 'Edit', exact: true }).click()
    await password.fill('unsaved-change')
    await access.getByRole('button', { name: 'Cancel' }).click()
    expect(await prefs()).toEqual(['calendar-fixture', ' full fixture pass! '])
    await access.getByRole('button', { name: 'Disconnect' }).click()
    await expect(access.getByText('Not configured')).toBeVisible()
    expect(await prefs()).toEqual(['', ''])
  } finally { await close() }
})

for (const delayed of [false, true]) test(delayed
  ? 'admin assigns a missing ID; sync recovers without a second HRS or Jira write'
  : 'Quick Log syncs under an assigned profile even when HRS identity is unavailable', async () => {
  const { app, page, close } = await launch()
  try {
    await app.evaluate(({ ipcMain }, delayed) => {
      const mock = { identityReads: 0, employee: (delayed ? null : 17) as number | null, links: 0, writes: 0, jira: 0, savedDate: '',
        rows: [] as { employee_id: number; comment: string }[], logs: [] as {taskId: number; comment: string}[] }
      Object.assign(globalThis, { accessTest: mock })
      const replace = (name: string, fn: (...args: any[]) => unknown) => {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, (_event, ...args) => fn(...args))
      }
      const profile = () => ({ id: 'fixture-auth-id', role: 'employee', employee_id: mock.employee,
        display_name: 'Fixture Employee', email: 'fixture@example.test' })
      replace('supabase:getStatus', () => ({ email: profile().email, configured: true, hasPublishableKey: true,
        url: 'https://e2e.supabase.invalid', profile: profile() }))
      replace('hrs:getIdentity', () => { mock.identityReads++; throw Error('HRS directory unavailable') })
      replace('hrs:getEmployees', () => ({ hasAccess: false, hasEmployees: false, source: 'none', employees: [] }))
      replace('supabase:updateProfile', () => { mock.links++; throw Error('App cannot set employee IDs') })
      replace('hrs:getReports', (start, end) => {
        const days = []
        for (let ms = Date.parse(start); ms <= Date.parse(end); ms += 86400000) {
          const date = new Date(ms).toISOString().slice(0, 10)
          days.push({ date, isHoliday: false, minWorkLog: 0, reports: date === mock.savedDate ? mock.logs.map(row => ({ ...row, taskName: 'Design sync', projectInstance: 'Website revamp' })) : [] })
        }
        return { days, weekend: 'Fri-Sat', totalDays: days.length, totalHours: 0, totalHoursNeeded: 180, closed_date: end }
      })
      replace('hrs:logWork', payload => { mock.writes++; mock.savedDate = payload.date; mock.logs = payload.workLogs; return true })
      replace('supabase:syncWorkReports', input => {
        if (input.expectedProfileId !== profile().id || !mock.employee || input.employeeId !== mock.employee ||
            input.rows.some((row: any) => row.employee_id !== mock.employee)) throw Error('Invalid fixture sync')
        if (input.startDate!==input.endDate || input.coveredDates.length!==1) throw Error('Logging one day cannot backfill history')
        mock.rows = input.rows
        return { synced: input.rows.length }
      })
      replace('jira:addWorklog', () => { mock.jira++; return { id: 'fixture-worklog' } })
      replace('supabase:getWorkReports', () => [])
      replace('supabase:getProjectUsage', ({customer,project,startDate,endDate}) => ({ customer,project,startDate,endDate,usedSeconds: 0, contributorCount: 0, employees: [] }))
    }, delayed)
    await page.reload()
    await page.getByRole('textbox', { name: 'Project', exact: true }).click()
    await page.getByRole('option', { name: /Website revamp/ }).first().click()
    await expect(page.getByRole('textbox', { name: 'Task', exact: true })).toHaveValue('Design sync')
    await page.getByLabel('HRS Comment').fill('Fixture saved in HRS')
    await page.getByRole('button', { name: 'Log work', exact: true }).click()
    if (delayed) {
      await expect(page.getByText(/Hours saved in HRS\. Do not log them again/)).toBeVisible()
      await app.evaluate(() => { (globalThis as any).accessTest.employee = 17 })
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: /^Sync .* from HRS$/ }).click()
      await expect(page.getByText(/Synced 1 report rows? to Supabase/)).toBeVisible()
      await page.getByRole('button', { name: 'Quick Log', exact: true }).click()
      await expect(page.getByText(/Supabase sync pending:/)).toHaveCount(0)
    } else {
      await expect(page.getByText('Work log saved.', { exact: true })).toBeVisible()
    }
    const counts = await app.evaluate(() => {
      const { writes, jira, links, identityReads, rows } = (globalThis as any).accessTest
      return { writes, jira, links, identityReads, employee: rows[0]?.employee_id, comment: rows[0]?.comment }
    })
    expect(counts).toEqual({ writes: 1, jira: 0, links: 0, identityReads: 0, employee: 17, comment: 'Fixture saved in HRS' })
  } finally { await close() }
})

test('employee identity uses session metadata rather than row IDs or similar usernames', () => {
  expect(employeeFromSelfPayload([{ id: 8, taskId: 5, employee_id: 99 }])).toBeNull()
  expect(employeeFromSelfPayload({ days: [{ reports: [{ employeeId: 99 }] }], user_id: 12 })).toBeNull()
  expect(employeeFromSelfPayload({ current_user: { id: 5, employee_id: 17 } })?.employeeId).toBe('17')
  expect(employeeFromSelfPayload({ currentEmployee: { id: 12 }, employee_id: 17 })).toBeNull()
  expect(employeeFromSelfPage('<a href="?employee_id=7">Other employee</a>')).toBeNull()
  expect(employeeFromSelfPage('<div data-current-employee-id="12">Comment</div>')).toBeNull()
  expect(employeeFromSelfPage('<body data-current-employee-id="17">')?.employeeId).toBe('17')
  expect(employeeFromSelfPayload({ current_user: { email: 'amy@org.test', employee: { id: 17 } } })?.email).toBe('amy@org.test')
  const login = adminSessionLogin('<div id="user-tools">Welcome, <strong>amy@org.test</strong>.</div>')
  const rows = [{ username: 'amy', email: 'amy@other.test', isActive: true },
    { username: 'a.my', email: 'amy@org.test', isActive: true }]
  expect(selectSessionEmployee(rows, login)).toBe(rows[1])
  expect(selectSessionEmployee(rows, null)).toBeNull()
  expect(selectSessionEmployee([...rows, rows[1]], login)).toBeNull()
})

test('Settings refresh shows an administrator change without reading HRS identity or writing a profile', async () => {
  const {app,page,close}=await launch()
  try {
    await app.evaluate(({ipcMain})=>{
      const x={id:135 as number|null,reads:0,writes:0}
      Object.assign(globalThis,{mappingFixture:x})
      const replace=(n:string,fn:(...args:any[])=>unknown)=>{ipcMain.removeHandler(n);ipcMain.handle(n,(_, ...a)=>fn(...a))}
      replace('supabase:getStatus',()=>({configured:true,url:'https://fixture.invalid',hasPublishableKey:true,email:'fixture@example.test',
        profile:{id:'fixture-person',email:'fixture@example.test',role:'employee',display_name:'Fixture',employee_id:x.id}}))
      replace('hrs:getIdentity',()=>{x.reads++;throw Error('not available')})
      replace('supabase:updateProfile',()=>{x.writes++;throw Error('must not write')})
      replace('hrs:getEmployees',()=>({source:'none',hasEmployees:false,currentEmployee:null,employees:[]}))
      replace('supabase:getWorkReports',()=>[])
    })
    await page.reload()
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    const refresh=page.getByRole('button',{name:'Refresh profile mapping'})
    for(const [id, expected] of [[135,'#135'],[null,'No employee ID assigned'],[1757,'#1757']] as const) {
      await app.evaluate((_,id)=>{(globalThis as any).mappingFixture.id=id},id)
      await refresh.click()
      await expect(page.getByRole('status').filter({hasText:expected})).toBeVisible()
    }
    expect(await app.evaluate(()=>{const {reads,writes}=(globalThis as any).mappingFixture; return [reads,writes]})).toEqual([0,0])
  } finally {await close()}
})

test('the Jira link for a long HRS comment survives a renderer reload', async () => {
  const {page,close}=await launch()
  try {
    const key='2026-11-12|101|01:00|'+'long report '.repeat(70)+'|OFFICE|Project'
    await page.evaluate(async key => { await window.hrs.setJiraLoggedEntries({
      [key]: { issueKey:'TEST-8',worklogId:'122',loggedAt:'2026-11-12T09:00:00Z' } }) },key)
    await page.reload()
    expect(await page.evaluate(async key=>(await window.hrs.getJiraLoggedEntries())[key]?.worklogId,key)).toBe('122')
  } finally {await close()}
})

test('tray deletion stops on Jira denial, preserves sibling hours, and repairs only Supabase after a restart', async () => {
  const {app,page,close} = await launch()
  try {
    const date = await page.evaluate(() => {
      const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),'12'].join('-')
    })
    await app.evaluate(({ipcMain},date) => {
      const row = (from:string,to:string) => ({taskId:101, taskName:'Design sync', projectInstance:'Website revamp',
        hours_HHMM:'01:00', comment:'identical fixture hours', reporting_from:'OFFICE',from,to})
      const x = {hrs:[row('09:00','10:00'),row('13:00','14:00')],db:['09:00','13:00'],
        allowJira:false,allowDb:false,jira:[] as string[],writes:0,dbAttempts:0}
      Object.assign(globalThis,{deleteFixture:x})
      const replace = (name:string,fn:(...args:any[])=>unknown) => {ipcMain.removeHandler(name);ipcMain.handle(name,(_, ...args)=>fn(...args))}
      replace('hrs:getReports',(start:string,end:string) => {
        const days=[]
        for (let ms=Date.parse(start);ms<=Date.parse(end);ms+=86400000) {
          const key=new Date(ms).toISOString().slice(0,10)
          days.push({date:key,isHoliday:false,minWorkLog:0,reports:key===date?x.hrs:[]})
        }
        return {days,weekend:'Fri-Sat',totalDays:days.length,totalHours:0,totalHoursNeeded:180,closed_date:end}
      })
      replace('hrs:getIdentity',()=>({employeeId:'17',employeeName:'Self',email:'self@example.test',username:'self',source:'api_payload'}))
      replace('supabase:getStatus',()=>({configured:true,hasPublishableKey:true,url:'https://fixture.invalid',email:'self@example.test',
        profile:{id:'fixture-self',employee_id:17,email:'self@example.test',role:'employee',display_name:'Self'}}))
      replace('supabase:getWorkReports',()=>[])
      replace('supabase:syncWorkReports',payload=>{
        if (payload.startDate!==date || payload.endDate!==date) return {synced:payload.rows.length} // background month refresh
        x.dbAttempts++
        if (!x.allowDb) throw Error('fixture Supabase offline')
        if(payload.expectedProfileId!=='fixture-self'||payload.employeeId!==17) throw Error('unexpected owner')
        x.db=payload.rows.map((r:any)=>r.from_time)
        return {synced:payload.rows.length}
      })
      replace('hrs:logWork',payload=>{
        if(payload.date!==date) throw Error('unexpected day')
        x.writes++; x.hrs=payload.workLogs.map((r:any)=>({...r,projectInstance:'Website revamp',taskName:'Design sync'})); return true
      })
      replace('hrs:deleteLog',()=>{throw Error('must preserve sibling')})
      replace('jira:deleteWorklog',t=>{
        if(!x.allowJira) throw Error('fixture Jira permission denied')
        if(t.issueKey!=='TEST-8'||t.worklogId!=='second') throw Error('wrong Jira worklog')
        x.jira.push(t.worklogId);return true
      })
      let links:Record<string,{issueKey:string;worklogId:string;loggedAt:string}> = {}
      for(const [from,to,id] of [['09:00','10:00','first'],['13:00','14:00','second']]) {
        links['slot:'+ [date,101,from,to,'01:00'].join('|')] = {issueKey:'TEST-8',worklogId:id,loggedAt:'fixture'}
      }
      replace('app:getJiraLoggedEntries',()=>links)
      replace('app:setJiraLoggedEntries',next=>(links=next))
    },date)
    await page.reload()
    await page.evaluate(()=>{window.confirm=()=>true})
    const day = page.locator('button.tray-day-button.has-reports').filter({has:page.locator('.tray-day-number',{hasText:/^12$/})})
    await day.click({button:'right'})
    const modal = page.getByRole('dialog')
    const target = modal.getByRole('button',{name:'Delete',exact:true}).nth(1)
    await target.click()
    await expect(modal.getByRole('status')).toContainText('Jira deletion not confirmed')
    expect(await app.evaluate(()=>{const x=(globalThis as any).deleteFixture;return [x.writes,x.dbAttempts,x.jira.length]})).toEqual([0,0,0])
    await app.evaluate(()=>{(globalThis as any).deleteFixture.allowJira=true})
    await target.click()
    await expect(modal.getByRole('status')).toContainText('Supabase sync is pending')
    expect(await app.evaluate(()=>{const x=(globalThis as any).deleteFixture;return [x.writes,x.hrs.map((v:any)=>v.from),x.jira,x.db]}))
      .toEqual([1,['09:00'],['second'],['09:00','13:00']])
    await page.reload()
    await page.getByRole('button',{name:'Settings',exact:true}).click()
    await app.evaluate(()=>{(globalThis as any).deleteFixture.allowDb=true})
    await page.getByRole('button',{name:'Check pending deletion · '+date}).click()
    await expect(page.getByText(/Deletion confirmed in HRS, Supabase/)).toBeVisible()
    expect(await app.evaluate(()=>{const x=(globalThis as any).deleteFixture;return [x.db,x.writes,x.jira,x.dbAttempts]}))
      .toEqual([['09:00'],1,['second'],2])
  } finally {await close()}
})

test('profile is the sole numeric mapping and is re-read before writing, even for managers', async ()=>{
  let employee:number|null=135, email:string|null='fixture@example.test'
  const current=()=>({id:'owner',employee_id:employee,email:email || '',display_name:'Fixture',role:'manager' as const})
  const api={getSupabaseStatus:async ():Promise<ReportStatus>=>({configured:true,url:'',hasPublishableKey:true,email,profile:current()}),
    getHrsIdentity:async()=>({employeeId:'999'}), updateSupabaseProfile:async()=>{throw Error('must not write')}}
  expect((await profileForReportSync(api)).profile.employee_id).toBe(135)
  await expect(profileForReportSync(api,'different')).rejects.toThrow(/account or its employee mapping changed/)
  const from='2026-11-01', end='2026-11-30', d='2026-11-12'
  const row={id:'hrs|135|'+d+'|1',employee_id:135,report_date:d,source:'hrs'}
  expect(checkPersonalSnapshotScope(current(),'owner','owner',135,from,end,[row])).toBe(135)
  employee=1757
  expect(()=>checkPersonalSnapshotScope(current(),'owner','owner',135,from,end,[row])).toThrow()
  expect(()=>checkPersonalSnapshotScope(current(),'owner','owner',1757,from,end,[row])).toThrow()
  expect(()=>checkPersonalSnapshotScope(current(),'other','owner',1757,from,end,[])).toThrow()
  expect((await profileForReportSync(api)).profile.employee_id).toBe(1757)
  expect(()=>confirmedDays([],from,end,[])).toThrow()
  expect(()=>confirmedDays([end],from,end,[row])).toThrow()
  for(const invalid of [null,0,-1,NaN,3.2]){ employee=invalid;await expect(profileForReportSync(api)).rejects.toThrow(/administrator/) }
  email=null;await expect(profileForReportSync(api)).rejects.toThrow(/Sign in/)
})
test('personal sync protects other uploaders, collision keys and absent days',()=>{
  const date='2026-11-12',other='2026-11-11'
  const saved=(id:string,synced_by:string|null,report_date=date)=>({id,report_date,synced_by,comment:'old'})
  const incoming=(id:string)=>({id,report_date:date,comment:'new'})
  const plan=planPersonalWrites(['mine','new','collision'].map(incoming),[
    saved('mine','actor'),saved('stale','actor'),saved('outside','actor',other),
    saved('collision','other-uuid'),saved('orphan',null)],'actor',new Set([date]))
  expect(plan).toEqual({creates:[incoming('new')],updates:[incoming('mine')],adopt:[],stale:['stale'],review:2})
})
test('duration-only administrative import is adopted once on an exact personal match, never guessed or silently pruned',()=>{
  const day='2026-01-12', days=new Set([day])
  const entry={report_date:day,employee_id:17,task_id:81,seconds:3600,comment:'Conference notes',project:'P',customer:'C'}
  const manual={...entry,id:'original',source:'hrs_manual',synced_by:null,shared_fictive_task_id:'shared-id'}
  const real={...entry,id:'authoritative-time-key',source:'hrs',from_time:'10:00',to_time:'11:00'}
  const one=planPersonalWrites([real],[manual],'actor',days)
  expect(one).toEqual({creates:[],updates:[],adopt:[{previous:manual,row:real}],stale:[],review:0})
  for(const r of [[],[real,{...real,id:'similar'}],[{...real,comment:'different'}]]) {
    const p=planPersonalWrites(r,[manual],'actor',days)
    expect([p.creates.length,p.adopt.length,p.stale.length,p.review]).toEqual([0,0,0,1])
  }
  const other={...real,task_id:82,id:'unrelated'}
  expect(planPersonalWrites([other],[manual],'actor',days).creates).toEqual([other])
})
test('retry never expands one day to a month or borrows a different account or previous employee mapping',()=>{
  const owner={id:'fixture-a',employee_id:135}, date='2026-11-23'
  const key=pendingDay(owner,date)
  expect(retryDate(key,owner)).toBe(date)
  expect(retryDate(key,{...owner,employee_id:1757})).toBeNull()
  expect(retryDate(key,{...owner,id:'fixture-b'})).toBeNull()
  expect(retryDate(pendingDay({...owner,employee_id:null},date),owner)).toBe(date)
  expect(validPendingScope('2026-11')).toBe(true)
  expect(retryDate('2026-11',owner)).toBeNull()
})
