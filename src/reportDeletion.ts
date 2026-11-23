// HRS replaces an entire day. Journal only fingerprints and exact Jira IDs, never
// credentials or report text. A lost response is not evidence that a write failed.
export type JiraDeleteTarget = { issueKey: string; worklogId: string }
export type DeleteOwner = { profileId: string; employeeId: number }
export type DeleteJob = DeleteOwner & {
  date: string; selected: number[]; before: string; after: string
  jiraAccount: string; targets: JiraDeleteTarget[]; completed: number
  phase: 'jira' | 'hrs-sent' | 'supabase'
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const prefix = 'hrs.personal-delete.v1:'
const ownerPrefix = (owner: DeleteOwner) => prefix + encodeURIComponent(owner.profileId) + ':' + owner.employeeId + ':'
const key = (owner: DeleteOwner, date: string) => ownerPrefix(owner) + date
export function pendingDeleteDates(store: Storage, owner: DeleteOwner) {
  const p = ownerPrefix(owner)
  return Array.from({ length: store.length }, (_, i) => store.key(i) ?? '')
    .filter(k => k.startsWith(p)).map(k => k.slice(p.length)).sort()
}
export function readDeleteJob(store: Store, owner: DeleteOwner, date: string): DeleteJob | null {
  const raw = store.getItem(key(owner, date))
  if (!raw) return null
  const job: DeleteJob = JSON.parse(raw)
  if (job.profileId !== owner.profileId || job.employeeId !== owner.employeeId || job.date !== date ||
      !['jira','hrs-sent','supabase'].includes(job.phase) || !Array.isArray(job.targets) ||
      !Array.isArray(job.selected) || !Number.isInteger(job.completed) || job.completed < 0 ||
      job.completed > job.targets.length) throw Error('Invalid pending deletion. No writes were attempted.')
  return job
}
type Report = { taskId: number; hours_HHMM: string; comment?: string; reporting_from?: string; projectInstance?: string; from?: string; to?: string }
export async function dayFingerprint(rows: Report[]) {
  const payload = rows.map(r => [r.taskId, r.hours_HHMM, r.comment || '', r.reporting_from || '',
    r.projectInstance || '', r.from || '', r.to || ''])
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  return Array.from(new Uint8Array(raw), b => b.toString(16).padStart(2, '0')).join('')
}
export const deletionSelectionKey = (r: Report & { dateKey: string; dayIndex: number }) =>
  JSON.stringify([r.dateKey, r.dayIndex, r.taskId, r.hours_HHMM, r.comment, r.reporting_from, r.projectInstance, r.from, r.to])

type Steps = {
  store: Store; owner: DeleteOwner; date: string
  verifyOwner: () => Promise<void>; readDayHash: () => Promise<string>
  reconcile: () => Promise<void>
}
type Selection = {
  selected: number[]; before: string; after: string
  resolveJira: () => Promise<{ account: string; targets: JiraDeleteTarget[] }>
  deleteJira: (target: JiraDeleteTarget, expectedAccount: string) => Promise<void>
  writeDay: () => Promise<void>
}
const changed = 'The HRS day has changed. Refresh Reports and review the selection; no further deletion was attempted.'
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

// Without a selection (e.g. after restarting) only confirm an earlier HRS write
// and repair Supabase. Never replay a Jira or HRS deletion in the background.
export async function runDeletionDay(s: Steps, selection?: Selection) {
  const k = key(s.owner, s.date)
  let job = readDeleteJob(s.store, s.owner, s.date)
  const save = (v: DeleteJob) => { s.store.setItem(k, JSON.stringify(v)); return v }
  await s.verifyOwner()
  if (!job) {
    if (!selection) return
    if (await s.readDayHash() !== selection.before) throw Error(changed)
    const { account, targets } = await selection.resolveJira()
    if (new Set(targets.map(t => t.issueKey + ':' + t.worklogId)).size !== targets.length) {
      throw Error('Two reports point to the same Jira worklog. Nothing was deleted.')
    }
    job = save({ ...s.owner, date: s.date, before: selection.before, after: selection.after,
      selected: selection.selected, jiraAccount: account, targets, completed: 0, phase: 'jira' })
  } else if (selection && (job.before !== selection.before || job.after !== selection.after ||
      JSON.stringify(job.selected) !== JSON.stringify(selection.selected))) {
    throw Error('A different deletion is pending for this day. Finish it before selecting other reports.')
  }
  if (job.phase === 'hrs-sent' && await s.readDayHash() === job.after) job = save({ ...job, phase: 'supabase' })
  if (job.phase !== 'supabase') {
    if (!selection) throw Error('Retry the original selection in Reports. No HRS or Jira delete was repeated.')
    if (await s.readDayHash() !== job.before) throw Error(changed)
    while (job.completed < job.targets.length) {
      const target = job.targets[job.completed]
      try {
        await s.verifyOwner()
        await selection.deleteJira(target, job.jiraAccount)
      } catch (e) {
        throw Error('Jira deletion not confirmed for ' + target.issueKey + '. HRS and Supabase were not deleted. ' +
          job.completed + ' of ' + job.targets.length + ' Jira deletions confirmed. ' + message(e))
      }
      job = save({ ...job, completed: job.completed + 1 })
    }
    await s.verifyOwner()
    if (await s.readDayHash() !== job.before) throw Error(changed)
    job = save({ ...job, phase: 'hrs-sent' })
    let writeError = ''
    try { await selection.writeDay() } catch (e) { writeError = message(e) }
    let confirmed = false
    try { confirmed = await s.readDayHash() === job.after } catch { /* Retain the uncertain step. */ }
    if (!confirmed) throw Error('HRS deletion not confirmed. ' + job.completed +
      ' Jira deletions confirmed; Supabase has not been reconciled. Retry the original selection. ' + writeError)
    job = save({ ...job, phase: 'supabase' })
  }
  try { await s.verifyOwner(); await s.reconcile() }
  catch (e) { throw Error('Deleted in HRS; linked Jira worklogs are cleared. Supabase sync is pending for ' +
    s.date + '. Retry in Settings → Access. ' + message(e)) }
  s.store.removeItem(k)
  return job
}
