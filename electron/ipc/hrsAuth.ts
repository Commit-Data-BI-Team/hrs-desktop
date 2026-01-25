import { BrowserView, BrowserWindow, ipcMain, session } from 'electron'
import Store from 'electron-store'

type AuthStore = {
  customAuth: string | null
  cookies: {
    csrftoken?: string
    sessionid?: string
  }
}

const store = new Store<AuthStore>({ name: 'hrs-auth' })

let registered = false
let activeView: BrowserView | null = null
let inflight: Promise<string> | null = null

function getMainWindow(): BrowserWindow {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('No main window')
  return win
}

function attachView(win: BrowserWindow, view: BrowserView) {
  win.setBrowserView(view)
  const [w, h] = win.getSize()

  // Simple layout: full window for login page
  view.setBounds({ x: 0, y: 0, width: w, height: h })
  view.setAutoResize({ width: true, height: true })
}

function detachView(win: BrowserWindow) {
  if (activeView) {
    win.setBrowserView(null)
    try {
      activeView.webContents.close()
    } catch {}
    activeView = null
  }
}

async function readAuthCookies() {
  const cookies = await session.defaultSession.cookies.get({ domain: 'hrs.comm-it.co.il' })
  const csrftoken = cookies.find(c => c.name === 'csrftoken')?.value
  const sessionid = cookies.find(c => c.name === 'sessionid')?.value
  return { csrftoken, sessionid }
}

function extractKey(urlStr: string): string | null {
  try {
    const u = new URL(urlStr)
    return u.searchParams.get('key')
  } catch {
    return null
  }
}

async function startEmbeddedLogin(): Promise<string> {
  const win = getMainWindow()

  if (activeView) detachView(win)

  activeView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  attachView(win, activeView)

  const loginUrl =
    'https://hrs.comm-it.co.il/admin/login/?next=/react/hrs/hoursreporting/'

  await activeView.webContents.loadURL(loginUrl)

  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      try {
        activeView?.webContents.removeAllListeners()
      } catch {}
      detachView(win)
    }

    const onNav = async (_event: any, url: string) => {
      // Successful login usually ends up here
      if (url.includes('/react/hrs/hoursreporting/')) {
        const key = extractKey(url)
        if (!key) {
          cleanup()
          reject(new Error('Login redirect detected but key is missing'))
          return
        }

        const authCookies = await readAuthCookies()
        store.set('customAuth', key)
        store.set('cookies', authCookies)

        cleanup()
        resolve(key)
      }
    }

    activeView!.webContents.on('did-navigate', onNav)
    activeView!.webContents.on('did-redirect-navigation', onNav)

    activeView!.webContents.on('did-fail-load', (_e: any, code: number, desc: string) => {
      cleanup()
      reject(new Error(`Login page failed to load: ${code} ${desc}`))
    })

    activeView!.webContents.on('destroyed', () => {
      cleanup()
      reject(new Error('Login view closed'))
    })
  })
}

export function registerHrsAuthIpc() {
  if (registered) return
  registered = true

  console.log('[ipc] registerHrsAuthIpc')

  ipcMain.handle('hrs:connectViaAdminLogin', async () => {
    if (inflight) return inflight
    inflight = startEmbeddedLogin().finally(() => {
      inflight = null
    })
    return inflight
  })

  ipcMain.handle('hrs:getToken', async () => {
    return store.get('customAuth') ?? null
  })

  ipcMain.handle('hrs:clearToken', async () => {
    store.set('customAuth', null)
    store.set('cookies', {})
    return true
  })
}

export function getSavedAuth() {
  const customAuth = store.get('customAuth') ?? null
  const cookies = store.get('cookies') ?? {}
  return { customAuth, cookies }
}