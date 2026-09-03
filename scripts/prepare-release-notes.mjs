import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8')
)
const changelog = fs.readFileSync(path.join(projectDirectory, 'CHANGELOG.md'), 'utf8')
const version = String(packageJson.version)
const changelogLines = changelog.split(/\r?\n/)
const sectionStart = changelogLines.findIndex(line => line.trim() === `## ${version}`)

if (sectionStart < 0) {
  throw new Error(`CHANGELOG.md does not contain a section for version ${version}.`)
}

const nextSectionOffset = changelogLines
  .slice(sectionStart + 1)
  .findIndex(line => line.startsWith('## '))
const sectionEnd =
  nextSectionOffset < 0 ? changelogLines.length : sectionStart + 1 + nextSectionOffset
const bulletItems = changelogLines
  .slice(sectionStart + 1, sectionEnd)
  .map(line => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim() ?? '')
  .filter(Boolean)

if (bulletItems.length === 0) {
  throw new Error(`The ${version} changelog section does not contain any bullet items.`)
}

const releaseNotes = `${bulletItems.map(item => `- ${item}`).join('\n')}\n`
const outputPath = path.join(projectDirectory, 'build', 'release-notes.md')
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, releaseNotes, 'utf8')
console.log(`Prepared ${bulletItems.length} in-app release notes for v${version}.`)
