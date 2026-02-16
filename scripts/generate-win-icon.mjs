// Generate Windows .ico file from PNG (PNG-compressed ICO)
// This produces a valid ICO container with a single PNG image.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { deflateSync } from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('⚠️  Note: For production builds, generate a proper .ico file with multiple sizes.');
console.log('   This script builds a multi-size ICO using PNG-compressed entries.');
console.log('   You can later replace it with a professional icon set from a converter.');

const buildDir = join(__dirname, '..', 'build');
const sourcePngPath = join(buildDir, 'icon-source.png');
const pngPath = join(buildDir, 'icon.png');
const trayPngPath = join(buildDir, 'tray-icon.png');
const trayMacTemplatePath = join(buildDir, 'tray-icon-macTemplate.png');
const trayMacTemplate2xPath = join(buildDir, 'tray-icon-macTemplate@2x.png');
const icoPath = join(buildDir, 'icon.ico');

function readPngSize(buffer) {
  // PNG signature is 8 bytes, IHDR chunk starts at byte 8
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(pngSignature)) {
    throw new Error('Invalid PNG signature');
  }
  const ihdrOffset = 8;
  const chunkType = buffer.subarray(ihdrOffset + 4, ihdrOffset + 8).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new Error('Missing IHDR chunk in PNG');
  }
  const width = buffer.readUInt32BE(ihdrOffset + 8);
  const height = buffer.readUInt32BE(ihdrOffset + 12);
  return { width, height };
}

function createIcoFromPngs(pngBuffers) {
  const icoHeaderSize = 6;
  const entrySize = 16;
  const count = pngBuffers.length;
  const header = Buffer.alloc(icoHeaderSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4); // image count

  const entries = Buffer.alloc(entrySize * count);
  let offset = icoHeaderSize + entrySize * count;

  pngBuffers.forEach((pngBuffer, index) => {
    const { width, height } = readPngSize(pngBuffer);
    const entryOffset = index * entrySize;
    entries.writeUInt8(width >= 256 ? 0 : width, entryOffset + 0);
    entries.writeUInt8(height >= 256 ? 0 : height, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2); // palette
    entries.writeUInt8(0, entryOffset + 3); // reserved
    entries.writeUInt16LE(1, entryOffset + 4); // color planes
    entries.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    entries.writeUInt32LE(pngBuffer.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += pngBuffer.length;
  });

  return Buffer.concat([header, entries, ...pngBuffers]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    let byte = (crc ^ buffer[i]) & 0xff;
    for (let j = 0; j < 8; j += 1) {
      byte = byte & 1 ? 0xedb88320 ^ (byte >>> 1) : byte >>> 1;
    }
    crc = (crc >>> 8) ^ byte;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createPixelCanvas(width, height, color = [0, 0, 0, 0]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  }
  return pixels;
}

function paintPixel(pixels, width, height, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function drawGlyphs(pixels, width, height, letters, scale, startX, startY, color, spacing = 1) {
  const step = spacing * scale;
  const letterWidth = letters[0][0].length * scale;
  letters.forEach((glyph, index) => {
    const offsetX = startX + index * (letterWidth + step);
    glyph.forEach((row, rowIndex) => {
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        if (row[colIndex] !== '1') continue;
        const xBase = offsetX + colIndex * scale;
        const yBase = startY + rowIndex * scale;
        for (let dx = 0; dx < scale; dx += 1) {
          for (let dy = 0; dy < scale; dy += 1) {
            paintPixel(pixels, width, height, xBase + dx, yBase + dy, color);
          }
        }
      }
    });
  });
}

function encodePng(width, height, pixels) {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  const pixelBuffer = Buffer.from(pixels);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowSize] = 0;
    const rowStart = y * width * 4;
    pixelBuffer.copy(raw, y * rowSize + 1, rowStart, rowStart + width * 4);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function createTrayIconPng() {
  const width = 32;
  const height = 32;
  const bg = [11, 26, 32, 255];
  const border = [31, 122, 140, 255];
  const text = [73, 194, 208, 255];
  const pixels = createPixelCanvas(width, height, bg);

  for (let x = 0; x < width; x += 1) {
    paintPixel(pixels, width, height, x, 0, border);
    paintPixel(pixels, width, height, x, height - 1, border);
  }
  for (let y = 0; y < height; y += 1) {
    paintPixel(pixels, width, height, 0, y, border);
    paintPixel(pixels, width, height, width - 1, y, border);
  }

  const letters = [
    [
      '10001',
      '10001',
      '11111',
      '10001',
      '10001',
      '10001',
      '10001'
    ],
    [
      '11110',
      '10001',
      '10001',
      '11110',
      '10100',
      '10010',
      '10001'
    ],
    [
      '01111',
      '10000',
      '10000',
      '01110',
      '00001',
      '00001',
      '11110'
    ]
  ];

  const scale = 2;
  const letterWidth = 5 * scale;
  const letterHeight = 7 * scale;
  const spacing = 1;
  const totalWidth = letterWidth * 3 + spacing * 2;
  const startX = Math.floor((width - totalWidth) / 2);
  const startY = Math.floor((height - letterHeight) / 2);

  drawGlyphs(pixels, width, height, letters, scale, startX, startY, text, spacing);
  const pngBuffer = encodePng(width, height, pixels);

  writeFileSync(trayPngPath, pngBuffer);
  console.log('✅ Created tray-icon.png (HRS 32x32).');
}

function createMacTemplateTrayIcon(outputPath, size) {
  const width = size;
  const height = size;
  const pixels = createPixelCanvas(width, height, [0, 0, 0, 0]);
  const white = [255, 255, 255, 255];
  const letters = [
    ['101', '101', '111', '101', '101'],
    ['110', '101', '110', '101', '101'],
    ['111', '100', '111', '001', '111']
  ];
  const scale = size >= 36 ? 2 : 1;
  const spacing = 1;
  const letterWidth = letters[0][0].length * scale;
  const totalWidth = letterWidth * letters.length + spacing * scale * (letters.length - 1);
  const letterHeight = letters[0].length * scale;
  const startX = Math.floor((width - totalWidth) / 2);
  const startY = Math.floor((height - letterHeight) / 2);

  drawGlyphs(pixels, width, height, letters, scale, startX, startY, white, spacing);
  writeFileSync(outputPath, encodePng(width, height, pixels));
}

function createMacTemplateTrayIcons() {
  createMacTemplateTrayIcon(trayMacTemplatePath, 18);
  createMacTemplateTrayIcon(trayMacTemplate2xPath, 36);
  console.log('✅ Created tray-icon-macTemplate.png + @2x.');
}

try {
  createTrayIconPng();
  createMacTemplateTrayIcons();

  const basePath = existsSync(sourcePngPath) ? sourcePngPath : pngPath;
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const pngBuffers = [];

  if (process.platform === 'darwin') {
    sizes.forEach(size => {
      const outPath = join(buildDir, `icon-${size}.png`);
      const result = spawnSync('sips', ['-z', String(size), String(size), basePath, '--out', outPath], {
        stdio: 'ignore'
      });
      if (result.status === 0) {
        pngBuffers.push(readFileSync(outPath));
      }
    });
  }

  if (pngBuffers.length === 0) {
    pngBuffers.push(readFileSync(basePath));
  }

  const icoData = createIcoFromPngs(pngBuffers);
  writeFileSync(icoPath, icoData);
  console.log('✅ Created icon.ico (multi-size PNG-compressed ICO).');
  console.log('   Consider replacing with a professional icon set for production polish.');
} catch (err) {
  console.error('❌ Failed to create icon:', err.message);
  process.exit(1);
}
