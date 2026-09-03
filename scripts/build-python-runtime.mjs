import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workRoot = path.join(root, 'work', 'python-runtime-builder')
const builderVenv = path.join(workRoot, 'venv')
const builderPython =
  process.platform === 'win32'
    ? path.join(builderVenv, 'Scripts', 'python.exe')
    : path.join(builderVenv, 'bin', 'python')

function canRun(bin, args = []) {
  const result = spawnSync(bin, [...args, '-c', 'import sys; assert sys.version_info >= (3, 9)'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 10000
  })
  return result.status === 0
}

function findPython() {
  const candidates = process.env.PYTHON_BIN
    ? [[process.env.PYTHON_BIN, []]]
    : process.platform === 'win32'
      ? [
          ['py', ['-3.13']],
          ['py', ['-3.12']],
          ['py', ['-3.11']],
          ['py', ['-3.10']],
          ['py', ['-3.9']],
          ['py', ['-3']],
          ['python', []]
        ]
      : [
          ['python3', []],
          ['python', []]
        ]
  const candidate = candidates.find(([bin, args]) => canRun(bin, args))
  if (!candidate) throw new Error('Python 3.9 or newer is required to build the bundled runtime.')
  return candidate
}

function run(bin, args) {
  execFileSync(bin, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  })
}

fs.mkdirSync(workRoot, { recursive: true })
if (!canRun(builderPython)) {
  fs.rmSync(builderVenv, { recursive: true, force: true })
  const [python, pythonArgs] = findPython()
  run(python, [...pythonArgs, '-m', 'venv', builderVenv])
}

run(builderPython, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '--no-input',
  '--upgrade',
  'pip',
  'pyinstaller==6.16.0',
  '-r',
  path.join(root, 'scripts', 'requirements-runtime.txt')
])

const distRoot = path.join(root, 'build', 'python-runtime')
const pyinstallerWork = path.join(workRoot, 'pyinstaller')
fs.rmSync(distRoot, { recursive: true, force: true })
fs.rmSync(pyinstallerWork, { recursive: true, force: true })
fs.mkdirSync(distRoot, { recursive: true })
fs.mkdirSync(pyinstallerWork, { recursive: true })

run(builderPython, [
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onedir',
  '--name',
  'hrs-python-runtime',
  '--distpath',
  distRoot,
  '--workpath',
  pyinstallerWork,
  '--specpath',
  pyinstallerWork,
  '--paths',
  path.join(root, 'scripts'),
  '--collect-all',
  'selenium',
  path.join(root, 'scripts', 'python_runtime_entry.py')
])

const executable = path.join(
  distRoot,
  'hrs-python-runtime',
  process.platform === 'win32' ? 'hrs-python-runtime.exe' : 'hrs-python-runtime'
)
const verification = spawnSync(executable, ['--runtime-version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000
})
if (verification.status !== 0 || !String(verification.stdout).includes('hrs-python-runtime-v1')) {
  throw new Error(`Bundled Python runtime verification failed: ${executable}`)
}
console.log(`Bundled Python runtime ready: ${executable}`)
