import fs from 'node:fs'
import path from 'node:path'

const [armPath, x64Path, outputPath] = process.argv.slice(2)
if (!armPath || !x64Path || !outputPath) {
  throw new Error(
    'Usage: node scripts/merge-latest-mac-yml.mjs <arm64.yml> <x64.yml> <output.yml>'
  )
}

function parseUpdateFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const version = source.match(/^version:\s*(.+)$/m)?.[1]?.trim()
  const filesBlock = source.match(/^files:\s*\n([\s\S]*?)^path:/m)?.[1] ?? ''
  const files = [...filesBlock.matchAll(/  - url:\s*(.+)\n\s+sha512:\s*(.+)\n\s+size:\s*(\d+)/g)].map(
    match => ({
      url: match[1].trim().replace(/^HRS(?:%20| )Desktop-/, 'HRS-Desktop-'),
      sha512: match[2].trim(),
      size: match[3].trim()
    })
  )
  const releaseMetadata = source.match(/^releaseNotes:[\s\S]*$/m)?.[0] ?? ''
  if (!version || files.length === 0) {
    throw new Error(`Invalid electron-builder macOS update manifest: ${filePath}`)
  }
  return { version, files, releaseMetadata }
}

const arm = parseUpdateFile(armPath)
const x64 = parseUpdateFile(x64Path)
if (arm.version !== x64.version) {
  throw new Error(`macOS update versions do not match: ${arm.version} and ${x64.version}`)
}

const files = [...arm.files, ...x64.files].filter(
  (file, index, all) => all.findIndex(candidate => candidate.url === file.url) === index
)
const preferred =
  files.find(file => /-arm64-mac\.zip$/i.test(file.url)) ??
  files.find(file => /-mac\.zip$/i.test(file.url)) ??
  files[0]

const manifest = [
  `version: ${arm.version}`,
  'files:',
  ...files.flatMap(file => [
    `  - url: ${file.url}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`
  ]),
  `path: ${preferred.url}`,
  `sha512: ${preferred.sha512}`,
  arm.releaseMetadata
]
  .filter(Boolean)
  .join('\n')

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${manifest}\n`)
console.log(`Merged macOS update manifest: ${outputPath}`)
