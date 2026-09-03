import { ipcMain } from 'electron'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import WebSocket from 'ws'
import {
  getSupabaseConfig,
  getSupabaseSession,
  setSupabaseConfig,
  setSupabaseSession
} from '../supabase/config'
import {
  ensureSupabaseConfirmationServer,
  SUPABASE_CONFIRMATION_REDIRECT_URL
} from '../supabase/confirmationServer'

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

type ProjectUsageReportRow = Pick<
  WorkReportRow,
  'employee_id' | 'employee_name' | 'seconds'
>

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
  employees?: unknown
}

type SharedProjectHourBudgetRow = {
  scope_key: string
  customer: string
  project: string
  capped_seconds: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MISSION_STATUSES = new Set<MissionStatus>([
  'todo',
  'in_progress',
  'blocked',
  'done',
  'archived'
])
let cachedSupabaseClient: { configKey: string; promise: Promise<SupabaseClient> } | null = null

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

function normalizeSharedProjectKeyPart(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function getSharedProjectScopeKey(customer: string, project?: string | null) {
  const normalizedCustomer = customer.trim() || 'No customer'
  const normalizedProject = project?.trim() || normalizedCustomer
  return JSON.stringify([
    normalizeSharedProjectKeyPart(normalizedCustomer),
    normalizeSharedProjectKeyPart(normalizedProject)
  ])
}

function normalizeSharedFictiveTask(
  row: SharedFictiveTaskRow,
  projectCappedSeconds: number | null = null
) {
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
    projectCappedHours:
      typeof projectCappedSeconds === 'number' ? projectCappedSeconds / 3600 : null,
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

function isSharedProjectBudgetSchemaMissing(
  error: { code?: string; message?: string } | null | undefined
) {
  const message = error?.message?.toLowerCase() ?? ''
  return error?.code === '42P01' || message.includes('shared_project_hour_budgets')
}

function normalizeUsageEmployees(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const employeeId = cleanNumber(record.employeeId)
      const employeeName = cleanString(record.employeeName, 250)
      const seconds = cleanNumber(record.seconds)
      if (employeeId === null || !employeeName || seconds === null) return null
      return {
        employeeId,
        employeeName,
        seconds: Math.max(0, seconds)
      }
    })
    .filter(
      (
        employee
      ): employee is { employeeId: number; employeeName: string; seconds: number } =>
        Boolean(employee)
    )
    .sort((a, b) => b.seconds - a.seconds || a.employeeName.localeCompare(b.employeeName))
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

async function persistSupabaseAuthSession(
  session: { access_token: string; refresh_token: string; expires_at?: number } | null
) {
  await setSupabaseSession(
    session
      ? {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at
        }
      : null
  )
}

async function createSupabaseClient() {
  const { url, publishableKey } = getSupabaseConfig()
  const configKey = `${url}\u0000${publishableKey}`
  if (cachedSupabaseClient?.configKey === configKey) {
    return cachedSupabaseClient.promise
  }

  const promise = (async () => {
    const client = createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: true
      },
      realtime: {
        transport: WebSocket
      }
    })

    const storedSession = await getSupabaseSession()
    if (storedSession?.access_token && storedSession.refresh_token) {
      let { data, error } = await client.auth.setSession({
        access_token: storedSession.access_token,
        refresh_token: storedSession.refresh_token
      })
      if (error || !data.session) {
        const refreshed = await client.auth.refreshSession({
          refresh_token: storedSession.refresh_token
        })
        data = refreshed.data
        error = refreshed.error
      }
      if (!error && data.session) await persistSupabaseAuthSession(data.session)
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) void persistSupabaseAuthSession(session)
      } else if (event === 'SIGNED_OUT') {
        void persistSupabaseAuthSession(null)
      }
    })
    return client
  })()

  cachedSupabaseClient = { configKey, promise }
  try {
    return await promise
  } catch (error) {
    if (cachedSupabaseClient?.promise === promise) cachedSupabaseClient = null
    throw error
  }
}

function isRefreshableSupabaseAuthError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return (
    message.includes('jwt') ||
    message.includes('token') ||
    message.includes('auth session') ||
    message.includes('not authenticated')
  )
}

async function refreshSupabaseSession(client: SupabaseClient) {
  const { data, error } = await client.auth.refreshSession()
  if (error || !data.session) return false
  await persistSupabaseAuthSession(data.session)
  return true
}

async function getAuthenticatedSupabaseUser(client: SupabaseClient): Promise<User | null> {
  let result = await client.auth.getUser()
  if (result.error && isRefreshableSupabaseAuthError(result.error)) {
    if (await refreshSupabaseSession(client)) result = await client.auth.getUser()
  }
  if (result.error) throw new Error(result.error.message)
  return result.data.user ?? null
}

async function getProfile(client: SupabaseClient): Promise<SupabaseProfile | null> {
  const user = await getAuthenticatedSupabaseUser(client)
  if (!user) return null
  const { data, error } = await client
    .from('profiles')
    .select('id,email,employee_id,display_name,role')
    .eq('id', user.id)
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
  void ensureSupabaseConfirmationServer()

  ipcMain.handle('supabase:getStatus', async () => {
    const config = getSupabaseConfig()
    const client = await createSupabaseClient()
    const user = await getAuthenticatedSupabaseUser(client)
    const profile = user ? await getProfile(client) : null
    return {
      configured: Boolean(config.url && config.publishableKey),
      url: config.url,
      hasPublishableKey: Boolean(config.publishableKey),
      email: user?.email ?? null,
      profile
    }
  })

  ipcMain.handle('supabase:setConfig', async (_event, url: string, publishableKey: string) => {
    const config = setSupabaseConfig(url, publishableKey)
    cachedSupabaseClient = null
    return config
  })

  ipcMain.handle('supabase:signUp', async (_event, email: string, password: string) => {
    const client = await createSupabaseClient()
    const { data, error } = await client.auth.signUp({
      email: cleanString(email, 250),
      password: String(password || ''),
      options: {
        emailRedirectTo: SUPABASE_CONFIRMATION_REDIRECT_URL
      }
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
      email: cleanString(email, 250),
      options: {
        emailRedirectTo: SUPABASE_CONFIRMATION_REDIRECT_URL
      }
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
    const fromDate = validateDate(startDate)
    const toDate = validateDate(endDate)
    const runQuery = () =>
      client
        .from('work_reports')
        .select('*')
        .gte('report_date', fromDate)
        .lte('report_date', toDate)
        .order('report_date', { ascending: true })
        .order('employee_name', { ascending: true })
    let { data, error } = await runQuery()
    if (error && isRefreshableSupabaseAuthError(error) && (await refreshSupabaseSession(client))) {
      const retried = await runQuery()
      data = retried.data
      error = retried.error
    }
    if (error) throw new Error(error.message)
    return (data ?? []) as WorkReportRow[]
  })

  ipcMain.handle('supabase:getProjectUsage', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const customer = cleanString(record.customer, 250)
    const project = cleanString(record.project, 250)
    if (!customer || !project) throw new Error('Customer and project are required')

    const client = await createSupabaseClient()
    const { data, error } = await client
      .from('work_reports')
      .select('employee_id,employee_name,seconds')
      .eq('customer', customer)
      .eq('project', project)
    if (error) throw new Error(error.message)

    const employees = new Map<number, { employeeId: number; employeeName: string; seconds: number }>()
    for (const row of (data ?? []) as ProjectUsageReportRow[]) {
      const current = employees.get(row.employee_id) ?? {
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        seconds: 0
      }
      current.seconds += Math.max(0, Number(row.seconds) || 0)
      employees.set(row.employee_id, current)
    }

    return {
      customer,
      project,
      usedSeconds: Array.from(employees.values()).reduce((sum, employee) => sum + employee.seconds, 0),
      contributorCount: employees.size,
      employees: Array.from(employees.values()).sort(
        (a, b) => b.seconds - a.seconds || a.employeeName.localeCompare(b.employeeName)
      )
    }
  })

  ipcMain.handle('supabase:getSharedFictiveTasks', async () => {
    const client = await createSupabaseClient()
    const user = await getAuthenticatedSupabaseUser(client)
    if (!user) {
      return { available: false, globalHoursAvailable: false, tasks: [] }
    }
    const { data, error } = await client
      .from('shared_fictive_tasks')
      .select('*')
      .is('archived_at', null)
      .order('customer', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      if (isSharedSchemaMissing(error)) {
        return { available: false, globalHoursAvailable: false, tasks: [] }
      }
      throw new Error(error.message)
    }

    const { data: budgetData, error: budgetError } = await client
      .from('shared_project_hour_budgets')
      .select('*')
    const globalHoursAvailable = !budgetError
    if (budgetError && !isSharedProjectBudgetSchemaMissing(budgetError)) {
      throw new Error(budgetError.message)
    }
    const budgetsByScope = new Map(
      ((budgetData ?? []) as SharedProjectHourBudgetRow[]).map(budget => [
        budget.scope_key,
        budget.capped_seconds
      ])
    )
    return {
      available: true,
      globalHoursAvailable,
      tasks: ((data ?? []) as SharedFictiveTaskRow[]).map(task =>
        normalizeSharedFictiveTask(
          task,
          budgetsByScope.get(getSharedProjectScopeKey(task.customer, task.project)) ?? null
        )
      )
    }
  })

  ipcMain.handle('supabase:upsertSharedFictiveTask', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const client = await createSupabaseClient()
    const user = await getAuthenticatedSupabaseUser(client)
    if (!user) throw new Error('Supabase auth required to share a task')
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
    const projectCappedHours = cleanNullableHours(record.projectCappedHours)
    const project = cleanNullableString(record.projectName, 250) ?? customer
    const projectScopeKey = getSharedProjectScopeKey(customer, project)
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

    const { data: existingBudgetData, error: existingBudgetError } = await client
      .from('shared_project_hour_budgets')
      .select('*')
      .eq('scope_key', projectScopeKey)
      .maybeSingle()
    if (existingBudgetError && !isSharedProjectBudgetSchemaMissing(existingBudgetError)) {
      throw new Error(existingBudgetError.message)
    }
    if (existingBudgetError && projectCappedHours !== null) {
      throw new Error(
        'Global project hours are not installed. Apply Supabase migration 003_global_project_hours.sql.'
      )
    }

    let projectBudget = (existingBudgetData as SharedProjectHourBudgetRow | null) ?? null
    if (projectCappedHours !== null && !existingBudgetError) {
      const projectCappedSeconds = Math.round(projectCappedHours * 3600)
      if (
        projectBudget &&
        projectBudget.created_by !== user.id &&
        profile?.role !== 'manager' &&
        projectBudget.capped_seconds !== projectCappedSeconds
      ) {
        throw new Error(
          'Only the employee who created the project budget or a manager can change global project hours.'
        )
      }
      if (!projectBudget || projectBudget.capped_seconds !== projectCappedSeconds) {
        const budgetRow = {
          scope_key: projectScopeKey,
          customer,
          project,
          capped_seconds: projectCappedSeconds,
          created_by: projectBudget?.created_by ?? user.id,
          updated_by: user.id
        }
        const { data: savedBudget, error: saveBudgetError } = await client
          .from('shared_project_hour_budgets')
          .upsert(budgetRow, { onConflict: 'scope_key' })
          .select('*')
          .single()
        if (saveBudgetError) throw new Error(saveBudgetError.message)
        projectBudget = savedBudget as SharedProjectHourBudgetRow
      }
    }

    const existingRow = existing as SharedFictiveTaskRow | null
    if (
      existingRow &&
      existingRow.created_by !== user.id &&
      profile?.role !== 'manager'
    ) {
      return normalizeSharedFictiveTask(existingRow, projectBudget?.capped_seconds ?? null)
    }

    const row = {
      id: existingRow?.id ?? requestedId ?? undefined,
      customer,
      project,
      original_hrs_task_id: originalTaskId,
      original_hrs_task_name: cleanNullableString(record.originalHrsTaskName, 500),
      jira_issue_key: jiraIssueKey,
      name,
      planned_seconds: plannedHours === null ? null : Math.round(plannedHours * 3600),
      capped_seconds: cappedHours === null ? null : Math.round(cappedHours * 3600),
      status: statusValue,
      notes: cleanNullableString(record.notes, 4000),
      assigned_employee_ids: assignedEmployeeIds,
      created_by: existingRow?.created_by ?? user.id,
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
          return normalizeSharedFictiveTask(
            concurrent as SharedFictiveTaskRow,
            projectBudget?.capped_seconds ?? null
          )
        }
      }
      if (isSharedSchemaMissing(error)) {
        throw new Error('Shared tasks database is not installed. Apply Supabase migration 002_shared_fictive_tasks.sql.')
      }
      throw new Error(error.message)
    }
    return normalizeSharedFictiveTask(
      data as SharedFictiveTaskRow,
      projectBudget?.capped_seconds ?? null
    )
  })

  ipcMain.handle('supabase:archiveSharedFictiveTask', async (_event, taskId: unknown) => {
    const id = cleanUuid(taskId, true) as string
    const client = await createSupabaseClient()
    const user = await getAuthenticatedSupabaseUser(client)
    if (!user) throw new Error('Supabase auth required to archive a task')
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
    const user = await getAuthenticatedSupabaseUser(client)
    if (!user) return []
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
      lastReportedAt: row.last_reported_at ?? null,
      employees: normalizeUsageEmployees(row.employees)
    }))
  })

  ipcMain.handle('supabase:syncWorkReports', async (_event, payload: unknown) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const startDate = validateDate(record.startDate)
    const endDate = validateDate(record.endDate)
    const rows = normalizeReportRows(record.rows)
    const requestedEmployeeId = cleanNumber(record.employeeId)
    const client = await createSupabaseClient()
    const user = await getAuthenticatedSupabaseUser(client)
    if (!user) throw new Error('Supabase auth required')
    const profile = await getProfile(client)
    if (!profile?.employee_id) {
      throw new Error('Supabase profile is missing an HRS employee identity')
    }
    if (
      profile.role !== 'manager' &&
      (requestedEmployeeId !== profile.employee_id ||
        rows.some(row => row.employee_id !== profile.employee_id))
    ) {
      throw new Error('Employees may only synchronize their own HRS reports')
    }
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
        synced_by: user.id,
        status: 'running'
      })
      .select('id')
      .single()
    if (syncRunError) throw new Error(syncRunError.message)

    const { data: existingRowsWithSharedTask, error: existingRowsError } = employeeIds.length
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
    let existingRows = existingRowsWithSharedTask as
      | Array<{ id: string; shared_fictive_task_id?: string | null }>
      | null
    if (existingRowsError && isSharedSchemaMissing(existingRowsError)) {
      const legacyResult = employeeIds.length
        ? await client
            .from('work_reports')
            .select('id')
            .eq('source', 'hrs')
            .gte('report_date', startDate)
            .lte('report_date', endDate)
            .in('employee_id', employeeIds)
        : { data: [], error: null }
      if (legacyResult.error) throw new Error(legacyResult.error.message)
      existingRows = legacyResult.data as Array<{ id: string }>
    }
    const existingSharedTaskById = new Map(
      (existingRows ?? [])
        .filter(row => row.shared_fictive_task_id)
        .map(row => [row.id, row.shared_fictive_task_id as string])
    )
    const rowsWithAudit = rows.map(row => {
      const { shared_fictive_task_id: requestedSharedTaskId, ...legacyRow } = row
      const auditFields = {
        source: row.source ?? 'hrs',
        synced_by: user.id,
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
    let error: { message: string } | null = null

    if (rowsWithAudit.length) {
      const upsertResult = await client.from('work_reports').upsert(rowsWithAudit, {
        onConflict: 'id'
      })
      error = upsertResult.error
    }

    if (!error) {
      const incomingIds = new Set(rowsWithAudit.map(row => row.id))
      const staleIds = (existingRows ?? [])
        .map(row => row.id)
        .filter(id => !incomingIds.has(id))

      for (let index = 0; index < staleIds.length && !error; index += 100) {
        const staleBatch = staleIds.slice(index, index + 100)
        const deleteResult = await client
          .from('work_reports')
          .delete()
          .in('id', staleBatch)
        error = deleteResult.error
      }
    }

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
