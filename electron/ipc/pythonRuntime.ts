import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type PythonCommand = {
  bin: string
  args: string[]
}

export type PythonRunner = PythonCommand

type PythonInfo = {
  executable: string
  version: string
  major: number
  minor: number
  architecture: string
}

const MINIMUM_PYTHON = { major: 3, minor: 9 }
const PYTHON_PROBE = [
  'import json,platform,sys',
  'print(json.dumps({',
  '"executable": sys.executable,',
  '"version": platform.python_version(),',
  '"major": sys.version_info.major,',
  '"minor": sys.version_info.minor,',
  '"architecture": platform.machine()',
  '}))'
].join(';')

function commandOutput(result: ReturnType<typeof spawnSync>) {
  return `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim()
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

function inspectPython(command: PythonCommand): PythonInfo | null {
  const result = spawnSync(command.bin, [...command.args, '-c', PYTHON_PROBE], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  })
  if (result.error || result.status !== 0) return null
  try {
    const info = JSON.parse(String(result.stdout).trim()) as PythonInfo
    if (
      info.major !== MINIMUM_PYTHON.major ||
      info.minor < MINIMUM_PYTHON.minor ||
      !info.executable
    ) {
      return null
    }
    return info
  } catch {
    return null
  }
}

export function resolvePythonBin() {
  const envBin = process.env.PYTHON_BIN
  if (envBin) {
    const command = { bin: envBin, args: [] }
    if (inspectPython(command)) {
      return command
    }
  }
  const candidates: PythonCommand[] =
    process.platform === 'win32'
      ? [
          { bin: 'py', args: ['-3.13'] },
          { bin: 'py', args: ['-3.12'] },
          { bin: 'py', args: ['-3.11'] },
          { bin: 'py', args: ['-3.10'] },
          { bin: 'py', args: ['-3.9'] },
          { bin: 'py', args: ['-3'] },
          { bin: 'python', args: [] },
          { bin: 'python3', args: [] }
        ]
      : [
          { bin: 'python3', args: [] },
          { bin: 'python', args: [] }
        ]
  const found = candidates.find(candidate => Boolean(inspectPython(candidate)))
  if (found) {
    return found
  }
  throw new Error(
    'A compatible Python runtime was not found. Install Python 3.9 or newer, disable the Windows Store python.exe alias if it is broken, or set PYTHON_BIN to the full Python path.'
  )
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
  const pythonInfo = inspectPython(pythonBin)
  if (!pythonInfo) {
    throw new Error('Python 3.9 or newer is required to prepare the calendar runtime.')
  }
  const expected = JSON.stringify(
    {
      runtime: 2,
      python: `${pythonInfo.major}.${pythonInfo.minor}`,
      architecture: pythonInfo.architecture,
      packages: requiredPackages
    },
    null,
    2
  )
  const venvPython = getVenvPython(venvPath)

  const hasValidVenv =
    fs.existsSync(venvPath) &&
    fs.existsSync(venvPython) &&
    Boolean(inspectPython({ bin: venvPython, args: [] }))
  const hasMarker = fs.existsSync(markerPath)
  const marker = hasMarker ? fs.readFileSync(markerPath, 'utf8') : ''
  const importsResult = hasValidVenv
    ? spawnSync(
        venvPython,
        ['-c', 'import pytz, requests, selenium, urllib3; print("ok")'],
        { encoding: 'utf8', timeout: 10000, windowsHide: true }
      )
    : null
  const dependenciesLoad = importsResult?.status === 0
  const needsInstall = !hasValidVenv || !dependenciesLoad || marker.trim() !== expected.trim()

  if (!needsInstall) {
    return venvPython
  }

  if (fs.existsSync(venvPath) && (!hasValidVenv || marker.trim() !== expected.trim())) {
    fs.rmSync(venvPath, { recursive: true, force: true })
  }

  if (!fs.existsSync(venvPython)) {
    const venvResult = spawnSync(pythonBin.bin, [...pythonBin.args, '-m', 'venv', venvPath], {
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true
    })
    if (venvResult.status !== 0) {
      throw new Error(
        commandOutput(venvResult) ||
          'Python virtual-environment creation failed. Repair the Python installation and try again.'
      )
    }
  }

  const installedVenvPython = getVenvPython(venvPath)
  let pipResult = spawnSync(installedVenvPython, ['-m', 'pip', '--version'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  })
  if (pipResult.status !== 0) {
    pipResult = spawnSync(installedVenvPython, ['-m', 'ensurepip', '--upgrade'], {
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true
    })
    if (pipResult.status !== 0) {
      throw new Error(commandOutput(pipResult) || 'Python pip could not be initialized.')
    }
  }
  const installResult = spawnSync(
    installedVenvPython,
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-input',
      '--retries',
      '3',
      '--timeout',
      '60',
      ...requiredPackages
    ],
    { encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true }
  )
  if (installResult.status !== 0) {
    throw new Error(
      commandOutput(installResult) ||
        'Failed to install the calendar Python packages. Check the network or proxy and try again.'
    )
  }
  const verifyResult = spawnSync(
    installedVenvPython,
    ['-c', 'import pytz, requests, selenium, urllib3; print("ok")'],
    { encoding: 'utf8', timeout: 30000, windowsHide: true }
  )
  if (verifyResult.status !== 0) {
    throw new Error(commandOutput(verifyResult) || 'The Python calendar runtime failed verification.')
  }
  fs.writeFileSync(markerPath, expected)
  return installedVenvPython
}

function bundledRuntimeCandidates() {
  const executable = process.platform === 'win32' ? 'hrs-python-runtime.exe' : 'hrs-python-runtime'
  return [
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'build',
      'python-runtime',
      'hrs-python-runtime',
      executable
    ),
    path.join(process.resourcesPath, 'build', 'python-runtime', 'hrs-python-runtime', executable),
    path.join(app.getAppPath(), 'build', 'python-runtime', 'hrs-python-runtime', executable)
  ]
}

function canRunBundledRuntime(runtimePath: string) {
  const result = spawnSync(runtimePath, ['--runtime-version'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  })
  return result.status === 0 && String(result.stdout).includes('hrs-python-runtime-v1')
}

export function resolvePythonRunner(
  scriptName: 'meetings_fetch.py' | 'agenda_fetch.py',
  requiredPackages: string[]
): PythonRunner {
  const bundledRuntime = bundledRuntimeCandidates().find(
    candidate => fs.existsSync(candidate) && canRunBundledRuntime(candidate)
  )
  const entrypoint = scriptName.replace(/\.py$/i, '')
  if (bundledRuntime) {
    return { bin: bundledRuntime, args: [entrypoint] }
  }

  const scriptPath = resolvePackagedScriptPath(scriptName)
  const venvPython = ensurePythonEnv(resolvePythonBin(), requiredPackages)
  return { bin: venvPython, args: [scriptPath] }
}
