import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PREFIX = '[MAC SIGNATURE VERIFY]'

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const productFilename = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${productFilename}.app`)
  if (!fs.existsSync(appPath)) {
    throw new Error(`${PREFIX} app bundle missing at ${appPath}`)
  }

  await execFileAsync('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=4',
    appPath
  ])
  const { stderr } = await execFileAsync('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    appPath
  ])
  const signatureDetails = stderr.trim()
  const isAdHoc = /Signature=adhoc/i.test(signatureDetails) || /\badhoc\b/i.test(signatureDetails)
  const isDeveloperId = /^Authority=Developer ID Application:/m.test(signatureDetails)
  const teamIdentifier = signatureDetails.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? ''

  if (
    process.env.HRS_REQUIRE_MAC_SIGNING === '1' &&
    (isAdHoc || !isDeveloperId || !teamIdentifier)
  ) {
    throw new Error(
      `${PREFIX} production app is not Developer ID signed; refusing to publish a macOS auto-update`
    )
  }

  console.log(
    `${PREFIX} verified app=${appPath} signature=${isAdHoc ? 'ad-hoc' : isDeveloperId ? 'developer-id' : 'other'} team=${teamIdentifier || 'none'}`
  )
}
