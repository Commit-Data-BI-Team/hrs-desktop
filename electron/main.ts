import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  session,
  Tray,
  Menu,
  screen,
  type BrowserWindowConstructorOptions
} from 'electron'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { registerHrsIpc } from './ipc/hrs'
import { registerJiraIpc } from './ipc/jira'
import { registerPreferencesIpc } from './ipc/preferences'
import { registerExportIpc } from './ipc/export'
import { registerNotificationIpc } from './ipc/notifications'
import { registerMeetingsIpc } from './ipc/meetings'
import { registerAgendaIpc } from './ipc/agenda'
import { registerProjectManagementIpc } from './ipc/projectManagement'
import { registerSupabaseIpc } from './ipc/supabase'
import { registerSlackIpc } from './ipc/slack'
import {
  getPreferences,
  migrateHrsCredentialFlowPreferences,
  setPreferences
} from './app/preferences'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

type LiquidGlassModule = {
  isGlassSupported?: () => boolean
  addView?: (handle: Buffer, options?: Record<string, unknown>) => number
  unstable_setVariant?: (viewId: number, variant: number) => void
}

let liquidGlassModule: LiquidGlassModule | null | undefined

function getLiquidGlassModule() {
  if (liquidGlassModule !== undefined) return liquidGlassModule
  try {
    const loaded = nodeRequire('electron-liquid-glass') as
      | LiquidGlassModule
      | { default?: LiquidGlassModule }
    liquidGlassModule = ('default' in loaded ? loaded.default : loaded) ?? null
  } catch (error) {
    liquidGlassModule = null
    logWarn('[native liquid glass] module unavailable', error)
  }
  return liquidGlassModule
}

let mainWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
let trayWindow: BrowserWindow | null = null
let reportsWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let meetingsWindow: BrowserWindow | null = null
let activeLoginWindow: BrowserWindow | null = null
let activeLoginPromise: Promise<boolean> | null = null
let tray: Tray | null = null
let trayOpenOnReady = false
let traySuppressBlurUntil = 0
let trayHideTimer: NodeJS.Timeout | null = null
let trayPinned = false
let isQuitting = false
let openMainRequested = false
const processBootAt = Date.now()
const startInTray = true
const iconPath = path.join(app.getAppPath(), 'build', 'icon.icns')
const trayIconCandidates = {
  macTemplate: [
    path.join(process.resourcesPath, 'build', 'tray-icon-macTemplate.png'),
    path.join(process.resourcesPath, 'tray-icon-macTemplate.png'),
    path.join(app.getAppPath(), 'build', 'tray-icon-macTemplate.png')
  ],
  win: [
    path.join(process.resourcesPath, 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.ico')
  ],
  png: [
    path.join(process.resourcesPath, 'build', 'tray-icon.png'),
    path.join(process.resourcesPath, 'tray-icon.png'),
    path.join(process.resourcesPath, 'build', 'icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png')
  ]
}
const floatingSizes = {
  collapsed: { width: 360, height: 75 },
  expanded: { width: 360, height: 320 }
} as const
const trayWindowSize = { width: 430, height: 660 }
const TRAY_WINDOW_MIN_HEIGHT = 180
const TRAY_WINDOW_SCREEN_MARGIN = 8
const reportsWindowSize = { width: 1220, height: 860 }
const settingsWindowSize = { width: 700, height: 780 }
const meetingsWindowSize = { width: 1220, height: 860 }
const MAIN_LOG_MAX_BYTES = 2 * 1024 * 1024
const MAIN_LOG_ROTATIONS = 4
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_GITHUB_UPDATE_OWNER = 'Commit-Data-BI-Team'
const DEFAULT_GITHUB_UPDATE_REPO = 'hrs-desktop'
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  isQuitting = true
  app.quit()
} else {
  app.on('second-instance', () => {
    if (trayWindow && !trayWindow.isDestroyed()) {
      showTrayWindow()
      return
    }
    trayOpenOnReady = true
    createTrayWindow()
  })
}

type AppUpdateState = {
  state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  message?: string
  version?: string
  currentVersion?: string
  releaseDate?: string
  changelog?: string[]
  percent?: number
}

type UpdaterLike = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL: (options: Record<string, unknown>) => void
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

type ThemeMode = 'dark' | 'oled' | 'liquid' | 'h4c37'
type TrayCloseReason = 'blur' | 'toggle' | 'open-main' | 'dismiss'

let updateCheckTimer: NodeJS.Timeout | null = null
let updaterConfigured = false
let latestUpdateState: AppUpdateState = { state: 'idle', currentVersion: app.getVersion() }
let appUpdater: UpdaterLike | null = null
let nativeThemeMode: ThemeMode = 'dark'
const nativeLiquidGlassViewIds = new Map<number, number>()
const macNativeGlassWindowOptions: Partial<BrowserWindowConstructorOptions> =
  process.platform === 'darwin'
    ? ({
        transparent: true,
        vibrancy: false,
        backgroundColor: '#00000000'
      } as Partial<BrowserWindowConstructorOptions>)
    : {}

function configureMacNativeGlassWindow(window: BrowserWindow, options: { windowButtons?: boolean } = {}) {
  if (process.platform !== 'darwin') return
  try {
    window.setBackgroundColor('#00000000')
    window.setWindowButtonVisibility(Boolean(options.windowButtons))
  } catch (error) {
    logWarn('[native liquid glass] failed to configure transparent window', error)
  }
}

function enforceWindowedMode(window: BrowserWindow) {
  const leaveProhibitedMode = () => {
    setImmediate(() => {
      if (window.isDestroyed()) return
      if (window.isFullScreen()) window.setFullScreen(false)
      if (window.isMaximized()) window.unmaximize()
    })
  }
  try {
    window.setFullScreenable(false)
    window.setMaximizable(false)
  } catch (error) {
    logWarn('[window] could not disable fullscreen/maximize', error)
  }
  window.on('enter-full-screen', leaveProhibitedMode)
  window.on('maximize', leaveProhibitedMode)
}

function fitWindowSizeToDisplay(width: number, height: number, margin = 32) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const maxWidth = Math.max(480, display.workArea.width - margin * 2)
  const maxHeight = Math.max(420, display.workArea.height - margin * 2)
  return {
    width: Math.min(width, maxWidth),
    height: Math.min(height, maxHeight)
  }
}

function normalizeChangelog(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    const decodeHtmlEntities = (value: string) =>
      value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
        const normalized = entity.toLowerCase()
        if (normalized === 'amp') return '&'
        if (normalized === 'lt') return '<'
        if (normalized === 'gt') return '>'
        if (normalized === 'quot') return '"'
        if (normalized === 'apos') return "'"
        if (normalized === 'nbsp') return ' '
        const radix = normalized.startsWith('#x') ? 16 : 10
        const numericValue = Number.parseInt(normalized.replace(/^#x?/, ''), radix)
        return Number.isFinite(numericValue) ? String.fromCodePoint(numericValue) : match
      })

    const plainText = decodeHtmlEntities(raw)
      .replace(/<\s*h[1-6]\b[^>]*>/gi, '\n# ')
      .replace(/<\s*li\b[^>]*>/gi, '\n- ')
      .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')

    return decodeHtmlEntities(plainText)
      .split(/\r?\n/)
      .map(line =>
        line
          .trim()
          .replace(/^[-*+]\s+/, '')
          .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\s+/g, ' ')
      )
      .filter(line => Boolean(line) && !/^#{1,6}\s+/.test(line))
      .filter((line, index, lines) => lines.indexOf(line) === index)
      .slice(0, 12)
  }
  if (Array.isArray(raw)) {
    const collected = raw
      .map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const typed = item as { note?: unknown; version?: unknown }
          if (typeof typed.note === 'string') return typed.note
          if (typeof typed.version === 'string') return `Release ${typed.version}`
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
    return normalizeChangelog(collected)
  }
  return []
}

function formatUpdaterError(error: unknown): string {
  const raw = error instanceof Error ? error.message || String(error) : String(error)
  const compact = raw.replace(/\s+/g, ' ').trim()
  const withoutHeaders = compact.split(/\bHeaders:\b/i)[0]?.trim() ?? compact
  const redacted = redactLogText(withoutHeaders)

  if (/releases\.atom/i.test(redacted) && /\b404\b/.test(redacted)) {
    return 'Update feed returned 404. Repository is likely private or no public release feed is available.'
  }
  if (/authentication token is correct/i.test(redacted) || /unauthorized|forbidden/i.test(redacted)) {
    return 'Update feed requires authentication. Configure a public update feed for end users.'
  }

  return redacted.length > 260 ? `${redacted.slice(0, 257)}...` : redacted
}

function emitUpdateState(next: AppUpdateState) {
  const normalized: AppUpdateState = {
    ...next,
    currentVersion: app.getVersion()
  }
  latestUpdateState = normalized
  const targets = [mainWindow, trayWindow, reportsWindow, settingsWindow, meetingsWindow, floatingWindow]
  for (const target of targets) {
    if (!target || target.isDestroyed()) continue
    target.webContents.send('app:updateState', normalized)
  }
}

function setUpdateDisabled(message: string) {
  updaterConfigured = false
  emitUpdateState({ state: 'disabled', message })
}

async function checkForUpdatesNow() {
  if (!updaterConfigured || !appUpdater) {
    if (latestUpdateState.state !== 'disabled') {
      setUpdateDisabled('Updates are not configured for this build.')
    }
    return null
  }
  try {
    emitUpdateState({ state: 'checking' })
    return await appUpdater.checkForUpdates()
  } catch (error) {
    const message = formatUpdaterError(error)
    logError('[updater] check failed', error)
    emitUpdateState({ state: 'error', message })
    return null
  }
}

async function ensureUpdaterLoaded() {
  if (appUpdater) return true
  const loadErrors: string[] = []
  const tryAttachUpdater = (mod: unknown): boolean => {
    const candidate = mod as
      | UpdaterLike
      | { autoUpdater?: UpdaterLike; default?: UpdaterLike | { autoUpdater?: UpdaterLike } }
      | null
      | undefined
    const updater =
      candidate && typeof candidate === 'object'
        ? candidate.autoUpdater ||
          (candidate.default && typeof candidate.default === 'object'
            ? (candidate.default as { autoUpdater?: UpdaterLike }).autoUpdater
            : undefined) ||
          ((candidate.default as UpdaterLike | undefined) ?? undefined)
        : undefined
    if (!updater || typeof updater.checkForUpdates !== 'function') return false
    appUpdater = updater
    return true
  }

  try {
    const required = nodeRequire('electron-updater')
    if (tryAttachUpdater(required)) return true
    loadErrors.push('require() succeeded but no autoUpdater export found')
  } catch (error) {
    loadErrors.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const imported = await import('electron-updater')
    if (tryAttachUpdater(imported)) return true
    loadErrors.push('import() succeeded but no autoUpdater export found')
  } catch (error) {
    loadErrors.push(error instanceof Error ? error.message : String(error))
  }

  const message = loadErrors.join(' | ')
  logWarn('[updater] module not available', message)
  setUpdateDisabled('Updater package missing or invalid export in this build.')
  return false
}

async function setupAutoUpdater() {
  if (!app.isPackaged) {
    setUpdateDisabled('Auto-update works in packaged builds only.')
    return
  }
  const hasUpdater = await ensureUpdaterLoaded()
  if (!hasUpdater || !appUpdater) return

  const feedUrl = process.env.HRS_UPDATE_FEED_URL?.trim()
  try {
    if (feedUrl) {
      appUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
      updaterConfigured = true
      logInfo('[updater] using feed URL from HRS_UPDATE_FEED_URL')
    } else {
      const defaultConfigPath = path.join(process.resourcesPath, 'app-update.yml')
      if (fs.existsSync(defaultConfigPath)) {
        updaterConfigured = true
      } else {
        // Fallback: if packaged app lacks app-update.yml, use publish config from package.json.
        try {
          const packageJsonPath = path.join(app.getAppPath(), 'package.json')
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            build?: { publish?: Array<Record<string, unknown>> | Record<string, unknown> }
          }
          const publishRaw = pkg.build?.publish
          const publishList = Array.isArray(publishRaw)
            ? publishRaw
            : publishRaw
              ? [publishRaw]
              : []
          const first = publishList[0] ?? null
          const provider =
            first && typeof first.provider === 'string' ? first.provider.toLowerCase() : null
          if (provider === 'github') {
            const owner = typeof first.owner === 'string' ? first.owner : ''
            const repo = typeof first.repo === 'string' ? first.repo : ''
            if (owner && repo) {
              appUpdater.setFeedURL({ provider: 'github', owner, repo })
              updaterConfigured = true
              logInfo('[updater] using GitHub publish config fallback', `${owner}/${repo}`)
            }
          } else if (provider === 'generic') {
            const url = typeof first.url === 'string' ? first.url.trim() : ''
            if (url) {
              appUpdater.setFeedURL({ provider: 'generic', url })
              updaterConfigured = true
              logInfo('[updater] using generic publish config fallback')
            }
          }
        } catch (error) {
          logWarn('[updater] failed to read package publish config fallback', error)
        }
      }
      if (!updaterConfigured) {
        // Final fallback for this app: fixed GitHub repository updater feed.
        appUpdater.setFeedURL({
          provider: 'github',
          owner: DEFAULT_GITHUB_UPDATE_OWNER,
          repo: DEFAULT_GITHUB_UPDATE_REPO
        })
        updaterConfigured = true
        logInfo(
          '[updater] using hardcoded GitHub fallback',
          `${DEFAULT_GITHUB_UPDATE_OWNER}/${DEFAULT_GITHUB_UPDATE_REPO}`
        )
      }
    }
  } catch (error) {
    const message = formatUpdaterError(error)
    logError('[updater] failed to configure updater', message)
    setUpdateDisabled(message)
    return
  }

  appUpdater.autoDownload = false
  appUpdater.autoInstallOnAppQuit = true

  appUpdater.on('checking-for-update', () => {
    emitUpdateState({ state: 'checking' })
  })
  appUpdater.on('update-available', (info: unknown) => {
    const typed = info as { version?: string; releaseDate?: string | Date; releaseNotes?: unknown }
    emitUpdateState({
      state: 'available',
      version: typed.version,
      releaseDate: typed.releaseDate ? String(typed.releaseDate) : undefined,
      changelog: normalizeChangelog(typed.releaseNotes)
    })
  })
  appUpdater.on('update-not-available', () => {
    emitUpdateState({ state: 'idle', message: 'You are up to date.' })
  })
  appUpdater.on('download-progress', (progress: unknown) => {
    const typed = progress as { percent?: number }
    const percent = typed.percent ?? 0
    emitUpdateState({
      state: 'downloading',
      percent,
      message: `${Math.round(percent)}% downloaded`
    })
  })
  appUpdater.on('update-downloaded', (info: unknown) => {
    const typed = info as { version?: string; releaseDate?: string | Date; releaseNotes?: unknown }
    emitUpdateState({
      state: 'ready',
      version: typed.version,
      releaseDate: typed.releaseDate ? String(typed.releaseDate) : undefined,
      changelog: normalizeChangelog(typed.releaseNotes),
      message: 'Update ready. Restart to install.'
    })
  })
  appUpdater.on('error', error => {
    const message = formatUpdaterError(error)
    logError('[updater] runtime error', error)
    emitUpdateState({ state: 'error', message })
  })

  emitUpdateState({ state: 'idle', message: 'Ready to check for updates.' })
  setTimeout(() => {
    void checkForUpdatesNow()
  }, 15000)
  updateCheckTimer = setInterval(() => {
    void checkForUpdatesNow()
  }, UPDATE_CHECK_INTERVAL_MS)
}

function getMainLogPaths(): string[] {
  const paths = new Set<string>()
  paths.add(path.join(app.getPath('temp'), 'hrs-desktop-main.log'))
  try {
    paths.add(path.join(app.getPath('userData'), 'logs', 'main.log'))
  } catch {}
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    paths.add(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'logs', 'main.log'))
  }
  return Array.from(paths)
}

function rotateLogFileIfNeeded(logPath: string) {
  try {
    const stat = fs.statSync(logPath)
    if (stat.size < MAIN_LOG_MAX_BYTES) return
  } catch {
    return
  }

  for (let index = MAIN_LOG_ROTATIONS; index >= 1; index -= 1) {
    const src = `${logPath}.${index}`
    const dest = `${logPath}.${index + 1}`
    try {
      if (index === MAIN_LOG_ROTATIONS) {
        fs.rmSync(src, { force: true })
      } else if (fs.existsSync(src)) {
        fs.renameSync(src, dest)
      }
    } catch {}
  }

  try {
    if (fs.existsSync(logPath)) {
      fs.renameSync(logPath, `${logPath}.1`)
    }
  } catch {}
}

function redactLogText(input: string): string {
  let text = input

  // Redact credentials and auth-like key/value pairs.
  text = text.replace(
    /("?(?:authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|password|passwd|secret|customauth|sessionid|csrftoken)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    '$1[REDACTED]'
  )

  // Redact bearer tokens.
  text = text.replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [REDACTED]')

  // Redact sensitive query parameters.
  text = text.replace(
    /([?&](?:token|password|passwd|auth|authorization|cookie|session|apikey|api_key|customauth)=)[^&\s]+/gi,
    '$1[REDACTED]'
  )

  return text
}

function writeMainLog(level: 'INFO' | 'WARN' | 'ERROR', ...parts: unknown[]) {
  const timestamp = new Date().toISOString()
  const raw = parts
    .map(part =>
      typeof part === 'string'
        ? part
        : util.inspect(part, { depth: 4, breakLength: 120, compact: true })
    )
    .join(' ')
  const line = `[${timestamp}] [${level}] ${redactLogText(raw)}`
  for (const logPath of getMainLogPaths()) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      rotateLogFileIfNeeded(logPath)
      fs.appendFileSync(logPath, `${line}\n`)
    } catch {}
  }
}

function logInfo(...parts: unknown[]) {
  writeMainLog('INFO', ...parts)
  const safeLine = redactLogText(
    parts
      .map(part =>
        typeof part === 'string'
          ? part
          : util.inspect(part, { depth: 4, breakLength: 120, compact: true })
      )
      .join(' ')
  )
  console.log(safeLine)
}

function logWarn(...parts: unknown[]) {
  writeMainLog('WARN', ...parts)
  const safeLine = redactLogText(
    parts
      .map(part =>
        typeof part === 'string'
          ? part
          : util.inspect(part, { depth: 4, breakLength: 120, compact: true })
      )
      .join(' ')
  )
  console.warn(safeLine)
}

function logError(...parts: unknown[]) {
  writeMainLog('ERROR', ...parts)
  const safeLine = redactLogText(
    parts
      .map(part =>
        typeof part === 'string'
          ? part
          : util.inspect(part, { depth: 4, breakLength: 120, compact: true })
      )
      .join(' ')
  )
  console.error(safeLine)
}

function applyNativeLiquidGlassToWindow(window: BrowserWindow | null, label: string) {
  if (process.platform !== 'darwin' || !window || window.isDestroyed()) return false
  if (nativeThemeMode !== 'liquid') return false
  return false

  const contentsId = window.webContents.id
  const existing = nativeLiquidGlassViewIds.get(contentsId)
  if (existing !== undefined) return existing >= 0

  try {
    const liquidGlass = getLiquidGlassModule()
    if (!liquidGlass?.addView) return false
    const viewId = liquidGlass.addView(window.getNativeWindowHandle(), {
      cornerRadius: 34,
      tintColor: '#FFFFFF00',
      opaque: false
    })
    nativeLiquidGlassViewIds.set(contentsId, viewId)

    if (typeof viewId === 'number' && viewId >= 0) {
      liquidGlass.unstable_setVariant?.(viewId, 19)
    }

    logInfo(
      '[native liquid glass] applied',
      `label=${label}`,
      `view=${viewId}`,
      'variant=19',
      'cornerRadius=34',
      'opaque=false'
    )
    return viewId >= 0
  } catch (error) {
    nativeLiquidGlassViewIds.set(contentsId, -1)
    logWarn('[native liquid glass] apply failed', `label=${label}`, error)
    return false
  }
}

function applyNativeLiquidGlassToAllWindows() {
  applyNativeLiquidGlassToWindow(mainWindow, 'main')
  applyNativeLiquidGlassToWindow(floatingWindow, 'floating')
  applyNativeLiquidGlassToWindow(trayWindow, 'tray')
  applyNativeLiquidGlassToWindow(reportsWindow, 'reports')
  applyNativeLiquidGlassToWindow(settingsWindow, 'settings')
  applyNativeLiquidGlassToWindow(meetingsWindow, 'meetings')
}

function forgetNativeLiquidGlassForWindow(window: BrowserWindow | null) {
  if (!window || window.isDestroyed()) return
  try {
    nativeLiquidGlassViewIds.delete(window.webContents.id)
  } catch {}
}

process.on('uncaughtException', error => {
  logError('[process] uncaughtException', error)
})

process.on('unhandledRejection', reason => {
  logError('[process] unhandledRejection', reason)
})

function attachRendererLogging(window: BrowserWindow, label: string) {
  const contents = window.webContents
  contents.on('console-message', (_event, level, message, line, sourceId) => {
    logInfo(`[renderer:${label}]`, `L${level}`, message, sourceId ? `${sourceId}:${line}` : '')
  })
  contents.on('did-fail-load', (_event, code, desc, url) => {
    logError(`[main] ${label} failed to load`, code, desc, url)
  })
  contents.on('did-finish-load', () => {
    logInfo(`[main] ${label} loaded`, contents.getURL())
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
      logInfo(`[main] ${label} dom-ready`, info)
    } catch (error) {
      logError(`[main] ${label} dom-ready probe failed`, error)
    }
  })
  contents.on('render-process-gone', (_event, details) => {
    logError(`[main] ${label} renderer gone`, details.reason)
  })
}

function applyDockIcon() {
  if (process.platform !== 'darwin') return
  if (!fs.existsSync(iconPath)) return
  try {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  } catch (error) {
    logWarn('[main] failed to set dock icon', error)
  }
}

function applyTrayOnlyMode() {
  if (process.platform !== 'darwin') return
  try {
    app.setActivationPolicy('accessory')
  } catch (error) {
    logWarn('[main] failed to set accessory activation policy', error)
  }
  try {
    app.dock.hide()
  } catch (error) {
    logWarn('[main] failed to hide dock', error)
  }
}

function getTrayIcon() {
  const fallback = nativeImage.createEmpty()
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const macTemplatePath = trayIconCandidates.macTemplate.find(candidate => fs.existsSync(candidate))
  const winPath = trayIconCandidates.win.find(candidate => fs.existsSync(candidate))
  const pngPath = trayIconCandidates.png.find(candidate => fs.existsSync(candidate))
  if (isMac && macTemplatePath) {
    const templateImage = nativeImage.createFromPath(macTemplatePath)
    if (!templateImage.isEmpty()) {
      templateImage.setTemplateImage(true)
      return templateImage
    }
  }
  const iconPath = pngPath ?? winPath
  let base = iconPath ? nativeImage.createFromPath(iconPath) : null
  if (!base || base.isEmpty()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect x="1" y="2" width="14" height="13" rx="3" fill="#1f7a8c"/>
      <rect x="1" y="2" width="14" height="4" rx="2" fill="#49c2d0"/>
      <rect x="4" y="8" width="3" height="3" rx="1" fill="#0b1a20"/>
      <rect x="9" y="8" width="3" height="3" rx="1" fill="#0b1a20"/>
    </svg>`
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    base = nativeImage.createFromDataURL(dataUrl)
  }
  if (base.isEmpty()) return fallback
  if (isWin && winPath && !pngPath) {
    const test = nativeImage.createFromPath(winPath)
    if (!test.isEmpty()) {
      return winPath
    }
  }
  const size = isWin ? 16 : 18
  const image = base.resize({ width: size, height: size })
  if (isMac) image.setTemplateImage(true)
  return image
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
  if (process.platform === 'win32') return
  mainWindow.setSkipTaskbar(true)
  mainWindow.show()
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
}

function hideMainWindowToTray() {
  if (!mainWindow) return
  mainWindow.hide()
  mainWindow.setSkipTaskbar(true)
  if (process.platform === 'darwin') {
    app.dock.hide()
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(false)
    return
  }
  openMainRequested = true
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  mainWindow.setSkipTaskbar(true)
  mainWindow.show()
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.focus()
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
    ...macNativeGlassWindowOptions,
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

function loadRendererWindow(
  window: BrowserWindow,
  mode: 'main' | 'floating' | 'tray' | 'reports' | 'settings' | 'meetings'
) {
  window.webContents.once('did-finish-load', () => {
    applyNativeLiquidGlassToWindow(window, mode)
  })
  const useFile =
    app.isPackaged || process.env.E2E_USE_FILE === '1' || process.env.HRS_E2E === '1'
  const devServerUrl = !useFile
    ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173/'
    : null
  const query =
    mode === 'floating'
      ? { floating: '1' }
      : mode === 'tray'
        ? { tray: '1' }
        : mode === 'reports'
          ? { reports: '1' }
          : mode === 'settings'
            ? { settings: '1' }
            : mode === 'meetings'
              ? { meetings: '1' }
            : null
  if (devServerUrl) {
    const baseUrl = devServerUrl.endsWith('/') ? devServerUrl.slice(0, -1) : devServerUrl
    const url = query ? `${baseUrl}?${new URLSearchParams(query).toString()}` : baseUrl
    logInfo('[main] loading dev URL', url)
    window.loadURL(url)
    return
  }
  const indexPath = path.join(app.getAppPath(), 'dist-renderer', 'index.html')
  logInfo('[main] loading file', indexPath)
  window.loadFile(indexPath, query ? { query } : undefined)
}

function createMainWindow(startHidden = false) {
  const fittedSize = fitWindowSizeToDisplay(1200, 800)
  mainWindow = new BrowserWindow({
    width: fittedSize.width,
    height: fittedSize.height,
    center: true,
    fullscreen: false,
    fullscreenable: false,
    maximizable: false,
    show: !startHidden,
    skipTaskbar: true,
    ...macNativeGlassWindowOptions,
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
  enforceWindowedMode(mainWindow)
  configureMacNativeGlassWindow(mainWindow, { windowButtons: true })
  
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
      logWarn('[security] blocked navigation to external URL', url)
    }
  })
  
  // SECURITY: Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logWarn('[security] blocked attempt to open new window', url)
    return { action: 'deny' }
  })
  
  mainWindow.on('show', () => {
    if (floatingWindow) {
      hideMainWindowForFloating()
    }
  })

  mainWindow.on('close', event => {
    if (isQuitting || !tray) return
    event.preventDefault()
    hideMainWindowToTray()
  })

  mainWindow.on('closed', () => {
    forgetNativeLiquidGlassForWindow(mainWindow)
    mainWindow = null
  })

  if (startHidden) {
    mainWindow.once('ready-to-show', () => {
      if (openMainRequested || !tray) {
        showMainWindow()
      } else {
        hideMainWindowToTray()
      }
    })
  }

  console.log('[main] loading UI')
  loadRendererWindow(mainWindow, 'main')
}

function createFloatingWindow() {
  if (floatingWindow) {
    floatingWindow.focus()
    return
  }
  hideMainWindowForFloating()
  floatingWindow = new BrowserWindow(getFloatingOptions())
  enforceWindowedMode(floatingWindow)
  configureMacNativeGlassWindow(floatingWindow)
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
    forgetNativeLiquidGlassForWindow(floatingWindow)
    floatingWindow = null
    restoreMainWindowFromFloating()
  })
  loadRendererWindow(floatingWindow, 'floating')
}

function createTrayWindow() {
  if (trayWindow) return
  trayWindow = new BrowserWindow({
    width: trayWindowSize.width,
    height: trayWindowSize.height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: process.platform === 'darwin',
    show: false,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#0e151b',
    hasShadow: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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
  })
  enforceWindowedMode(trayWindow)
  configureMacNativeGlassWindow(trayWindow)
  applyTrayPinnedWindowBehavior()
  attachRendererLogging(trayWindow, 'tray')
  trayWindow.once('ready-to-show', () => {
    if (!trayOpenOnReady) return
    trayOpenOnReady = false
    showTrayWindow()
  })
  trayWindow.on('blur', () => {
    const blurAt = Date.now()
    if (blurAt < traySuppressBlurUntil) {
      const waitMs = Math.max(0, traySuppressBlurUntil - blurAt) + 16
      setTimeout(() => {
        if (!trayWindow || !trayWindow.isVisible()) return
        if (!trayWindow.isFocused()) {
          beginHideTrayWindow('blur')
        }
      }, waitMs)
      return
    }
    beginHideTrayWindow('blur')
  })
  trayWindow.on('closed', () => {
    forgetNativeLiquidGlassForWindow(trayWindow)
    if (trayHideTimer) {
      clearTimeout(trayHideTimer)
      trayHideTimer = null
    }
    trayWindow = null
  })
  loadRendererWindow(trayWindow, 'tray')
}

function createDetachedWindow(
  mode: 'reports' | 'settings' | 'meetings',
  width: number,
  height: number,
  title: string
) {
  const fittedSize = fitWindowSizeToDisplay(width, height)
  const window = new BrowserWindow({
    width: fittedSize.width,
    height: fittedSize.height,
    minWidth: Math.min(fittedSize.width, 640),
    minHeight: Math.min(fittedSize.height, 520),
    center: true,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: process.platform === 'win32',
    fullscreen: false,
    fullscreenable: false,
    maximizable: false,
    title,
    ...macNativeGlassWindowOptions,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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
  })
  enforceWindowedMode(window)
  configureMacNativeGlassWindow(window, { windowButtons: true })
  attachRendererLogging(window, mode)
  window.once('ready-to-show', () => {
    window.show()
  })
  window.on('closed', () => {
    forgetNativeLiquidGlassForWindow(window)
    if (mode === 'reports') reportsWindow = null
    if (mode === 'settings') settingsWindow = null
    if (mode === 'meetings') meetingsWindow = null
  })
  loadRendererWindow(window, mode)
  return window
}

function openReportsWindow() {
  if (!reportsWindow || reportsWindow.isDestroyed()) {
    reportsWindow = createDetachedWindow(
      'reports',
      reportsWindowSize.width,
      reportsWindowSize.height,
      'HRS Reports'
    )
  }
  reportsWindow.show()
  if (reportsWindow.isMinimized()) reportsWindow.restore()
  reportsWindow.focus()
}

function openSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createDetachedWindow(
      'settings',
      settingsWindowSize.width,
      settingsWindowSize.height,
      'HRS Settings'
    )
  }
  settingsWindow.show()
  if (settingsWindow.isMinimized()) settingsWindow.restore()
  settingsWindow.focus()
}

function openMeetingsWindow() {
  if (!meetingsWindow || meetingsWindow.isDestroyed()) {
    meetingsWindow = createDetachedWindow(
      'meetings',
      meetingsWindowSize.width,
      meetingsWindowSize.height,
      'HRS Meetings'
    )
  }
  meetingsWindow.show()
  if (meetingsWindow.isMinimized()) meetingsWindow.restore()
  meetingsWindow.focus()
}

function getTrayWindowPosition() {
  if (!trayWindow || !tray) return null
  const trayBounds = tray.getBounds()
  const windowBounds = trayWindow.getBounds()
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
  const workArea = display.workArea

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
  let y = Math.round(trayBounds.y + trayBounds.height + 6)

  if (process.platform === 'win32') {
    y = Math.round(trayBounds.y - windowBounds.height - 6)
  }

  if (x + windowBounds.width > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - windowBounds.width - 8
  }
  if (x < workArea.x) x = workArea.x + 8
  if (y + windowBounds.height > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - windowBounds.height - 8
  }
  if (y < workArea.y) y = workArea.y + 8
  return { x, y }
}

function resizeTrayWindowToContent(requestedHeight: number) {
  if (!trayWindow || trayWindow.isDestroyed()) {
    return { height: 0, maxHeight: 0, constrained: false }
  }

  const trayBounds = tray?.getBounds()
  const display = trayBounds
    ? screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    : screen.getDisplayMatching(trayWindow.getBounds())
  const maxHeight = Math.max(
    TRAY_WINDOW_MIN_HEIGHT,
    display.workArea.height - TRAY_WINDOW_SCREEN_MARGIN * 2
  )
  const normalizedHeight = Math.max(TRAY_WINDOW_MIN_HEIGHT, Math.ceil(requestedHeight))
  const height = Math.min(normalizedHeight, maxHeight)
  const currentBounds = trayWindow.getBounds()

  if (currentBounds.height !== height) {
    trayWindow.setSize(trayWindowSize.width, height, false)
    if (trayWindow.isVisible()) {
      const position = getTrayWindowPosition()
      if (position) trayWindow.setPosition(position.x, position.y, false)
    }
  }

  return {
    height,
    maxHeight,
    constrained: normalizedHeight > maxHeight
  }
}

function showTrayWindow() {
  if (!trayWindow) return
  if (trayHideTimer) {
    clearTimeout(trayHideTimer)
    trayHideTimer = null
  }
  traySuppressBlurUntil = Date.now() + 220
  const position = getTrayWindowPosition()
  if (position) {
    trayWindow.setPosition(position.x, position.y, false)
  }
  trayWindow.show()
  trayWindow.focus()
  trayWindow.webContents.send('app:trayOpened')
}

function applyTrayPinnedWindowBehavior() {
  if (!trayWindow || trayWindow.isDestroyed()) return
  trayWindow.setAlwaysOnTop(true)
  if (process.platform === 'darwin') {
    trayWindow.setVisibleOnAllWorkspaces(trayPinned, { visibleOnFullScreen: trayPinned })
  }
}

function setTrayPinnedPreference(next: boolean) {
  trayPinned = next
  setPreferences({ trayPinned })
  applyTrayPinnedWindowBehavior()
  if (trayPinned) {
    if (trayHideTimer) {
      clearTimeout(trayHideTimer)
      trayHideTimer = null
    }
    trayWindow?.webContents.send('app:trayOpened')
  } else if (trayWindow?.isVisible() && !trayWindow.isFocused()) {
    beginHideTrayWindow('blur')
  }
  return trayPinned
}

function beginHideTrayWindow(reason: TrayCloseReason = 'blur') {
  if (!trayWindow || !trayWindow.isVisible()) return
  if (reason === 'blur' && trayPinned) {
    trayWindow.webContents.send('app:trayOpened')
    return
  }
  if (trayHideTimer) {
    clearTimeout(trayHideTimer)
    trayHideTimer = null
  }
  trayWindow.webContents.send('app:trayClosing', reason)
  trayHideTimer = setTimeout(() => {
    trayHideTimer = null
    if (!trayWindow || !trayWindow.isVisible()) return
    if (reason === 'blur' && trayPinned) {
      trayWindow.webContents.send('app:trayOpened')
      return
    }
    if (reason === 'blur' && trayWindow.isFocused()) {
      trayWindow.webContents.send('app:trayOpened')
      return
    }
    trayWindow.hide()
  }, 140)
}

function toggleTrayWindow() {
  if (!trayWindow) {
    trayOpenOnReady = true
    createTrayWindow()
    return
  }
  if (!trayWindow) return
  if (trayWindow.isVisible()) {
    beginHideTrayWindow('toggle')
    return
  }
  showTrayWindow()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Keep tray open',
      type: 'checkbox',
      checked: trayPinned,
      click: menuItem => {
        setTrayPinnedPreference(menuItem.checked)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

function createTray(): boolean {
  if (tray) return true
  try {
    const trayIcon = getTrayIcon()
    tray = new Tray(trayIcon as Parameters<typeof Tray>[0])
    tray.setToolTip('HRS Desktop')
    tray.on('click', () => toggleTrayWindow())
    tray.on('right-click', () => {
      tray?.popUpContextMenu(buildTrayMenu())
    })
    tray.on('destroyed', () => {
      tray = null
      if (!isQuitting) {
        setTimeout(() => {
          if (isQuitting || tray) return
          if (createTray()) {
            createTrayWindow()
            logInfo('[main] restored tray icon after it was destroyed')
          }
        }, 500)
      }
    })
    // Keep context menu on explicit right-click only.
    return true
  } catch (error) {
    tray = null
    logError('[main] failed to create tray', error)
    return false
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  logInfo('[main] app ready', `boot=${Date.now() - processBootAt}ms`)
  logInfo('[main] logging to', getMainLogPaths())
  try {
    if (migrateHrsCredentialFlowPreferences()) {
      logInfo('[auth] preserved HRS credentials and reset Auto-login for the corrected login flow')
    }
  } catch (error) {
    logWarn('[auth] could not apply the HRS credential-flow preference migration', error)
  }
  try {
    trayPinned = getPreferences().trayPinned
  } catch (error) {
    trayPinned = false
    logWarn('[main] could not load the tray pinned preference', error)
  }
  app.on('before-quit', () => {
    isQuitting = true
    logInfo('[main] before-quit')
  })
  if (startInTray) {
    applyTrayOnlyMode()
  } else {
    applyDockIcon()
  }
  const trayReady = createTray()
  logInfo('[main] tray init done', `tray=${trayReady}`, `elapsed=${Date.now() - processBootAt}ms`)
  registerHrsIpc(openLoginWindow, closeActiveLoginWindow)
  registerJiraIpc()
  registerPreferencesIpc()
  registerExportIpc()
  registerNotificationIpc()
  registerMeetingsIpc()
  registerAgendaIpc()
  registerProjectManagementIpc()
  registerSupabaseIpc()
  registerSlackIpc()
  void setupAutoUpdater()
  ipcMain.handle('app:getTrayPinned', () => trayPinned)
  ipcMain.handle('app:setTrayPinned', (_event, pinned: unknown) => {
    if (typeof pinned !== 'boolean') {
      throw new Error('Invalid app:setTrayPinned payload')
    }
    return setTrayPinnedPreference(pinned)
  })
  ipcMain.handle('app:dismissTray', () => {
    beginHideTrayWindow('dismiss')
    return true
  })
  ipcMain.handle('app:resizeTrayToContent', (_event, requestedHeight: unknown) => {
    if (
      typeof requestedHeight !== 'number' ||
      !Number.isFinite(requestedHeight) ||
      requestedHeight <= 0 ||
      requestedHeight > 20_000
    ) {
      throw new Error('Invalid app:resizeTrayToContent payload')
    }
    return resizeTrayWindowToContent(requestedHeight)
  })
  ipcMain.handle('app:openMainWindow', () => {
    showMainWindow()
    if (trayWindow?.isVisible()) {
      beginHideTrayWindow('open-main')
    }
    return true
  })
  ipcMain.handle('app:openReportsWindow', () => {
    openReportsWindow()
    return true
  })
  ipcMain.handle('app:openSettingsWindow', () => {
    openSettingsWindow()
    return true
  })
  ipcMain.handle('app:openMeetingsWindow', () => {
    openMeetingsWindow()
    return true
  })
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
    if (typeof collapsed !== 'boolean') {
      throw new Error('Invalid app:setFloatingCollapsed payload')
    }
    if (!floatingWindow) return false
    const size = collapsed ? floatingSizes.collapsed : floatingSizes.expanded
    floatingWindow.setSize(size.width, size.height, false)
    return true
  })
  ipcMain.handle('app:setNativeThemeMode', (event, mode: ThemeMode) => {
    if (mode !== 'dark' && mode !== 'oled' && mode !== 'liquid' && mode !== 'h4c37') {
      throw new Error('Invalid app:setNativeThemeMode payload')
    }
    nativeThemeMode = mode
    if (mode === 'liquid') {
      applyNativeLiquidGlassToWindow(BrowserWindow.fromWebContents(event.sender), 'current')
      applyNativeLiquidGlassToAllWindows()
    }
    return {
      nativeLiquidGlass: process.platform === 'darwin',
      supported:
        process.platform === 'darwin' &&
        Boolean(getLiquidGlassModule()?.isGlassSupported?.())
    }
  })
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getUpdateState', () => latestUpdateState)
  ipcMain.handle('app:checkForUpdates', async () => {
    const result = await checkForUpdatesNow()
    return Boolean(result)
  })
  ipcMain.handle('app:downloadUpdate', async () => {
    if (!updaterConfigured || !appUpdater) {
      setUpdateDisabled('Updates are not configured for this build.')
      return false
    }
    try {
      await appUpdater.downloadUpdate()
      return true
    } catch (error) {
      const message = formatUpdaterError(error)
      emitUpdateState({ state: 'error', message })
      return false
    }
  })
  ipcMain.handle('app:installUpdate', async () => {
    if (!updaterConfigured || !appUpdater) {
      setUpdateDisabled('Updates are not configured for this build.')
      return false
    }
    setImmediate(() => {
      appUpdater?.quitAndInstall()
    })
    return true
  })
  if (startInTray && trayReady) {
    logInfo('[main] starting in tray-only mode (main window lazy)')
    // Show tray panel once on startup so users see the app immediately.
    trayOpenOnReady = true
    createTrayWindow()
  } else {
    createMainWindow(false)
  }
})

app.on('window-all-closed', () => {
  logInfo('[main] window-all-closed', `tray=${Boolean(tray)}`, `isQuitting=${isQuitting}`)
  if (tray && !isQuitting) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
})

/* =========================
   LOGIN FLOW (COOKIE BASED)
   ========================= */

type LoginOptions = {
  username?: string
  password?: string
  autoSubmit?: boolean
}

function closeActiveLoginWindow() {
  if (!activeLoginWindow || activeLoginWindow.isDestroyed()) {
    activeLoginWindow = null
    return
  }
  try {
    activeLoginWindow.close()
  } catch (error) {
    logWarn('[auth] failed to close active login window', error)
  } finally {
    activeLoginWindow = null
  }
}

async function openLoginWindow(options: LoginOptions = {}): Promise<boolean> {
  if (activeLoginPromise) {
    if (!options.autoSubmit && activeLoginWindow && !activeLoginWindow.isDestroyed()) {
      activeLoginWindow.show()
      activeLoginWindow.focus()
    }
    return activeLoginPromise
  }

  const loginPromise = new Promise<boolean>((resolve, reject) => {
    const loginSession = session.fromPartition('persist:hrs')

    const { username, password, autoSubmit } = options
    const shouldAutoLogin = Boolean(autoSubmit && username && password)
    const fittedSize = fitWindowSizeToDisplay(900, 700)
    const loginWindow = new BrowserWindow({
      width: fittedSize.width,
      height: fittedSize.height,
      center: true,
      fullscreen: false,
      fullscreenable: false,
      maximizable: false,
      show: !shouldAutoLogin,
      modal: !shouldAutoLogin,
      parent: mainWindow ?? undefined,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        session: loginSession,
        // SECURITY: keep login renderer isolated as well.
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    enforceWindowedMode(loginWindow)
    activeLoginWindow = loginWindow

    logInfo('[auth] opening login window')

    let resolved = false
    let autoShowTimer: NodeJS.Timeout | null = null
    let autoLoginTimeout: NodeJS.Timeout | null = null
    let autoSubmitAttempted = false
    let sessionCookieCheckInFlight = false

    const showInteractiveLogin = () => {
      if (autoShowTimer) {
        clearTimeout(autoShowTimer)
        autoShowTimer = null
      }
      if (autoLoginTimeout) {
        clearTimeout(autoLoginTimeout)
        autoLoginTimeout = null
      }
      if (!loginWindow.isDestroyed()) {
        loginWindow.show()
        loginWindow.focus()
      }
    }

    const resolveWhenSessionCookieIsReady = async () => {
      if (resolved || sessionCookieCheckInFlight) return
      sessionCookieCheckInFlight = true
      try {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (loginWindow.isDestroyed()) return
          const cookies = await loginSession.cookies.get({
            domain: 'hrs.comm-it.co.il'
          })
          if (cookies.some(cookie => cookie.name === 'sessionid')) {
            resolved = true
            if (autoShowTimer) clearTimeout(autoShowTimer)
            if (autoLoginTimeout) clearTimeout(autoLoginTimeout)
            loginWindow.close()
            resolve(true)
            return
          }
          await new Promise<void>(cookieWaitResolve => setTimeout(cookieWaitResolve, 250))
        }
        logInfo('[auth] reached admin without session cookie yet; waiting for another navigation')
      } catch (error) {
        logWarn('[auth] failed while checking for the HRS session cookie', error)
      } finally {
        sessionCookieCheckInFlight = false
      }
    }

    const tryAutoLogin = async () => {
      if (!shouldAutoLogin) return
      if (autoSubmitAttempted) {
        logWarn('[auth] automatic HRS login returned to the login page; switching to manual entry')
        showInteractiveLogin()
        return
      }
      autoSubmitAttempted = true
      try {
        const submitted = await loginWindow.webContents.executeJavaScript(
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
        if (!submitted) {
          logWarn('[auth] HRS login form was not found; switching to manual entry')
          showInteractiveLogin()
        }
      } catch (error) {
        logWarn('[auth] automatic HRS form submission failed; switching to manual entry', error)
        showInteractiveLogin()
      }
    }

    loginWindow.webContents.on('did-navigate', (_e, url) => {
      logInfo('[auth] navigated', url)

      let isAuthenticatedAdminPage = false
      try {
        const parsedUrl = new URL(url)
        isAuthenticatedAdminPage =
          parsedUrl.origin === 'https://hrs.comm-it.co.il' &&
          parsedUrl.pathname.startsWith('/admin/') &&
          !parsedUrl.pathname.startsWith('/admin/login/')
      } catch {
        isAuthenticatedAdminPage = false
      }

      if (isAuthenticatedAdminPage) {
        void resolveWhenSessionCookieIsReady()
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
      autoLoginTimeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error('Auto-login timed out waiting for DUO approval'))
          try {
            loginWindow.close()
          } catch {}
        }
      }, 150000)
    }

    loginWindow.loadURL(
      'https://hrs.comm-it.co.il/admin/login/?next=/admin/'
    )

    loginWindow.on('closed', () => {
      if (activeLoginWindow === loginWindow) {
        activeLoginWindow = null
      }
      if (autoShowTimer) clearTimeout(autoShowTimer)
      if (autoLoginTimeout) clearTimeout(autoLoginTimeout)
      if (!resolved) {
        reject(new Error('Login cancelled'))
      }
    })
  })
  activeLoginPromise = loginPromise
  void loginPromise
    .finally(() => {
      if (activeLoginPromise === loginPromise) activeLoginPromise = null
    })
    .catch(() => {})
  return loginPromise
}
