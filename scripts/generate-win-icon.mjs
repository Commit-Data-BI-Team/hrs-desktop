// Generate Windows .ico file from PNG
// This is a workaround - for production, use proper ICO converter

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('⚠️  Note: For production builds, generate a proper .ico file with multiple sizes.');
console.log('   You can use online tools like https://convertio.co/png-ico/');
console.log('   or install ImageMagick: brew install imagemagick');
console.log('');
console.log('   For now, copying PNG as placeholder...');

const buildDir = join(__dirname, '..', 'build');
const pngPath = join(buildDir, 'icon.png');
const icoPath = join(buildDir, 'icon.ico');

try {
  // For development, electron-builder can sometimes work with PNG
  // But proper ICO is recommended for Windows
  const pngData = readFileSync(pngPath);
  writeFileSync(icoPath, pngData);
  console.log('✅ Created placeholder icon.ico (not a true ICO format)');
  console.log('   Windows builds may work, but use proper ICO converter for production!');
} catch (err) {
  console.error('❌ Failed to create icon:', err.message);
  process.exit(1);
}

