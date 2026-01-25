import { BrowserWindow } from 'electron'
import { getCustomAuth } from './config'

let hrsWin: BrowserWindow | null = null

function getHrsUrl(): string {
  const token = getCustomAuth()
  if (!token) throw new Error('Missing CustomAuth token')
  return `https://hrs.comm-it.co.il/react/hrs/hoursreporting/?key=${encodeURIComponent(token)}`
}

export async function ensureHrsSessionWindow(): Promise<BrowserWindow> {
  if (hrsWin && !hrsWin.isDestroyed()) return hrsWin

  hrsWin = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  await hrsWin.loadURL(getHrsUrl())

  hrsWin.on('closed', () => {
    hrsWin = null
  })

  return hrsWin
}

export async function execInHrs<T>(js: string): Promise<T> {
  const win = await ensureHrsSessionWindow()
  return win.webContents.executeJavaScript(js, true) as Promise<T>
}

// optional troubleshooting only
export async function openHrsWebForDebug(): Promise<void> {
  const win = await ensureHrsSessionWindow()
  win.show()
  win.focus()
  win.webContents.openDevTools({ mode: 'detach' })
}