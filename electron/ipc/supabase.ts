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
  source: string
  synced_at?: string
}

type WorkReportInput = Omit<WorkReportRow, 'source' | 'synced_at'> & {
  source?: string
}

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

    const rowsWithAudit = rows.map(row => ({
      ...row,
      source: row.source ?? 'hrs',
      synced_by: userData.user.id,
      synced_at: new Date().toISOString()
    }))
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
