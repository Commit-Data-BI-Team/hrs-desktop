import { BrowserWindow, ipcMain, session, Session } from 'electron'
import { clearCustomAuth, getCustomAuth, setCustomAuth } from '../hrs/config'
import { clearHrsCredentials, getHrsCredentials, setHrsCredentials } from '../hrs/credentials'

const HRS_ORIGIN = 'https://hrs.comm-it.co.il'
const ADMIN_KEY_URL = `${HRS_ORIGIN}/admin/reactuserreporting/`
const HRS_CACHE_TTL_MS = 5 * 60 * 1000

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

  ipcMain.handle('hrs:connectViaAdminLogin', async () => {
    await openLoginWindow()
    try {
      await ensureCustomAuth(getLoginSession())
    } catch (err) {
      console.warn('[hrs] CustomAuth not available yet:', err)
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
    await setHrsCredentials(username, password)
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

    const targetDate = (date && date.trim()) || getLocalIsoDate()
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
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)
    const cacheKey = `reports:${startDate}:${endDate}`
    const cached = getCachedValue(cacheKey)
    if (cached) return cached

    const res = await fetch(
      `${HRS_ORIGIN}/api/getReports/?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
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
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)

    const result = await postLogWork(cookieHeader, customAuth, payload)
    if (payload && typeof payload === 'object' && 'date' in payload) {
      const dateValue = (payload as { date?: string }).date
      invalidateHrsCache(dateValue)
    } else {
      invalidateHrsCache()
    }
    return result
  })

  ipcMain.handle('hrs:deleteLog', async (_event, date: string) => {
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)

    const result = await postLogWork(cookieHeader, customAuth, {
      date,
      workLogs: []
    })
    invalidateHrsCache(date)
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
