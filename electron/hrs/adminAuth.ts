import { BrowserWindow } from 'electron'

const ORIGIN = 'https://hrs.comm-it.co.il'
const LOGIN_URL = `${ORIGIN}/admin/login/?next=/admin/`
const TARGET_ADMIN_PAGE = `${ORIGIN}/admin/reactuserreporting/`

function extractKeyFromHtmlOrDom(): string | null {
  // Runs inside the page
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

async function scrapeKeyFromCurrentPage(win: BrowserWindow): Promise<string | null> {
  return win.webContents.executeJavaScript(
    `(${extractKeyFromHtmlOrDom.toString()})()`,
    true
  ) as Promise<string | null>
}

async function isLoggedInAdmin(win: BrowserWindow): Promise<boolean> {
  const url = win.webContents.getURL()
  if (url.includes('/admin/login/')) return false
  // If Django redirects to /admin/ after login, this will be true.
  return url.includes('/admin/')
}

export async function openAdminLoginAndFetchKey(): Promise<string> {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    show: true,
    title: 'HRS Login',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  await win.loadURL(LOGIN_URL)

  return new Promise((resolve, reject) => {
    let done = false

    const fail = (err: any) => {
      if (done) return
      done = true
      try { win.close() } catch {}
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const succeed = (key: string) => {
      if (done) return
      done = true
      try { win.close() } catch {}
      resolve(key)
    }

    const onNav = async () => {
      try {
        if (!(await isLoggedInAdmin(win))) return

        // Go to the page that has the key
        if (!win.webContents.getURL().includes('/admin/reactuserreporting/')) {
          await win.loadURL(TARGET_ADMIN_PAGE)
          return
        }

        const key = await scrapeKeyFromCurrentPage(win)
        if (key) {
          succeed(key)
        }
      } catch (e) {
        // Do not immediately fail on transient navigation issues
      }
    }

    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-navigate-in-page', onNav)

    win.on('closed', () => {
      if (!done) fail('Login window closed before key was captured')
    })

    // Optional: devtools for you while building
    // win.webContents.openDevTools({ mode: 'detach' })
  })
}