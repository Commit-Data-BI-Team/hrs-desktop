import { expect, test } from '@playwright/test'
import { runDeletionDay, readDeleteJob, deletionSelectionKey, dayFingerprint } from '../../src/reportDeletion'

function fixture() {
  const map = new Map<string,string>()
  const store = { getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string,v: string) => { map.set(k,v) }, removeItem: (k: string) => { map.delete(k) } }
  const owner = { profileId: 'fixture-a', employeeId: 42 }
  const calls: string[] = []
  const state = { hash: 'before', deny: '', failHrs: false, lostHrs: false, failDb: false, wrongAccount: false }
  const steps = { store, owner, date: '2026-11-12',
    readDayHash: async () => state.hash,
    verifyOwner: async () => { if (state.wrongAccount) throw Error('Wrong employee') },
    reconcile: async () => { calls.push('supabase'); if (state.failDb) throw Error('no connection') } }
  const selection = { selected: [0,1], before: 'before', after: 'after',
    resolveJira: async () => ({ account: 'jira/fixture', targets: ['1','2'].map(worklogId => ({ issueKey: 'TEST-2', worklogId })) }),
    deleteJira: async ({worklogId}: {worklogId: string}) => {
      calls.push('jira:'+worklogId); if (worklogId === state.deny) throw Error('Permission denied')
    },
    writeDay: async () => {
      calls.push('hrs'); if (state.failHrs) throw Error('server error')
      state.hash = 'after'; if (state.lostHrs) throw Error('response lost')
    } }
  return { map, steps, selection, state, calls, pending: () => readDeleteJob(store,owner,steps.date) }
}

test('bulk deletion confirms exact Jira targets, HRS day, then Supabase', async () => {
  const f = fixture()
  await runDeletionDay(f.steps, f.selection)
  expect(f.calls).toEqual(['jira:1','jira:2','hrs','supabase'])
  expect(f.pending()).toBeNull()
})
test('an unlinked report does not call Jira', async () => {
  const f = fixture()
  await runDeletionDay(f.steps, {...f.selection,resolveJira: async () => ({account:'', targets:[]})})
  expect(f.calls).toEqual(['hrs','supabase'])
})
test('a denied bulk Jira delete preserves HRS, Supabase, and completed worklog IDs across retries', async () => {
  const f = fixture()
  f.state.deny = '2'
  await expect(runDeletionDay(f.steps,f.selection)).rejects.toThrow(/1 of 2/)
  expect(f.calls).toEqual(['jira:1','jira:2'])
  expect(f.pending()?.completed).toBe(1)
  f.state.deny = ''
  await runDeletionDay(f.steps,{ ...f.selection, resolveJira: async () => { throw Error('must reuse exact IDs') } })
  expect(f.calls).toEqual(['jira:1','jira:2','jira:2','hrs','supabase'])
})
test('a lost HRS reply is verified before reconciling; an unchanged day is never assumed deleted', async () => {
  const f = fixture()
  f.state.failHrs = true
  await expect(runDeletionDay(f.steps,f.selection)).rejects.toThrow(/HRS deletion not confirmed/)
  expect(f.calls).not.toContain('supabase')
  await expect(runDeletionDay(f.steps)).rejects.toThrow(/original selection/)
  f.state.failHrs = false; f.state.lostHrs = true
  await runDeletionDay(f.steps,f.selection)
  expect(f.calls).toEqual(['jira:1','jira:2','hrs','hrs','supabase'])
})
test('Supabase repair after restart is account scoped and repeats neither HRS nor Jira', async () => {
  const f = fixture()
  f.state.failDb = true
  await expect(runDeletionDay(f.steps,f.selection)).rejects.toThrow(/Supabase sync is pending/)
  expect(f.pending()?.phase).toBe('supabase')
  await runDeletionDay({...f.steps, owner: {profileId:'other',employeeId:99}})
  f.state.wrongAccount = true
  await expect(runDeletionDay(f.steps)).rejects.toThrow(/Wrong employee/)
  f.state.failDb = f.state.wrongAccount = false
  await runDeletionDay(f.steps)
  expect(f.calls).toEqual(['jira:1','jira:2','hrs','supabase','supabase'])
})
test('stale days, duplicate Jira targets and failed durable storage never start a deletion', async () => {
  const f = fixture()
  f.state.hash = 'changed'
  await expect(runDeletionDay(f.steps,f.selection)).rejects.toThrow(/changed/)
  f.state.hash = 'before'
  await expect(runDeletionDay(f.steps,{...f.selection,resolveJira: async () => ({
    account:'', targets: Array(2).fill({issueKey:'TEST-1',worklogId:'2'}) })})).rejects.toThrow(/same Jira/)
  await expect(runDeletionDay({...f.steps,store:{...f.steps.store,setItem: () => { throw Error('storage full') }}},f.selection)).rejects.toThrow(/storage full/)
  expect(f.calls).toEqual([])
})
test('rows with otherwise identical reports have distinct selection keys and day fingerprints', async () => {
  const a = { dateKey:'2026-11-11',dayIndex:0,taskId:1,hours_HHMM:'01:00',comment:'same',from:'09:00',to:'10:00' }
  const b = {...a,dayIndex:1,from:'11:00',to:'12:00'}
  expect(deletionSelectionKey(a)).not.toBe(deletionSelectionKey(b))
  expect(await dayFingerprint([a,b])).not.toBe(await dayFingerprint([b,a]))
})
