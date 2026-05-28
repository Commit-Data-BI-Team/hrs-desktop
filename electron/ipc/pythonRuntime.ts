import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function resolvePackagedScriptPath(scriptName: string) {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', scriptName),
      path.join(process.resourcesPath, 'scripts', scriptName)
    )
  }
  candidates.push(path.join(app.getAppPath(), 'scripts', scriptName))

  const existing = candidates.find(candidate => {
    const normalized = candidate.split(path.sep).join('/')
    return fs.existsSync(candidate) && !normalized.includes('/app.asar/')
  })
  if (!existing) {
    throw new Error(`${scriptName} not found. Tried: ${candidates.join(', ')}`)
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

export function resolvePythonBin() {
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

export function ensurePythonEnv(pythonBin: string, requiredPackages: string[]) {
  const venvPath = path.join(app.getPath('userData'), 'meetings-venv')
  const markerPath = path.join(venvPath, '.requirements')
  const expected = requiredPackages.join('\n')
  const venvPython = getVenvPython(venvPath)

  const hasValidVenv =
    fs.existsSync(venvPath) &&
    fs.existsSync(venvPython) &&
    canRunPython(venvPython)
  const hasMarker = fs.existsSync(markerPath)
  const marker = hasMarker ? fs.readFileSync(markerPath, 'utf8') : ''
  const needsInstall = !hasValidVenv || marker.trim() !== expected.trim()

  if (!needsInstall) {
    return venvPython
  }

  if (fs.existsSync(venvPath) && !hasValidVenv) {
    fs.rmSync(venvPath, { recursive: true, force: true })
  }

  const venvResult = spawnSync(pythonBin, ['-m', 'venv', venvPath], { encoding: 'utf8' })
  if (venvResult.status !== 0) {
    throw new Error(
      venvResult.stderr?.trim() ||
        'Python is missing or venv creation failed. Install python3 and try again.'
    )
  }

  const installedVenvPython = getVenvPython(venvPath)
  spawnSync(installedVenvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    encoding: 'utf8'
  })
  const installResult = spawnSync(
    installedVenvPython,
    ['-m', 'pip', 'install', ...requiredPackages],
    { encoding: 'utf8' }
  )
  if (installResult.status !== 0) {
    throw new Error(installResult.stderr?.trim() || 'Failed to install Python packages.')
  }
  fs.writeFileSync(markerPath, expected)
  return installedVenvPython
}
