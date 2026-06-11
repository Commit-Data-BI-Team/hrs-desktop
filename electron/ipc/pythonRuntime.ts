import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type PythonCommand = {
  bin: string
  args: string[]
}

function copyDirectory(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

function materializePackagedScripts(scriptName: string, sourceScriptPath: string) {
  const sourceDir = path.dirname(sourceScriptPath)
  const targetDir = path.join(app.getPath('userData'), 'runtime-scripts')
  const targetScriptPath = path.join(targetDir, scriptName)

  try {
    copyDirectory(sourceDir, targetDir)
  } catch (err) {
    throw new Error(
      `Failed to prepare packaged Python scripts from ${sourceDir}: ${(err as Error).message}`
    )
  }

  if (!fs.existsSync(targetScriptPath)) {
    throw new Error(`Prepared Python script is missing after copy: ${targetScriptPath}`)
  }
  return targetScriptPath
}

export function resolvePackagedScriptPath(scriptName: string) {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', scriptName),
      path.join(process.resourcesPath, 'scripts', scriptName),
      path.join(process.resourcesPath, 'app.asar', 'scripts', scriptName)
    )
  }
  candidates.push(path.join(app.getAppPath(), 'scripts', scriptName))

  const existing = candidates.find(candidate => {
    const normalized = candidate.split(path.sep).join('/')
    return fs.existsSync(candidate) && !normalized.includes('/app.asar/')
  })
  if (existing) {
    return existing
  }

  const asarCandidate = candidates.find(candidate => {
    const normalized = candidate.split(path.sep).join('/')
    return normalized.includes('/app.asar/') && fs.existsSync(candidate)
  })
  if (asarCandidate) {
    return materializePackagedScripts(scriptName, asarCandidate)
  }

  throw new Error(`${scriptName} not found. Tried: ${candidates.join(', ')}`)
}

function canRunPython(command: PythonCommand) {
  const result = spawnSync(command.bin, [...command.args, '-V'], { encoding: 'utf8' })
  if (result.error) {
    return false
  }
  return result.status === 0
}

export function resolvePythonBin() {
  const envBin = process.env.PYTHON_BIN
  if (envBin) {
    const command = { bin: envBin, args: [] }
    if (canRunPython(command)) {
      return command
    }
  }
  const candidates: PythonCommand[] =
    process.platform === 'win32'
      ? [
          { bin: 'py', args: ['-3'] },
          { bin: 'python', args: [] },
          { bin: 'python3', args: [] }
        ]
      : [
          { bin: 'python3', args: [] },
          { bin: 'python', args: [] }
        ]
  const found = candidates.find(canRunPython)
  if (found) {
    return found
  }
  throw new Error('Python 3 not found. Install it or set PYTHON_BIN to your Python 3 path.')
}

function getVenvPython(venvPath: string) {
  if (process.platform === 'win32') {
    return path.join(venvPath, 'Scripts', 'python.exe')
  }
  return path.join(venvPath, 'bin', 'python')
}

export function ensurePythonEnv(pythonBin: PythonCommand, requiredPackages: string[]) {
  const venvPath = path.join(app.getPath('userData'), 'meetings-venv')
  const markerPath = path.join(venvPath, '.requirements')
  const expected = requiredPackages.join('\n')
  const venvPython = getVenvPython(venvPath)

  const hasValidVenv =
    fs.existsSync(venvPath) &&
    fs.existsSync(venvPython) &&
    canRunPython({ bin: venvPython, args: [] })
  const hasMarker = fs.existsSync(markerPath)
  const marker = hasMarker ? fs.readFileSync(markerPath, 'utf8') : ''
  const needsInstall = !hasValidVenv || marker.trim() !== expected.trim()

  if (!needsInstall) {
    return venvPython
  }

  if (fs.existsSync(venvPath) && !hasValidVenv) {
    fs.rmSync(venvPath, { recursive: true, force: true })
  }

  const venvResult = spawnSync(pythonBin.bin, [...pythonBin.args, '-m', 'venv', venvPath], {
    encoding: 'utf8'
  })
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
