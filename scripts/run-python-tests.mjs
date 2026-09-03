import { spawnSync } from 'node:child_process'
import path from 'node:path'

const bundledBuilderPython =
  process.platform === 'win32'
    ? path.resolve('work/python-runtime-builder/venv/Scripts/python.exe')
    : path.resolve('work/python-runtime-builder/venv/bin/python')

const candidates = process.env.PYTHON_BIN
  ? [[process.env.PYTHON_BIN, []]]
  : process.platform === 'win32'
    ? [
        [bundledBuilderPython, []],
        ['py', ['-3']],
        ['python', []]
      ]
    : [
        [bundledBuilderPython, []],
        ['python3', []],
        ['python', []]
      ]

for (const [bin, prefix] of candidates) {
  const probe = spawnSync(bin, [...prefix, '-c', 'import selenium'], {
    stdio: 'ignore',
    windowsHide: true
  })
  if (probe.status !== 0) continue
  const result = spawnSync(
    bin,
    [...prefix, '-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_*.py'],
    { stdio: 'inherit', windowsHide: true }
  )
  process.exit(result.status ?? 1)
}

console.error('No Python 3 runtime with the test dependencies was found.')
process.exit(1)
