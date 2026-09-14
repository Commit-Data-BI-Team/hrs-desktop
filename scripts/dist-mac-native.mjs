import { spawnSync } from 'node:child_process'

if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported macOS build architecture: ${process.arch}`)
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const scriptName = `dist:mac:${process.arch}`
const result = spawnSync(npmCommand, ['run', scriptName, '--', ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit'
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
