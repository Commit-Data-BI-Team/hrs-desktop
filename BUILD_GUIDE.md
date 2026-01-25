# 📦 Building HRS Desktop for macOS and Windows

## 🎯 Quick Start

### Build for macOS (Current Platform)
```bash
npm run dist:mac
```

### Build for Windows (Cross-Platform)
```bash
npm run dist:win
```

### Build for Both Platforms
```bash
npm run dist:all
```

---

## 📋 Prerequisites

### For macOS Builds (on macOS):
- ✅ macOS 10.13 or higher
- ✅ Xcode Command Line Tools: `xcode-select --install`
- ✅ Node.js 18+ installed
- ✅ npm dependencies: `npm install`

### For Windows Builds (on macOS):
- ✅ Wine (for cross-platform building):
  ```bash
  brew install --cask wine-stable
  ```
- ✅ Mono (for Windows code signing):
  ```bash
  brew install mono
  ```

### For Windows Builds (on Windows):
- ✅ Windows 10 or higher
- ✅ Node.js 18+ installed
- ✅ Visual Studio Build Tools or Visual Studio with C++ workload

---

## 🚀 Build Commands

### macOS Builds

#### Universal Binary (Intel + Apple Silicon):
```bash
npm run dist:mac:universal
```
**Output:** `dist/HRS Desktop-0.0.0-universal.dmg` (works on both Intel and M1/M2/M3 Macs)

#### Apple Silicon Only (M1/M2/M3):
```bash
npm run dist:mac:arm64
```
**Output:** `dist/HRS Desktop-0.0.0-arm64.dmg` (smaller file size, M-series only)

#### Intel Only:
```bash
npm run dist:mac:x64
```
**Output:** `dist/HRS Desktop-0.0.0-x64.dmg` (Intel Macs only)

#### Both Architectures (Separate Files):
```bash
npm run dist:mac
```
**Output:** 
- `dist/HRS Desktop-0.0.0-arm64.dmg`
- `dist/HRS Desktop-0.0.0-x64.dmg`
- `dist/HRS Desktop-0.0.0-arm64-mac.zip`
- `dist/HRS Desktop-0.0.0-mac.zip`

---

### Windows Builds

#### 64-bit Windows (Recommended):
```bash
npm run dist:win:x64
```
**Output:** 
- `dist/HRS Desktop Setup 0.0.0.exe` (Installer)
- `dist/HRS Desktop-0.0.0-portable.exe` (Portable, no install)

#### 32-bit Windows:
```bash
npm run dist:win:ia32
```
**Output:** `dist/HRS Desktop Setup 0.0.0-ia32.exe`

#### Both (32-bit + 64-bit):
```bash
npm run dist:win
```
**Output:**
- `dist/HRS Desktop Setup 0.0.0.exe` (64-bit installer)
- `dist/HRS Desktop Setup 0.0.0-ia32.exe` (32-bit installer)
- `dist/HRS Desktop-0.0.0-portable.exe` (64-bit portable)

---

## 📁 Output Files Explained

### macOS Files:

| File | Description | Size | Recommended For |
|------|-------------|------|----------------|
| `.dmg` | macOS disk image installer | ~150-200 MB | Distribution to users |
| `-universal.dmg` | Works on Intel + Apple Silicon | ~300 MB | Best compatibility |
| `-arm64.dmg` | Apple Silicon only | ~150 MB | M1/M2/M3 Macs |
| `-x64.dmg` | Intel Macs only | ~150 MB | Older Intel Macs |
| `.zip` | Compressed app bundle | ~100-150 MB | Auto-updates |

### Windows Files:

| File | Description | Size | Recommended For |
|------|-------------|------|----------------|
| `Setup.exe` | NSIS installer | ~120-150 MB | Standard distribution |
| `-portable.exe` | No installation needed | ~120-150 MB | USB drives, testing |
| `-ia32.exe` | 32-bit installer | ~100-120 MB | Older Windows systems |

---

## 🔧 Build Configuration

### Current Settings (package.json):

**macOS:**
- ✅ DMG + ZIP outputs
- ✅ Intel (x64) + Apple Silicon (arm64)
- ✅ Category: Productivity
- ✅ Code signing: Disabled (for development)

**Windows:**
- ✅ NSIS installer (customizable)
- ✅ Portable executable
- ✅ 64-bit + 32-bit support
- ✅ Desktop + Start Menu shortcuts

---

## 🎨 Required Assets

### macOS Icon (`.icns`):
```bash
# Generate from PNG (if you have a PNG icon):
npm run icon:mac

# Manual: Place icon at:
build/icon.icns
```

### Windows Icon (`.ico`):
You need a Windows icon file:
```
build/icon.ico
```

**Create from PNG:**
```bash
# Using ImageMagick (install: brew install imagemagick)
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

**Or use online converter:**
- https://convertio.co/png-ico/
- https://icoconvert.com/

### Windows Installer Header (Optional):
```
build/installerHeader.bmp
Size: 150x57 pixels
```

---

## 🔐 Code Signing (Optional, for Distribution)

### macOS Code Signing:

1. **Get Apple Developer Certificate:**
   - Join Apple Developer Program ($99/year)
   - Download "Developer ID Application" certificate

2. **Update package.json:**
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Name (TEAM_ID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": false
   }
   ```

3. **Build with signing:**
   ```bash
   npm run dist:mac
   ```

4. **Notarize (Required for macOS 10.15+):**
   ```bash
   npx notarize-cli --file dist/HRS\ Desktop-0.0.0.dmg \
     --bundle-id com.b4db1r3.hrsdesktop \
     --username your@apple.id \
     --password @keychain:AC_PASSWORD
   ```

### Windows Code Signing:

1. **Get Code Signing Certificate:**
   - Purchase from DigiCert, Sectigo, etc.
   - Or use self-signed for internal distribution

2. **Update package.json:**
   ```json
   "win": {
     "certificateFile": "path/to/certificate.pfx",
     "certificatePassword": "your-password",
     "signingHashAlgorithms": ["sha256"],
     "sign": "./custom-sign.js"
   }
   ```

3. **Build with signing:**
   ```bash
   npm run dist:win
   ```

---

## 🧪 Testing Builds

### macOS:
```bash
# Build
npm run dist:mac:universal

# Install and test
open dist/HRS\ Desktop-0.0.0-universal.dmg

# Drag to Applications, then open
```

### Windows (on macOS with Wine):
```bash
# Build
npm run dist:win:x64

# Test with Wine (optional)
wine dist/HRS\ Desktop-0.0.0-portable.exe
```

### Windows (on actual Windows):
```bash
# Build
npm run dist:win

# Install
dist\HRS Desktop Setup 0.0.0.exe

# Or run portable
dist\HRS Desktop-0.0.0-portable.exe
```

---

## 📦 Distribution Checklist

Before distributing your app:

- [ ] Update version in `package.json`
- [ ] Test on clean macOS system
- [ ] Test on clean Windows system
- [ ] Verify all features work
- [ ] Check app launches on both platforms
- [ ] Verify credentials are stored securely
- [ ] Test auto-updates (if implemented)
- [ ] Create release notes
- [ ] Upload to distribution server
- [ ] Generate checksums (SHA256)

---

## 🐛 Troubleshooting

### "Cannot find module" errors:
```bash
# Clean and rebuild
rm -rf node_modules dist dist-electron dist-renderer
npm install
npm run build
npm run dist:mac
```

### "Code signing failed" on macOS:
```bash
# Disable code signing for development
# In package.json:
"mac": {
  "identity": null
}
```

### "Wine not found" on macOS:
```bash
# Install Wine
brew install --cask wine-stable

# Or use Windows machine for Windows builds
```

### Large file size:
```bash
# Options:
# 1. Build for specific architecture only (not universal)
npm run dist:mac:arm64  # Smaller than universal

# 2. Use ASAR compression (already enabled by default)

# 3. Analyze bundle size
npx electron-builder build --dir
du -sh dist/mac/*.app
```

### Windows build fails on macOS:
```bash
# Option 1: Install Wine properly
brew install --cask wine-stable
brew install mono

# Option 2: Use actual Windows machine
# Copy project to Windows and run:
npm install
npm run dist:win

# Option 3: Use GitHub Actions (CI/CD)
```

---

## 🚀 Automated Builds (CI/CD)

### GitHub Actions (Recommended):

Create `.github/workflows/build.yml`:
```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npm run dist:mac:universal
      - uses: actions/upload-artifact@v3
        with:
          name: mac-build
          path: dist/*.dmg

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npm run dist:win
      - uses: actions/upload-artifact@v3
        with:
          name: windows-build
          path: dist/*.exe
```

---

## 📊 Build Times

Typical build times on M1 MacBook Pro:

| Build Type | Time | Output Size |
|------------|------|-------------|
| `dist:mac:arm64` | ~2-3 min | ~150 MB |
| `dist:mac:x64` | ~2-3 min | ~150 MB |
| `dist:mac:universal` | ~4-5 min | ~300 MB |
| `dist:win:x64` | ~3-4 min | ~130 MB |
| `dist:all` | ~6-8 min | ~500 MB total |

---

## 📝 Version Management

### Update Version:
```bash
# Update package.json version
npm version patch  # 0.0.0 -> 0.0.1
npm version minor  # 0.0.1 -> 0.1.0
npm version major  # 0.1.0 -> 1.0.0

# Then build
npm run dist:all
```

### Version in Filename:
Output files automatically include version:
- `HRS Desktop-0.0.0-universal.dmg`
- `HRS Desktop Setup 0.0.0.exe`

---

## 🎯 Quick Reference

**Most Common Commands:**

```bash
# Development
npm run dev                    # Run in dev mode

# Build for your platform
npm run dist:mac              # macOS (Intel + Apple Silicon)
npm run dist:win              # Windows (64-bit + 32-bit)

# Build universal (best compatibility)
npm run dist:mac:universal    # macOS Universal Binary

# Build for distribution
npm run dist:all              # All platforms
```

**Output Location:**
- All builds go to: `dist/`
- macOS: `.dmg` and `.zip` files
- Windows: `.exe` files

---

**Need Help?**
- electron-builder docs: https://www.electron.build/
- Troubleshooting: Check logs in `dist/builder-debug.yml`
- File size issues: Use architecture-specific builds

**Ready to distribute?** ✅
Your app is now ready to be built and distributed for both macOS and Windows!

