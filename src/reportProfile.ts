export type ReportProfile = {
  id: string; email: string; employee_id: number | null; display_name: string | null; role: 'employee' | 'manager'
}
export type ReportStatus = {
  configured: boolean; url: string; hasPublishableKey: boolean; email: string | null; profile: ReportProfile | null
}
export const SIGN_IN_FOR_SYNC = 'Sign in to Supabase in Settings → Access.'
export const MISSING_EMPLOYEE_MAPPING = 'No valid employee ID is assigned in your Supabase profile. Ask an administrator to set profiles.employee_id, then retry sync. Do not log the hours again.'
export const DIFFERENT_ACCOUNT = 'The Supabase account or its employee mapping changed. Refresh Settings → Access and retry.'
export const validEmployeeId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
export function requiresEmployeeAction(message: string) {
  return [SIGN_IN_FOR_SYNC, MISSING_EMPLOYEE_MAPPING, DIFFERENT_ACCOUNT, 'Ownership review required:'].some(reason=>message.includes(reason))
}

// The admin-managed profile, not an optional employee-directory lookup, owns a
// personal snapshot. Read it afresh each time; the main process repeats the check.
export async function profileForReportSync(api: { getSupabaseStatus(): Promise<ReportStatus> }, expectedProfileId?: string) {
  const status = await api.getSupabaseStatus()
  if (!status.email) throw Error(SIGN_IN_FOR_SYNC)
  const profile = status.profile
  if (!profile?.id) throw Error('No profile for the signed-in Supabase account. Ask an administrator to provision it.')
  if (expectedProfileId && profile.id !== expectedProfileId) throw Error(DIFFERENT_ACCOUNT)
  if (!validEmployeeId(profile.employee_id)) throw Error(MISSING_EMPLOYEE_MAPPING)
  return { ...status, profile: { ...profile, employee_id: profile.employee_id } }
}

type ScopedRow = { id: string; employee_id: number; report_date: string; source?: string }
export function checkPersonalSnapshotScope(profile: ReportProfile | null, userId: string, expectedProfileId: unknown,
  requestedEmployeeId: unknown, start: string, end: string, rows: ScopedRow[]) {
  if (!profile || !validEmployeeId(profile.employee_id)) throw Error(MISSING_EMPLOYEE_MAPPING)
  const employeeId = profile.employee_id
  if (profile.id !== userId || expectedProfileId !== userId || requestedEmployeeId !== employeeId || end < start ||
    rows.some(row => row.employee_id !== employeeId || row.report_date < start || row.report_date > end ||
      row.source !== 'hrs' || !row.id.startsWith('hrs|' + employeeId + '|' + row.report_date + '|'))) throw Error(DIFFERENT_ACCOUNT)
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Duplicate keys in the personal HRS snapshot. Nothing was synced.')
  return employeeId
}

export function confirmedDays(dates: unknown, from: string, to: string, rows: ScopedRow[]) {
  if (!Array.isArray(dates) || !dates.length || dates.length > 31 ||
      dates.some(d => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < from || d > to) ||
      new Set(dates).size !== dates.length || rows.some(r => !dates.includes(r.report_date))) {
    throw Error('HRS did not confirm the requested report dates. No hours were reconciled.')
  }
  return new Set<string>(dates)
}
