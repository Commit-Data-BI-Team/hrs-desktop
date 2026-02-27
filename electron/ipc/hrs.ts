import { BrowserWindow, ipcMain, session, Session } from 'electron'
import dayjs from 'dayjs'
import { clearCustomAuth, getCustomAuth, setCustomAuth } from '../hrs/config'
import { clearHrsCredentials, getHrsCredentials, setHrsCredentials } from '../hrs/credentials'
import {
  validateDate,
  validateExactObject,
  validateNumberRange,
  validateStringLength
} from '../utils/validation'

const HRS_ORIGIN = 'https://hrs.comm-it.co.il'
const ADMIN_KEY_URL = `${HRS_ORIGIN}/admin/reactuserreporting/`
const HRS_CACHE_TTL_MS = 5 * 60 * 1000
const HRS_E2E = process.env.HRS_E2E === '1'
const TIME_HHMM_REGEX = /^(?:[01]?\d|2[0-3]):[0-5]\d$/
const HOURS_HHMM_REGEX = /^\d{1,2}:[0-5]\d$/
const MAX_SAFE_ENTITY_ID = 1_000_000_000

const E2E_TASKS = [
  {
    taskId: 101,
    taskName: 'Design sync',
    customerName: 'Acme Labs',
    projectName: 'Website revamp',
    projectInstance: 'Website revamp',
    reporting_mode: 'FROM_TO',
    commentsRequired: true,
    projectColor: '#6bd1e7',
    isActiveTask: true
  },
  {
    taskId: 102,
    taskName: 'Bug triage',
    customerName: 'Northwind',
    projectName: 'Core platform',
    projectInstance: 'Core platform',
    reporting_mode: 'FROM_TO',
    commentsRequired: true,
    projectColor: '#f0c36b',
    isActiveTask: true
  },
  {
    taskId: 103,
    taskName: 'Reporting',
    customerName: 'Globex',
    projectName: 'Analytics',
    projectInstance: 'Analytics',
    reporting_mode: 'FROM_TO',
    commentsRequired: false,
    projectColor: '#7bd38a',
    isActiveTask: true
  }
]

function minutesToHHMM(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function buildE2EReport(startDate: string, endDate: string) {
  const start = dayjs(startDate)
  const end = dayjs(endDate)
  const days = []
  let totalMinutes = 0
  let cursor = start

  while (cursor.isSame(end, 'day') || cursor.isBefore(end, 'day')) {
    const date = cursor.format('YYYY-MM-DD')
    const weekday = cursor.day()
    const reports = []

    if (weekday !== 0 && weekday !== 6 && cursor.date() % 3 === 0) {
      const task = E2E_TASKS[cursor.date() % E2E_TASKS.length]
      const minutes = 90
      reports.push({
        taskId: task.taskId,
        taskName: task.taskName,
        projectInstance: task.projectInstance,
        hours_HHMM: minutesToHHMM(minutes),
        comment: 'E2E log',
        reporting_from: 'HRS'
      })
      totalMinutes += minutes
    }

    if (cursor.date() === 1) {
      const task = E2E_TASKS[1]
      const minutes = 120
      reports.push({
        taskId: task.taskId,
        taskName: task.taskName,
        projectInstance: task.projectInstance,
        hours_HHMM: minutesToHHMM(minutes),
        comment: 'Kickoff',
        reporting_from: 'HRS'
      })
      totalMinutes += minutes
    }

    days.push({
      date,
      minWorkLog: 0,
      isHoliday: false,
      reports
    })

    cursor = cursor.add(1, 'day')
  }

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10

  return {
    totalHoursNeeded: 160,
    totalHours,
    closed_date: end.format('YYYY-MM-DD'),
    totalDays: days.length,
    days,
    weekend: 'Sat-Sun'
  }
}

const hrsCache = new Map<string, { expiresAt: number; value: unknown }>()

function getCachedValue<T>(key: string): T | null {
  const entry = hrsCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    hrsCache.delete(key)
    return null
  }
  return entry.value as T
}

function setCachedValue(key: string, value: unknown) {
  hrsCache.set(key, { expiresAt: Date.now() + HRS_CACHE_TTL_MS, value })
}

function validateTime(value: unknown, fieldName: string): string {
  const safe = validateStringLength(value, 4, 5)
  if (!TIME_HHMM_REGEX.test(safe)) {
    throw new Error(`Invalid ${fieldName}: expected HH:MM`)
  }
  return safe
}

function validateHoursHHMM(value: unknown): string {
  const safe = validateStringLength(value, 4, 5)
  if (!HOURS_HHMM_REGEX.test(safe)) {
    throw new Error('Invalid hours_HHMM format')
  }
  return safe
}

function validateLogWorkPayload(payload: unknown) {
  const safePayload = validateExactObject<{ date?: unknown; workLogs?: unknown }>(
    payload ?? {},
    ['date', 'workLogs'],
    'log work payload'
  )
  const date = validateDate(safePayload.date)
  if (!Array.isArray(safePayload.workLogs)) {
    throw new Error('Invalid workLogs: expected array')
  }
  if (safePayload.workLogs.length > 200) {
    throw new Error('Too many work logs in one request')
  }
  const workLogs = safePayload.workLogs.map(item => {
    const safeItem = validateExactObject<{
      id?: unknown
      from?: unknown
      to?: unknown
      hours_HHMM?: unknown
      hours?: unknown
      comment?: unknown
      notSaved?: unknown
      reporting_from?: unknown
      taskId?: unknown
    }>(
      item,
      ['id', 'from', 'to', 'hours_HHMM', 'hours', 'comment', 'notSaved', 'reporting_from', 'taskId'],
      'work log item'
    )
    return {
      id: validateNumberRange(safeItem.id, 1, MAX_SAFE_ENTITY_ID, { integer: true }),
      from: validateTime(safeItem.from, 'from'),
      to: validateTime(safeItem.to, 'to'),
      hours_HHMM: validateHoursHHMM(safeItem.hours_HHMM),
      hours: validateNumberRange(safeItem.hours, 0, 24),
      comment: validateStringLength(safeItem.comment, 0, 2000),
      notSaved: typeof safeItem.notSaved === 'boolean' ? safeItem.notSaved : false,
      reporting_from: validateStringLength(safeItem.reporting_from, 1, 100),
      taskId: validateNumberRange(safeItem.taskId, 1, MAX_SAFE_ENTITY_ID, { integer: true })
    }
  })
  return { date, workLogs }
}

function invalidateHrsCache(date?: string) {
  if (!date) {
    hrsCache.clear()
    return
  }
  const normalized = date.trim()
  for (const key of hrsCache.keys()) {
    if (key.startsWith('worklogs:')) {
      if (key === `worklogs:${normalized}`) hrsCache.delete(key)
    } else if (key.startsWith('reports:')) {
      const parts = key.split(':')
      if (parts.length === 3) {
        const start = parts[1]
        const end = parts[2]
        if (normalized >= start && normalized <= end) {
          hrsCache.delete(key)
        }
      }
    }
  }
}

export function registerHrsIpc(
  openLoginWindow: (options?: { username?: string; password?: string; autoSubmit?: boolean }) => Promise<boolean>
) {
  console.log('[ipc] registerHrsIpc')

  if (HRS_E2E) {
    ipcMain.handle('hrs:connectViaAdminLogin', async () => true)
    ipcMain.handle('hrs:getCredentials', async () => ({
      username: 'e2e@hrs.local',
      hasPassword: false
    }))
    ipcMain.handle('hrs:setCredentials', async () => true)
    ipcMain.handle('hrs:clearCredentials', async () => true)
    ipcMain.handle('hrs:autoLogin', async () => true)
    ipcMain.handle('hrs:checkSession', async () => true)
    ipcMain.handle('hrs:getWorkLogs', async () => E2E_TASKS)
    ipcMain.handle('hrs:getReports', async (_event, startDate: string, endDate: string) =>
      buildE2EReport(startDate, endDate)
    )
    ipcMain.handle('hrs:logWork', async () => true)
    ipcMain.handle('hrs:deleteLog', async () => true)
    return
  }

  ipcMain.handle('hrs:connectViaAdminLogin', async () => {
    await openLoginWindow()
    try {
      await ensureCustomAuth(getLoginSession())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[hrs] CustomAuth not available yet:', message)
    }
    return true
  })

  ipcMain.handle('hrs:getCredentials', async () => {
    const creds = await getHrsCredentials()
    return {
      username: creds.username,
      hasPassword: Boolean(creds.password)
    }
  })

  ipcMain.handle('hrs:setCredentials', async (_event, username: string, password: string) => {
    const safeUsername = validateStringLength(username, 1, 200)
    const safePassword = validateStringLength(password, 1, 300)
    await setHrsCredentials(safeUsername, safePassword)
    return true
  })

  ipcMain.handle('hrs:clearCredentials', async () => {
    await clearHrsCredentials()
    return true
  })

  ipcMain.handle('hrs:autoLogin', async () => {
    const creds = await getHrsCredentials()
    if (!creds.username || !creds.password) return false
    try {
      await openLoginWindow({
        username: creds.username,
        password: creds.password,
        autoSubmit: true
      })
      await ensureCustomAuth(getLoginSession())
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('hrs:checkSession', async () => {
    try {
      const loginSession = getLoginSession()
      const cookieHeader = await getCookieHeader(loginSession)
      const targetDate = getLocalIsoDate()
      const res = await fetch(
        `${HRS_ORIGIN}/api/user_work_logs/?date=${encodeURIComponent(targetDate)}`,
        {
          headers: {
            Cookie: cookieHeader,
            Accept: 'application/json'
          }
        }
      )
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearCustomAuth()
          return false
        }
        return false
      }
      void ensureCustomAuth(loginSession).catch(() => {})
      return true
    } catch (err) {
      if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
        return false
      }
      return false
    }
  })

  ipcMain.handle('hrs:getWorkLogs', async (_event, date?: string) => {
    const cookieHeader = await getCookieHeader(getLoginSession())

    const targetDate = date ? validateDate(date) : getLocalIsoDate()
    const cacheKey = `worklogs:${targetDate}`
    const cached = getCachedValue(cacheKey)
    if (cached) return cached
    const res = await fetch(
      `${HRS_ORIGIN}/api/user_work_logs/?date=${encodeURIComponent(targetDate)}`,
      {
        headers: {
          Cookie: cookieHeader,
          Accept: 'application/json'
        }
      }
    )

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearCustomAuth()
        throw new Error('AUTH_REQUIRED')
      }
      throw new Error(`API failed ${res.status}`)
    }

    const payload = await res.json()
    setCachedValue(cacheKey, payload)
    return payload
  })

  ipcMain.handle('hrs:getReports', async (_event, startDate: string, endDate: string) => {
    const safeStartDate = validateDate(startDate)
    const safeEndDate = validateDate(endDate)
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)
    const cacheKey = `reports:${safeStartDate}:${safeEndDate}`
    const cached = getCachedValue(cacheKey)
    if (cached) return cached

    const res = await fetch(
      `${HRS_ORIGIN}/api/getReports/?startDate=${encodeURIComponent(safeStartDate)}&endDate=${encodeURIComponent(safeEndDate)}`,
      {
        headers: {
          Cookie: cookieHeader,
          Accept: 'application/json',
          CustomAuth: customAuth
        }
      }
    )

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearCustomAuth()
        throw new Error('AUTH_REQUIRED')
      }
      throw new Error(`getReports ${res.status}`)
    }

    const payload = await res.json()
    setCachedValue(cacheKey, payload)
    return payload
  })

  ipcMain.handle('hrs:logWork', async (_event, payload: unknown) => {
    const safePayload = validateLogWorkPayload(payload)
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)

    const result = await postLogWork(cookieHeader, customAuth, safePayload)
    invalidateHrsCache(safePayload.date)
    return result
  })

  ipcMain.handle('hrs:deleteLog', async (_event, date: string) => {
    const safeDate = validateDate(date)
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)

    const result = await postLogWork(cookieHeader, customAuth, {
      date: safeDate,
      workLogs: []
    })
    invalidateHrsCache(safeDate)
    return result
  })
}

function getLocalIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMonthRange(date: Date) {
  const startDate = new Date(date.getFullYear(), date.getMonth(), 1)
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { start: formatIsoDate(startDate), end: formatIsoDate(endDate) }
}

function getLoginSession() {
  return session.fromPartition('persist:hrs')
}

async function getCookieHeader(loginSession: Session): Promise<string> {
  const cookies = await loginSession.cookies.get({ domain: 'hrs.comm-it.co.il' })
  if (!cookies.length) {
    throw new Error('AUTH_REQUIRED')
  }
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

async function ensureCustomAuth(loginSession: Session): Promise<string> {
  const existing = getCustomAuth()
  if (existing) return existing

  try {
    const key = await fetchCustomAuth(loginSession)
    setCustomAuth(key)
    return key
  } catch (err) {
    clearCustomAuth()
    throw err instanceof Error ? err : new Error('AUTH_REQUIRED')
  }
}

function extractKeyFromHtmlOrDom(): string | null {
  const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[]
  for (const a of links) {
    const href = a.href || ''
    const idx = href.indexOf('key=')
    if (idx >= 0) {
      const key = new URL(href).searchParams.get('key')
      if (key && key.length > 10) return key
    }
  }

  const text = document.documentElement?.innerHTML || ''
  const m = text.match(/key=([0-9a-f]{20,64})/i)
  if (m?.[1]) return m[1]

  return null
}

async function fetchCustomAuth(loginSession: Session): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        session: loginSession
      }
    })

    let done = false
    let timeoutId: NodeJS.Timeout | null = null

    const fail = (err: unknown) => {
      if (done) return
      done = true
      if (timeoutId) clearTimeout(timeoutId)
      try { win.close() } catch {}
      reject(err instanceof Error ? err : new Error('AUTH_REQUIRED'))
    }
    const succeed = (key: string) => {
      if (done) return
      done = true
      if (timeoutId) clearTimeout(timeoutId)
      try { win.close() } catch {}
      resolve(key)
    }
    timeoutId = setTimeout(() => {
      fail(new Error('AUTH_REQUIRED'))
    }, 20000)

    const tryExtract = async () => {
      try {
        const key = await win.webContents.executeJavaScript(
          `(${extractKeyFromHtmlOrDom.toString()})()`,
          true
        )
        if (key) succeed(key)
      } catch {}
    }

    const onNav = () => {
      void tryExtract()
    }

    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-finish-load', onNav)
    win.webContents.on('did-redirect-navigation', onNav)

    win.loadURL(ADMIN_KEY_URL).catch(fail)
  })
}

async function postLogWork(cookieHeader: string, customAuth: string, payload: unknown) {
  const res = await fetch(`${HRS_ORIGIN}/api/log_work/`, {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      CustomAuth: customAuth
    },
    body: JSON.stringify(payload ?? {})
  })

  if (!res.ok) {
    let details = ''
    try {
      details = await res.text()
    } catch {
      details = ''
    }
    if (res.status === 401 || res.status === 403) {
      clearCustomAuth()
      throw new Error('AUTH_REQUIRED')
    }
    const trimmed = details.trim()
    const suffix = trimmed ? `: ${trimmed.slice(0, 400)}` : ''
    throw new Error(`log_work ${res.status}${suffix}`)
  }

  return true
}
