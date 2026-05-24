import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PREFIX = '[MAC UPDATE SIGNING DEBUG]'

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 8,
    ...options
  })
  if (stdout.trim()) console.log(`${PREFIX} ${command} stdout: ${stdout.trim()}`)
  if (stderr.trim()) console.log(`${PREFIX} ${command} stderr: ${stderr.trim()}`)
}

async function verify(appPath) {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    console.log(`${PREFIX} skipped non-mac platform=${context.electronPlatformName}`)
    return
  }

  if (process.env.HRS_SKIP_ADHOC_SIGN_MAC === '1') {
    console.log(`${PREFIX} skipped by HRS_SKIP_ADHOC_SIGN_MAC=1`)
    return
  }

  const productFilename = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${productFilename}.app`)
  const entitlementsPath = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist')

  console.log(
    `${PREFIX} start platform=${context.electronPlatformName} arch=${context.arch} ci=${process.env.CI || 'false'} appPath=${appPath}`
  )

  if (!fs.existsSync(appPath)) {
    throw new Error(`${PREFIX} app bundle missing at ${appPath}`)
  }
  if (!fs.existsSync(entitlementsPath)) {
    throw new Error(`${PREFIX} entitlements missing at ${entitlementsPath}`)
  }

  await run('/usr/bin/xattr', ['-c', '-r', appPath])
  await run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--options',
    'runtime',
    '--entitlements',
    entitlementsPath,
    appPath
  ])
  await verify(appPath)

  console.log(`${PREFIX} signed and verified appPath=${appPath}`)
}
