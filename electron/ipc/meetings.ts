import { app, ipcMain } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import {
  validateEnum,
  validateExactObject,
  validateOptionalString
} from '../utils/validation'

type MeetingsResult = {
  month: string
  count: number
  meetings: Array<{
    subject: string
    startTime: string
    endTime: string
    participants: string
    attendanceCount: number | null
    attendanceEmails: string[]
    attendeeEmails: string[]
  }>
}

type MeetingsOptions = {
  browser: 'safari' | 'chrome'
  headless?: boolean
  month?: string | null
  username?: string | null
  password?: string | null
}

const REQUIRED_PACKAGES = ['selenium', 'requests', 'pytz']

function shouldIgnoreProgressLine(line: string) {
  const value = line.trim()
  if (!value) return true
  if (value === 'Stacktrace:') return true
  if (/^\d+\s+chromedriver\b/i.test(value)) return true
  if (value.includes('cxxbridge1$str$ptr')) return true
  if (value.includes('libsystem_pthread.dylib')) return true
  if (value.includes('thread_start +')) return true
  if (value.includes('_pthread_start +')) return true
  return false
}

function resolveMeetingsScriptPath() {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'meetings_fetch.py')
    )
    candidates.push(path.join(process.resourcesPath, 'scripts', 'meetings_fetch.py'))
  }
  candidates.push(path.join(app.getAppPath(), 'scripts', 'meetings_fetch.py'))
  const existing = candidates.find(candidate => fs.existsSync(candidate))
  if (!existing) {
    throw new Error(`Meetings script not found. Tried: ${candidates.join(', ')}`)
  }
  return existing
}

function canRunPython(pythonBin: string) {
  const result = spawnSync(pythonBin, ['-V'], { encoding: 'utf8' })
  if (result.error) {
    return false
  }
  return result.status === 0
}

function resolvePythonBin() {
  const envBin = process.env.PYTHON_BIN
  if (envBin && canRunPython(envBin)) {
    return envBin
  }
  if (canRunPython('python3')) {
    return 'python3'
  }
  if (canRunPython('python')) {
    return 'python'
  }
  throw new Error('Python 3 not found. Install it or set PYTHON_BIN to your python3 path.')
}

function getVenvPython(venvPath: string) {
  if (process.platform === 'win32') {
    return path.join(venvPath, 'Scripts', 'python.exe')
  }
  return path.join(venvPath, 'bin', 'python')
}

function ensurePythonEnv(pythonBin: string) {
  const venvPath = path.join(app.getPath('userData'), 'meetings-venv')
  const markerPath = path.join(venvPath, '.requirements')
  const expected = REQUIRED_PACKAGES.join('\n')

  const hasVenv = fs.existsSync(venvPath)
  const hasMarker = fs.existsSync(markerPath)
  const marker = hasMarker ? fs.readFileSync(markerPath, 'utf8') : ''
  const needsInstall = !hasVenv || marker.trim() !== expected.trim()

  if (!needsInstall) {
    return getVenvPython(venvPath)
  }

  const venvResult = spawnSync(pythonBin, ['-m', 'venv', venvPath], { encoding: 'utf8' })
  if (venvResult.status !== 0) {
    throw new Error(
      venvResult.stderr?.trim() ||
        'Python is missing or venv creation failed. Install python3 and try again.'
    )
  }

  const venvPython = getVenvPython(venvPath)
  spawnSync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { encoding: 'utf8' })
  const installResult = spawnSync(
    venvPython,
    ['-m', 'pip', 'install', ...REQUIRED_PACKAGES],
    { encoding: 'utf8' }
  )
  if (installResult.status !== 0) {
    throw new Error(installResult.stderr?.trim() || 'Failed to install Python packages.')
  }
  fs.writeFileSync(markerPath, expected)
  return venvPython
}

export function registerMeetingsIpc() {
  ipcMain.handle('meetings:run', async (event, options: MeetingsOptions) => {
    const safe = validateExactObject<{
      browser?: unknown
      headless?: unknown
      month?: unknown
      username?: unknown
      password?: unknown
    }>(options ?? {}, ['browser', 'headless', 'month', 'username', 'password'], 'meetings options')
    const browser = validateEnum(safe.browser, ['safari', 'chrome'] as const)
    const headless = typeof safe.headless === 'boolean' ? safe.headless : false
    const month =
      validateOptionalString(safe.month, { min: 7, max: 7, allowNull: true }) ?? null
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('Invalid month format (expected YYYY-MM)')
    }
    const username = validateOptionalString(safe.username, {
      min: 0,
      max: 200,
      allowNull: true
    })
    const password = validateOptionalString(safe.password, {
      min: 0,
      max: 300,
      allowNull: true
    })

    const scriptPath = resolveMeetingsScriptPath()
    const pythonBin = resolvePythonBin()
    const venvPython = ensurePythonEnv(pythonBin)
    const args = [scriptPath, '--browser', browser]
    if (headless) {
      args.push('--headless')
    }
    if (month) {
      args.push('--month', month)
    }
    const env = {
      ...process.env,
      MS_USERNAME: username || process.env.MS_USERNAME || '',
      MS_PASSWORD: password || process.env.MS_PASSWORD || '',
      MEETINGS_CHROME_PROFILE: path.join(app.getPath('userData'), 'meetings-chrome-profile')
    }
    return new Promise<MeetingsResult>((resolve, reject) => {
      const child = spawn(venvPython, args, { env })
      let stdout = ''
      let stderr = ''
      let stderrBuffer = ''
      child.stdout.on('data', data => {
        stdout += data.toString()
      })
      child.stderr.on('data', data => {
        const text = data.toString()
        stderr += text
        stderrBuffer += text
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed && !shouldIgnoreProgressLine(trimmed)) {
            event.sender.send('meetings:progress', trimmed)
          }
        }
      })
      child.on('error', err => {
        reject(err)
      })
      child.on('close', code => {
        const remaining = stderrBuffer.trim()
        if (remaining && !shouldIgnoreProgressLine(remaining)) {
          event.sender.send('meetings:progress', remaining)
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Meetings script failed (${code})`))
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          resolve(parsed as MeetingsResult)
        } catch (err) {
          reject(new Error(`Invalid meetings JSON: ${(err as Error).message}`))
        }
      })
    })
  })
}
