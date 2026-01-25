import { app, ipcMain } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

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
    const scriptPath = path.join(app.getAppPath(), 'scripts', 'meetings_fetch.py')
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Meetings script not found: ${scriptPath}`)
    }
    const pythonBin = resolvePythonBin()
    const venvPython = ensurePythonEnv(pythonBin)
    const args = [scriptPath, '--browser', options.browser || 'safari']
    if (options.headless) {
      args.push('--headless')
    }
    if (options.month) {
      args.push('--month', options.month)
    }
    const env = {
      ...process.env,
      MS_USERNAME: options.username || process.env.MS_USERNAME || '',
      MS_PASSWORD: options.password || process.env.MS_PASSWORD || '',
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
          if (trimmed) {
            event.sender.send('meetings:progress', trimmed)
          }
        }
      })
      child.on('error', err => {
        reject(err)
      })
      child.on('close', code => {
        const remaining = stderrBuffer.trim()
        if (remaining) {
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
