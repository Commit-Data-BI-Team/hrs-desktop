import { app, BrowserWindow, ipcMain, nativeImage, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHrsIpc } from './ipc/hrs'
import { registerJiraIpc } from './ipc/jira'
import { registerPreferencesIpc } from './ipc/preferences'
import { registerExportIpc } from './ipc/export'
import { registerNotificationIpc } from './ipc/notifications'
import { registerMeetingsIpc } from './ipc/meetings'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
const iconPath = path.join(app.getAppPath(), 'build', 'icon.icns')
const floatingSizes = {
  collapsed: { width: 360, height: 75 },
  expanded: { width: 360, height: 320 }
} as const

function attachRendererLogging(window: BrowserWindow, label: string) {
  const contents = window.webContents
  contents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${label}]`, message, sourceId ? `${sourceId}:${line}` : '')
  })
  contents.on('did-fail-load', (_event, code, desc, url) => {
    console.error(`[main] ${label} failed to load`, code, desc, url)
  })
  contents.on('did-finish-load', () => {
    console.log(`[main] ${label} loaded`, contents.getURL())
  })
  contents.on('dom-ready', async () => {
    try {
      const info = await contents.executeJavaScript(
        `({
          href: location.href,
          hasRoot: Boolean(document.getElementById('root')),
          rootChildren: document.getElementById('root')?.childElementCount ?? -1
        })`,
        true
      )
      console.log(`[main] ${label} dom-ready`, info)
    } catch (error) {
      console.error(`[main] ${label} dom-ready probe failed`, error)
    }
  })
  contents.on('render-process-gone', (_event, details) => {
    console.error(`[main] ${label} renderer gone`, details.reason)
  })
}

function applyDockIcon() {
  if (process.platform !== 'darwin') return
  if (!fs.existsSync(iconPath)) return
  try {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  } catch (error) {
    console.warn('[main] failed to set dock icon', error)
  }
}

function hideMainWindowForFloating() {
  if (!mainWindow) return
  mainWindow.hide()
  mainWindow.setSkipTaskbar(true)
  if (process.platform === 'darwin') {
    app.dock.hide()
  }
}

function restoreMainWindowFromFloating() {
  if (!mainWindow) return
  mainWindow.setSkipTaskbar(false)
  mainWindow.show()
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  if (process.platform === 'darwin') {
    app.dock.show()
  }
}

function getFloatingOptions() {
  return {
    width: floatingSizes.collapsed.width,
    height: floatingSizes.collapsed.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: true,
    frame: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // SECURITY: Same security flags as main window
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      enableRemoteModule: false,
      navigateOnDragDrop: false
    }
  } as const
}

function loadRendererWindow(window: BrowserWindow, isFloating: boolean) {
  const devServerUrl =
    process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173/' : null)
  if (devServerUrl) {
    const baseUrl = devServerUrl.endsWith('/') ? devServerUrl.slice(0, -1) : devServerUrl
    const url = isFloating ? `${baseUrl}?floating=1` : baseUrl
    console.log('[main] loading dev URL', url)
    window.loadURL(url)
    return
  }
  const indexPath = path.join(app.getAppPath(), 'dist-renderer', 'index.html')
  console.log('[main] loading file', indexPath)
  window.loadFile(indexPath, isFloating ? { query: { floating: '1' } } : undefined)
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // SECURITY: Critical security flags
      contextIsolation: true,              // Isolate renderer context from Node.js
      nodeIntegration: false,               // Disable Node.js in renderer
      nodeIntegrationInWorker: false,       // Disable Node.js in web workers
      nodeIntegrationInSubFrames: false,    // Disable Node.js in iframes
      sandbox: true,                        // Enable OS-level sandboxing
      webSecurity: true,                    // Enable same-origin policy
      allowRunningInsecureContent: false,   // Block mixed content (HTTP in HTTPS)
      enableRemoteModule: false,            // Disable dangerous remote module
      safeDialogs: true,                    // Prevent dialog spam attacks
      safeDialogsMessage: 'This app is preventing additional dialogs',
      navigateOnDragDrop: false,            // Prevent drag-and-drop navigation exploits
      disableBlinkFeatures: 'Auxclick'      // Prevent auxiliary click attacks
    }
  })
  
  attachRendererLogging(mainWindow, 'main')
  
  // SECURITY: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigins = [
      'http://localhost',
      'http://127.0.0.1',
      'file://'
    ]
    
    if (!allowedOrigins.some(origin => url.startsWith(origin))) {
      event.preventDefault()
      console.warn('[security] Blocked navigation to external URL:', url)
    }
  })
  
  // SECURITY: Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('[security] Blocked attempt to open new window:', url)
    return { action: 'deny' }
  })
  
  mainWindow.on('show', () => {
    if (floatingWindow) {
      hideMainWindowForFloating()
    }
  })

  console.log('[main] loading UI')
  loadRendererWindow(mainWindow, false)
}

function createFloatingWindow() {
  if (floatingWindow) {
    floatingWindow.focus()
    return
  }
  hideMainWindowForFloating()
  floatingWindow = new BrowserWindow(getFloatingOptions())
  attachRendererLogging(floatingWindow, 'floating')
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  floatingWindow.once('ready-to-show', () => {
    floatingWindow?.show()
    hideMainWindowForFloating()
  })
  floatingWindow.on('show', () => {
    hideMainWindowForFloating()
  })
  floatingWindow.on('focus', () => {
    hideMainWindowForFloating()
  })
  floatingWindow.on('closed', () => {
    floatingWindow = null
    restoreMainWindowFromFloating()
  })
  loadRendererWindow(floatingWindow, true)
}

app.whenReady().then(() => {
  console.log('[main] app ready')
  registerHrsIpc(openLoginWindow)
  registerJiraIpc()
  registerPreferencesIpc()
  registerExportIpc()
  registerNotificationIpc()
  registerMeetingsIpc()
  applyDockIcon()
  ipcMain.handle('app:openFloatingTimer', () => {
    hideMainWindowForFloating()
    createFloatingWindow()
    return true
  })
  ipcMain.handle('app:closeFloatingTimer', () => {
    if (floatingWindow) floatingWindow.close()
    return true
  })
  ipcMain.handle('app:setFloatingCollapsed', (_event, collapsed: boolean) => {
    if (!floatingWindow) return false
    const size = collapsed ? floatingSizes.collapsed : floatingSizes.expanded
    floatingWindow.setSize(size.width, size.height, false)
    return true
  })
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* =========================
   LOGIN FLOW (COOKIE BASED)
   ========================= */

type LoginOptions = {
  username?: string
  password?: string
  autoSubmit?: boolean
}

async function openLoginWindow(options: LoginOptions = {}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const loginSession = session.fromPartition('persist:hrs')

    const { username, password, autoSubmit } = options
    const shouldAutoLogin = Boolean(autoSubmit && username && password)
    const loginWindow = new BrowserWindow({
      width: 900,
      height: 700,
      show: !shouldAutoLogin,
      modal: !shouldAutoLogin,
      parent: mainWindow ?? undefined,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        session: loginSession,
        // SECURITY: Login window needs less strict settings for HRS site compatibility
        contextIsolation: false,  // Required for HRS login page
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })

    console.log('[auth] opening login window')

    let resolved = false
    let autoShowTimer: NodeJS.Timeout | null = null

    const tryAutoLogin = async () => {
      if (!shouldAutoLogin) return
      try {
        await loginWindow.webContents.executeJavaScript(
          `(() => {
            const userInput = document.querySelector('input[name="username"], #id_username');
            const passInput = document.querySelector('input[name="password"], #id_password');
            if (!userInput || !passInput) return false;
            userInput.value = ${JSON.stringify(username ?? '')};
            passInput.value = ${JSON.stringify(password ?? '')};
            const form = userInput.form || document.querySelector('form#login-form') || document.querySelector('form');
            if (form) {
              form.submit();
              return true;
            }
            return false;
          })()`,
          true
        )
      } catch {}
    }

    loginWindow.webContents.on('did-navigate', async (_e, url) => {
      console.log('[auth] navigated:', url)

      if (url.startsWith('https://hrs.comm-it.co.il/admin/')) {
        const cookies = await loginSession.cookies.get({
          domain: 'hrs.comm-it.co.il'
        })

        if (!cookies.find(c => c.name === 'sessionid')) {
          if (autoShowTimer) clearTimeout(autoShowTimer)
          reject(new Error('Session cookie not found'))
          return
        }

        resolved = true
        if (autoShowTimer) clearTimeout(autoShowTimer)
        loginWindow.close()
        resolve(true)
      }
    })

    loginWindow.webContents.on('did-finish-load', () => {
      const url = loginWindow.webContents.getURL()
      if (url.includes('/admin/login/')) {
        void tryAutoLogin()
      }
    })

    if (shouldAutoLogin) {
      autoShowTimer = setTimeout(() => {
        if (!resolved) {
          loginWindow.show()
        }
      }, 12000)
    }

    loginWindow.loadURL(
      'https://hrs.comm-it.co.il/admin/login/?next=/admin/'
    )

    loginWindow.on('closed', () => {
      if (autoShowTimer) clearTimeout(autoShowTimer)
      if (!resolved) {
        reject(new Error('Login cancelled'))
      }
    })
  })
}
