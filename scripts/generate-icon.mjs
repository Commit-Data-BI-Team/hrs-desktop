import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const sourcePath = path.resolve(projectRoot, 'build', 'icon-source.png')
const iconsetDir = path.resolve(projectRoot, 'build', 'icon.iconset')
const outputIcns = path.resolve(projectRoot, 'build', 'icon.icns')
const outputPng = path.resolve(projectRoot, 'build', 'icon.png')

if (!fs.existsSync(sourcePath)) {
  console.error(`Missing source image: ${sourcePath}`)
  console.error('Place your logo at build/icon-source.png (1024x1024 recommended).')
  process.exit(1)
}

fs.rmSync(iconsetDir, { recursive: true, force: true })
fs.mkdirSync(iconsetDir, { recursive: true })

const sizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 }
]

for (const size of sizes) {
  execFileSync('sips', [
    '-z',
    String(size.size),
    String(size.size),
    sourcePath,
    '--out',
    path.join(iconsetDir, size.name)
  ])
}

execFileSync('sips', ['-z', '1024', '1024', sourcePath, '--out', outputPng])
execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outputIcns])

console.log(`Generated ${outputIcns}`)
