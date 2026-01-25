# 🚀 Quick Build Guide - HRS Desktop

## TL;DR - Build Now!

### For macOS (Universal - works on all Macs):
```bash
npm run dist:mac:universal
```
**Output:** `dist/HRS Desktop-0.0.0-universal.dmg` (~300 MB)

### For Windows (64-bit):
```bash
npm run dist:win:x64
```
**Output:** 
- `dist/HRS Desktop Setup 0.0.0.exe` (Installer)
- `dist/HRS Desktop-0.0.0-portable.exe` (No install needed)

### For Both:
```bash
npm run dist:all
```

---

## 📍 You Are Here (macOS)

You're on a Mac, so:

✅ **macOS builds will work perfectly**
⚠️ **Windows builds will work but might need Wine**

### Option 1: Build for macOS Only (Recommended)
```bash
npm run dist:mac:universal
```

### Option 2: Build for Windows (needs Wine)
```bash
# Install Wine first (one-time setup):
brew install --cask wine-stable

# Then build:
npm run dist:win:x64
```

### Option 3: Use a Windows machine or VM for Windows builds
- Copy your project to Windows
- Run: `npm install && npm run dist:win`

---

## 📦 Where Are My Built Apps?

All builds go to the `dist/` folder:

```
dist/
  ├── HRS Desktop-0.0.0-universal.dmg     ← macOS installer
  ├── HRS Desktop-0.0.0-arm64-mac.zip     ← macOS auto-update
  ├── HRS Desktop Setup 0.0.0.exe         ← Windows installer
  └── HRS Desktop-0.0.0-portable.exe      ← Windows portable
```

---

## 🎯 Most Common Builds

### 1. For Your Mac (Apple Silicon or Intel):
```bash
npm run dist:mac:universal
```
**Best for:** Distribution to all Mac users

### 2. For Smaller macOS Build (Apple Silicon only):
```bash
npm run dist:mac:arm64
```
**Best for:** M1/M2/M3 Macs only (half the size)

### 3. For Windows Users:
```bash
npm run dist:win:x64
```
**Best for:** Modern Windows 10/11 (64-bit)

### 4. Build Everything:
```bash
npm run dist:all
```
**Best for:** Release day - build all platforms at once

---

## ⚡ First Time Build

1. **Make sure dependencies are installed:**
```bash
npm install
```

2. **Build the app first:**
```bash
npm run build
```

3. **Then create installer:**
```bash
npm run dist:mac:universal
```

Or use the combined command that does it all:
```bash
npm run dist:mac:universal  # This runs 'npm run build' automatically
```

---

## 🧪 Test Your Build

### macOS:
```bash
# Build
npm run dist:mac:universal

# Open the DMG
open dist/HRS\ Desktop-0.0.0-universal.dmg

# Drag app to Applications
# Then open from Applications folder
```

### Windows:
```bash
# Build
npm run dist:win:x64

# Copy to Windows machine and run:
dist/HRS Desktop Setup 0.0.0.exe
```

---

## 🔧 Troubleshooting

### "ENOENT: no such file or directory"
```bash
# Clean and rebuild:
rm -rf node_modules dist dist-electron dist-renderer
npm install
npm run dist:mac:universal
```

### Build is slow
- Universal builds take longer (~5 min)
- Use `dist:mac:arm64` for faster builds on M-series Macs

### Windows build fails
- Install Wine: `brew install --cask wine-stable`
- Or use actual Windows machine

### Icon missing on Windows build
- Use https://convertio.co/png-ico/ to convert `build/icon.png` to `build/icon.ico`
- Current placeholder might work but won't look as good

---

## 📋 Build Command Reference

| Command | Output | Size | Time |
|---------|--------|------|------|
| `dist:mac:universal` | Universal DMG | ~300 MB | ~5 min |
| `dist:mac:arm64` | Apple Silicon DMG | ~150 MB | ~3 min |
| `dist:mac:x64` | Intel DMG | ~150 MB | ~3 min |
| `dist:win:x64` | Windows 64-bit | ~130 MB | ~4 min |
| `dist:win:ia32` | Windows 32-bit | ~110 MB | ~4 min |
| `dist:all` | All platforms | ~500 MB | ~8 min |

---

## 🎁 What You Get

### macOS DMG File:
- Double-click to mount
- Drag app to Applications
- Eject DMG
- Open from Applications

### Windows EXE Installer:
- Double-click to install
- Follow wizard
- Creates desktop shortcut
- Creates Start Menu entry

### Windows Portable EXE:
- Double-click to run
- No installation needed
- Great for USB drives

---

## 🚀 Ready to Build?

**For most users, start with:**
```bash
npm run dist:mac:universal
```

This creates a DMG that works on **all Macs** (Intel and Apple Silicon).

Your built app will be at:
```
dist/HRS Desktop-0.0.0-universal.dmg
```

**That's it!** 🎉

---

For full documentation, see `BUILD_GUIDE.md`

