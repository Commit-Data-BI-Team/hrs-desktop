import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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

async function stripBundleMetadata(appPath) {
  const parentDir = path.dirname(appPath)
  const appName = path.basename(appPath)
  const stamp = `${process.pid}-${Date.now()}`
  const cleanRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), `hrs-metadata-clean-${stamp}-`))
  const archivePath = path.join(cleanRoot, `${appName}.tar`)
  const unpackDir = path.join(cleanRoot, 'unpacked')
  const tarEnv = { ...process.env, COPYFILE_DISABLE: '1' }

  try {
    await run('/usr/bin/tar', ['--no-xattrs', '-cf', archivePath, appName], {
      cwd: parentDir,
      env: tarEnv
    })
    await fs.promises.mkdir(unpackDir, { recursive: true })
    await run('/usr/bin/tar', ['--no-xattrs', '-xf', archivePath], {
      cwd: unpackDir,
      env: tarEnv
    })
    await fs.promises.rm(appPath, { recursive: true, force: true })
    await fs.promises.rename(path.join(unpackDir, appName), appPath)
  } finally {
    await fs.promises.rm(cleanRoot, { recursive: true, force: true })
  }
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

  const signingIdentity = process.env.HRS_MAC_SIGN_IDENTITY?.trim() || '-'

  console.log(
    `${PREFIX} start platform=${context.electronPlatformName} arch=${context.arch} ci=${process.env.CI || 'false'} identity=${signingIdentity} appPath=${appPath}`
  )

  if (!fs.existsSync(appPath)) {
    throw new Error(`${PREFIX} app bundle missing at ${appPath}`)
  }
  if (!fs.existsSync(entitlementsPath)) {
    throw new Error(`${PREFIX} entitlements missing at ${entitlementsPath}`)
  }

  await run('/usr/bin/xattr', ['-cr', appPath])
  await run('/usr/sbin/dot_clean', ['-m', appPath])
  await stripBundleMetadata(appPath)
  await run('/usr/bin/xattr', ['-cr', appPath])
  await run('/usr/sbin/dot_clean', ['-m', appPath])
  await run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    signingIdentity,
    '--options',
    'runtime',
    '--entitlements',
    entitlementsPath,
    appPath
  ])
  await verify(appPath)

  console.log(`${PREFIX} signed and verified appPath=${appPath}`)
}
