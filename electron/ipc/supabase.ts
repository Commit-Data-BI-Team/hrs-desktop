import { ipcMain } from 'electron'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import {
  getSupabaseConfig,
  getSupabaseSession,
  setSupabaseConfig,
  setSupabaseSession
} from '../supabase/config'

type SupabaseProfile = {
  id: string
  email: string
  employee_id: number | null
  display_name: string | null
  role: 'manager' | 'employee'
}

type WorkReportRow = {
  id: string
  employee_id: number
  employee_name: string
  customer: string
  project: string | null
  task_id: number | null
  task_name: string
  report_date: string
  seconds: number
  comment: string | null
  reporting_from: string | null
  from_time: string | null
  to_time: string | null
  shared_fictive_task_id: string | null
  source: string
  synced_at?: string
}

type WorkReportInput = Omit<WorkReportRow, 'source' | 'synced_at'> & {
  source?: string
}

type MissionStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'archived'

type SharedFictiveTaskRow = {
  id: string
  customer: string
  project: string | null
  original_hrs_task_id: number
  original_hrs_task_name: string | null
  jira_issue_key: string
  name: string
  planned_seconds: number | null
  capped_seconds: number | null
  status: MissionStatus
  notes: string | null
  assigned_employee_ids: number[] | null
  created_by: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

type SharedFictiveTaskUsageRow = {
  task_id: string
  used_seconds: number
  contributor_count: number
  last_reported_at: string | null
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MISSION_STATUSES = new Set<MissionStatus>([
  'todo',
  'in_progress',
  'blocked',
  'done',
  'archived'
])

function cleanString(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanNullableString(value: unknown, max = 500) {
  const cleaned = cleanString(value, max)
  return cleaned || null
}

function cleanNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function validateDate(value: unknown) {
  const text = cleanString(value, 20)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('Invalid date')
  }
  return text
}

function cleanUuid(value: unknown, required = false) {
  const uuid = cleanString(value, 80)
  if (!uuid && !required) return null
  if (!UUID_REGEX.test(uuid)) throw new Error('Invalid shared task ID')
  return uuid
}

function cleanNullableHours(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const hours = cleanNumber(value)
  if (hours === null || hours < 0 || hours > 100_000) {
    throw new Error('Invalid shared task hours')
  }
  return hours
}

function normalizeSharedFictiveTask(row: SharedFictiveTaskRow) {
  return {
    id: row.id,
    customerName: row.customer,
    projectName: row.project,
    name: row.name,
    jiraIssueKey: row.jira_issue_key,
    hrsTaskIds: [String(row.original_hrs_task_id)],
    originalHrsTaskName: row.original_hrs_task_name,
    virtual: true,
    assignedEmployees: (row.assigned_employee_ids ?? []).map(String),
    plannedHours:
      typeof row.planned_seconds === 'number' ? row.planned_seconds / 3600 : null,
    cappedHours:
      typeof row.capped_seconds === 'number' ? row.capped_seconds / 3600 : null,
    status: row.status,
    dependencies: [],
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shared: true,
    createdBy: row.created_by,
    archivedAt: row.archived_at
  }
}

function isSharedSchemaMissing(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    message.includes('shared_fictive_tasks') ||
    message.includes('shared_fictive_task_id') ||
    message.includes('get_shared_fictive_task_usage')
  )
}

async function createSupabaseClient() {
  const { url, publishableKey } = getSupabaseConfig()
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: WebSocket
    }
  })
  const session = await getSupabaseSession()
  if (session?.access_token && session.refresh_token) {
    const { data, error } = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    })
    if (!error && data.session) {
      await setSupabaseSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      })
    }
  }
  return client
}

async function getProfile(client: SupabaseClient): Promise<SupabaseProfile | null> {
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) return null
  const { data, error } = await client
    .from('profiles')
    .select('id,email,employee_id,display_name,role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as SupabaseProfile | null) ?? null
}

function normalizeReportRows(rows: unknown): WorkReportInput[] {
  if (!Array.isArray(rows)) throw new Error('Reports payload must be an array')
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Invalid report row ${index + 1}`)
    const record = row as Record<string, unknown>
    const id = cleanString(record.id, 700)
    const employeeId = cleanNumber(record.employee_id)
    const seconds = cleanNumber(record.seconds)
    if (!id) throw new Error(`Missing report row id ${index + 1}`)
    if (!employeeId) throw new Error(`Missing employee_id for row ${index + 1}`)
    if (seconds === null || seconds < 0) throw new Error(`Invalid seconds for row ${index + 1}`)
    return {
      id,
      employee_id: employeeId,
      employee_name: cleanString(record.employee_name, 250) || `Employee ${employeeId}`,
      customer: cleanString(record.customer, 250) || 'Unknown',
      project: cleanNullableString(record.project, 250),
      task_id: cleanNumber(record.task_id),
      task_name: cleanString(record.task_name, 500) || 'Unknown task',
      report_date: validateDate(record.report_date),
      seconds,
      comment: cleanNullableString(record.comment, 1000),
      reporting_from: cleanNullableString(record.reporting_from, 100),
      from_time: cleanNullableString(record.from_time, 20),
      to_time: cleanNullableString(record.to_time, 20),
      shared_fictive_task_id: cleanUuid(record.shared_fictive_task_id),
      source: cleanString(record.source, 40) || 'hrs'
    }
  })
}

export function registerSupabaseIpc() {
  ipcMain.handle('supabase:getStatus', async () => {
    const config = getSupabaseConfig()
    const client = await createSupabaseClient()
    const { data } = await client.auth.getUser()
    const profile = data.user ? await getProfile(client) : null
    return {
      configured: Boolean(config.url && config.publishableKey),
      url: config.url,
      hasPublishableKey: Boolean(config.publishableKey),
      email: data.user?.email ?? null,
      profile
    }
  })

  ipcMain.handle('supabase:setConfig', async (_event, url: string, publishableKey: string) => {
    return setSupabaseConfig(url, publishableKey)
  })

  ipcMain.handle('supabase:signUp', async (_event, email: string, password: string) => {
    const client = await createSupabaseClient()
    const { data, error } = await client.auth.signUp({
      email: cleanString(email, 250),
      password: String(password || '')
    })
    if (error) throw new Error(error.message)
    if (data.session) {
      await setSupabaseSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      })
    }
    return { email: data.user?.email ?? null, needsConfirmation: !data.session }
  })

  ipcMain.handle('supabase:signIn', async (_event, email: string, password: string) => {
    const client = await createSupabaseClient()
    const { data, error } = await client.auth.signInWithPassword({
      email: cleanString(email, 250),
      password: String(password || '')
    })
    if (error) throw new Error(error.message)
    if (!data.session) throw new Error('Supabase did not return a session')
    await setSupabaseSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    })
    return {
      email: data.user?.email ?? null,
      profile: await getProfile(client)
    }
  })

  ipcMain.handle('supabase:resendConfirmation', async (_event, email: string) => {
    const client = await createSupabaseClient()
    const { error } = await client.auth.resend({
      type: 'signup',
      email: cleanString(email, 250)
    })
    if (error) throw new Error(error.message)
    return true
  })

  ipcMain.handle('supabase:signOut', async () => {
    const client = await createSupabaseClient()
    await client.auth.signOut()
    await setSupabaseSession(null)
    return true
  })

  ipcMain.handle('supabase:claimManager', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const client = await createSupabaseClient()
    const { data, error } = await client.rpc('claim_first_manager', {
      display_name_input: cleanNullableString(record.displayName, 250),
      employee_id_input: cleanNumber(record.employeeId)
    })
    if (error) throw new Error(error.message)
    return data as SupabaseProfile
  })

  ipcMain.handle('supabase:updateProfile', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const client = await createSupabaseClient()
    const { data, error } = await client.rpc('update_own_profile', {
      display_name_input: cleanNullableString(record.displayName, 250),
      employee_id_input: cleanNumber(record.employeeId)
    })
    if (error) throw new Error(error.message)
    return data as SupabaseProfile
  })

  ipcMain.handle('supabase:getWorkReports', async (_event, startDate: string, endDate: string) => {
    const client = await createSupabaseClient()
    const { data, error } = await client
      .from('work_reports')
      .select('*')
      .gte('report_date', validateDate(startDate))
      .lte('report_date', validateDate(endDate))
      .order('report_date', { ascending: true })
      .order('employee_name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as WorkReportRow[]
  })

  ipcMain.handle('supabase:getSharedFictiveTasks', async () => {
    const client = await createSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) {
      return { available: false, tasks: [] }
    }
    const { data, error } = await client
      .from('shared_fictive_tasks')
      .select('*')
      .is('archived_at', null)
      .order('customer', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      if (isSharedSchemaMissing(error)) return { available: false, tasks: [] }
      throw new Error(error.message)
    }
    return {
      available: true,
      tasks: ((data ?? []) as SharedFictiveTaskRow[]).map(normalizeSharedFictiveTask)
    }
  })

  ipcMain.handle('supabase:upsertSharedFictiveTask', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const client = await createSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) throw new Error('Supabase auth required to share a task')
    const profile = await getProfile(client)
    const requestedId = cleanUuid(record.id)
    const originalTaskId = cleanNumber(record.originalHrsTaskId ?? record.hrsTaskId)
    if (!originalTaskId || originalTaskId <= 0) throw new Error('Original HRS task is required')
    const jiraIssueKey = cleanString(record.jiraIssueKey, 120).toUpperCase()
    if (!jiraIssueKey) throw new Error('Jira issue is required for a shared task')
    const customer = cleanString(record.customerName, 250)
    const name = cleanString(record.name, 500)
    if (!customer || !name) throw new Error('Customer and task name are required')
    const statusValue = cleanString(record.status, 40) || 'in_progress'
    if (!MISSION_STATUSES.has(statusValue as MissionStatus)) {
      throw new Error('Invalid shared task status')
    }
    const plannedHours = cleanNullableHours(record.plannedHours)
    const cappedHours = cleanNullableHours(record.cappedHours)
    const assignedEmployeeIds = Array.isArray(record.assignedEmployeeIds)
      ? record.assignedEmployeeIds
          .map(cleanNumber)
          .filter((value): value is number => typeof value === 'number' && value > 0)
          .slice(0, 200)
      : []

    const { data: existing, error: existingError } = await client
      .from('shared_fictive_tasks')
      .select('*')
      .eq('jira_issue_key', jiraIssueKey)
      .maybeSingle()
    if (existingError) {
      if (isSharedSchemaMissing(existingError)) {
        throw new Error('Shared tasks database is not installed. Apply Supabase migration 002_shared_fictive_tasks.sql.')
      }
      throw new Error(existingError.message)
    }

    const existingRow = existing as SharedFictiveTaskRow | null
    if (
      existingRow &&
      existingRow.created_by !== userData.user.id &&
      profile?.role !== 'manager'
    ) {
      return normalizeSharedFictiveTask(existingRow)
    }

    const row = {
      id: existingRow?.id ?? requestedId ?? undefined,
      customer,
      project: cleanNullableString(record.projectName, 250),
      original_hrs_task_id: originalTaskId,
      original_hrs_task_name: cleanNullableString(record.originalHrsTaskName, 500),
      jira_issue_key: jiraIssueKey,
      name,
      planned_seconds: plannedHours === null ? null : Math.round(plannedHours * 3600),
      capped_seconds: cappedHours === null ? null : Math.round(cappedHours * 3600),
      status: statusValue,
      notes: cleanNullableString(record.notes, 4000),
      assigned_employee_ids: assignedEmployeeIds,
      created_by: existingRow?.created_by ?? userData.user.id,
      archived_at: null
    }
    const { data, error } = await client
      .from('shared_fictive_tasks')
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') {
        const { data: concurrent, error: concurrentError } = await client
          .from('shared_fictive_tasks')
          .select('*')
          .eq('jira_issue_key', jiraIssueKey)
          .single()
        if (!concurrentError && concurrent) {
          return normalizeSharedFictiveTask(concurrent as SharedFictiveTaskRow)
        }
      }
      if (isSharedSchemaMissing(error)) {
        throw new Error('Shared tasks database is not installed. Apply Supabase migration 002_shared_fictive_tasks.sql.')
      }
      throw new Error(error.message)
    }
    return normalizeSharedFictiveTask(data as SharedFictiveTaskRow)
  })

  ipcMain.handle('supabase:archiveSharedFictiveTask', async (_event, taskId: unknown) => {
    const id = cleanUuid(taskId, true) as string
    const client = await createSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) throw new Error('Supabase auth required to archive a task')
    const { data, error } = await client
      .from('shared_fictive_tasks')
      .update({ archived_at: new Date().toISOString(), status: 'archived' })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      if (isSharedSchemaMissing(error)) {
        throw new Error('Shared tasks database is not installed. Apply Supabase migration 002_shared_fictive_tasks.sql.')
      }
      throw new Error(error.message)
    }
    if (!data) throw new Error('Shared task was not found, or you do not have permission to archive it')
    return true
  })

  ipcMain.handle('supabase:getSharedFictiveTaskUsage', async (_event, taskIds: unknown) => {
    const ids = Array.isArray(taskIds)
      ? taskIds.slice(0, 500).map(value => cleanUuid(value, true) as string)
      : []
    const client = await createSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) return []
    const { data, error } = await client.rpc('get_shared_fictive_task_usage', {
      task_ids: ids.length ? ids : null
    })
    if (error) {
      if (isSharedSchemaMissing(error)) return []
      throw new Error(error.message)
    }
    return ((data ?? []) as SharedFictiveTaskUsageRow[]).map(row => ({
      taskId: row.task_id,
      usedSeconds: Number(row.used_seconds) || 0,
      contributorCount: Number(row.contributor_count) || 0,
      lastReportedAt: row.last_reported_at ?? null
    }))
  })

  ipcMain.handle('supabase:syncWorkReports', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const startDate = validateDate(record.startDate)
    const endDate = validateDate(record.endDate)
    const rows = normalizeReportRows(record.rows)
    const requestedEmployeeId = cleanNumber(record.employeeId)
    const client = await createSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) throw new Error('Supabase auth required')
    const profile = await getProfile(client)
    const employeeIds = Array.from(
      new Set(
        [
          requestedEmployeeId,
          ...(rows.length ? rows.map(row => row.employee_id) : []),
          profile?.employee_id ?? null
        ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      )
    )

    const { data: syncRun, error: syncRunError } = await client
      .from('sync_runs')
      .insert({
        source: 'hrs',
        from_date: startDate,
        to_date: endDate,
        rows_count: rows.length,
        synced_by: userData.user.id,
        status: 'running'
      })
      .select('id')
      .single()
    if (syncRunError) throw new Error(syncRunError.message)

    const { data: existingRows, error: existingRowsError } = employeeIds.length
      ? await client
          .from('work_reports')
          .select('id,shared_fictive_task_id')
          .eq('source', 'hrs')
          .gte('report_date', startDate)
          .lte('report_date', endDate)
          .in('employee_id', employeeIds)
      : { data: [], error: null }
    const sharedColumnAvailable = !existingRowsError
    if (existingRowsError && !isSharedSchemaMissing(existingRowsError)) {
      throw new Error(existingRowsError.message)
    }
    const existingSharedTaskById = new Map(
      ((existingRows ?? []) as Array<{ id: string; shared_fictive_task_id: string | null }>)
        .filter(row => row.shared_fictive_task_id)
        .map(row => [row.id, row.shared_fictive_task_id as string])
    )
    const rowsWithAudit = rows.map(row => {
      const { shared_fictive_task_id: requestedSharedTaskId, ...legacyRow } = row
      const auditFields = {
        source: row.source ?? 'hrs',
        synced_by: userData.user.id,
        synced_at: new Date().toISOString()
      }
      if (!sharedColumnAvailable) return { ...legacyRow, ...auditFields }
      return {
        ...row,
        shared_fictive_task_id:
          requestedSharedTaskId ?? existingSharedTaskById.get(row.id) ?? null,
        ...auditFields
      }
    })
    const deleteResult = employeeIds.length
      ? await client
          .from('work_reports')
          .delete()
          .eq('source', 'hrs')
          .gte('report_date', startDate)
          .lte('report_date', endDate)
          .in('employee_id', employeeIds)
      : { error: null }
    const error =
      deleteResult.error ??
      (rowsWithAudit.length
        ? (
            await client.from('work_reports').upsert(rowsWithAudit, {
              onConflict: 'id'
            })
          ).error
        : null)

    await client
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: error ? 'error' : 'success',
        error: error?.message ?? null
      })
      .eq('id', (syncRun as { id: string }).id)

    if (error) throw new Error(error.message)
    return {
      synced: rows.length,
      syncRunId: (syncRun as { id: string }).id
    }
  })
}
