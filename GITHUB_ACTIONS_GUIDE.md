# 🚀 GitHub Actions Setup Guide

## ✅ What's Already Set Up

I've created two GitHub Actions workflows for you:

1. **`.github/workflows/build.yml`** - Builds releases when you tag
2. **`.github/workflows/test-build.yml`** - Tests builds on every push

---

## 🎯 Quick Start - Create Your First Release

### Step 1: Push Your Code to GitHub

```bash
cd /Users/drorr/Desktop/hrs-desktop/hrs-desktop

# If you haven't initialized git yet:
git init
git add .
git commit -m "Initial commit with GitHub Actions"

# Add your GitHub repository (replace with your repo URL):
git remote add origin https://github.com/YOUR_USERNAME/hrs-desktop.git

# Push to GitHub:
git push -u origin main
```

### Step 2: Create a Release Tag

```bash
# Update version in package.json first (e.g., to 1.0.0)
npm version 1.0.0

# Or manually edit package.json, then:
git add package.json
git commit -m "Release v1.0.0"

# Create and push the tag:
git tag v1.0.0
git push origin v1.0.0
```

### Step 3: Watch the Magic! ✨

1. Go to your GitHub repo
2. Click "Actions" tab
3. You'll see the build running automatically!
4. Wait ~10 minutes for builds to complete
5. Go to "Releases" tab
6. Your new release will have both macOS and Windows builds attached!

---

## 📦 What Happens Automatically

When you push a tag (e.g., `v1.0.0`):

1. **GitHub Actions starts two builds:**
   - 🍎 macOS runner builds Universal Binary
   - 🪟 Windows runner builds 64-bit installer

2. **Each build:**
   - Checks out your code
   - Installs Node.js 18
   - Runs `npm ci` (clean install)
   - Runs `npm run build` (builds React app)
   - Runs `electron-builder` (creates installer)
   - Uploads artifacts

3. **Creates a GitHub Release:**
   - Automatically creates release with tag name
   - Attaches all built files:
     - `HRS Desktop-1.0.0-universal.dmg` (macOS)
     - `HRS Desktop-1.0.0-arm64-mac.zip` (macOS auto-update)
     - `HRS Desktop Setup 1.0.0.exe` (Windows installer)
     - `HRS Desktop-1.0.0-portable.exe` (Windows portable)

---

## 🎮 How to Use

### Method 1: Automatic (Tag-Based Release) ⭐ Recommended

```bash
# Update version
npm version 1.0.0

# Push tag
git push origin v1.0.0

# ✅ Done! GitHub Actions builds everything automatically
```

**Result:** GitHub Release created with all installers attached

---

### Method 2: Manual Trigger (From GitHub UI)

1. Go to your repo on GitHub
2. Click "Actions" tab
3. Click "Build & Release" workflow
4. Click "Run workflow" button
5. Enter version (optional)
6. Click "Run workflow"

**Result:** Builds run, artifacts available in workflow run (not as release)

---

### Method 3: Test Build (Automatic on Push)

```bash
# Just push to main/master/develop
git push origin main

# ✅ Test builds run automatically (no release created)
```

**Result:** Verifies your code builds successfully, no release created

---

## 📊 Workflow Overview

### `build.yml` - Release Builds

**Triggers:**
- ✅ When you push a tag (e.g., `v1.0.0`)
- ✅ Manual trigger from GitHub UI

**Output:**
- macOS Universal DMG (~300 MB)
- macOS ZIP for auto-updates
- Windows 64-bit installer
- Windows portable EXE
- **Automatically creates GitHub Release**

**Build Time:** ~10-12 minutes

---

### `test-build.yml` - Test Builds

**Triggers:**
- ✅ Push to main/master/develop
- ✅ Pull requests

**Output:**
- macOS ARM64 DMG (faster than universal)
- Windows 64-bit installer
- **No release created** (just verification)

**Build Time:** ~6-8 minutes

---

## 🎯 Complete Release Process

Here's the full workflow for releasing a new version:

### 1. Prepare Release

```bash
# Make sure all changes are committed
git status

# Update version in package.json
# Edit package.json: change "version": "0.0.0" to "version": "1.0.0"

# Or use npm version command (automatically creates tag)
npm version 1.0.0

# Commit if you edited manually
git add package.json
git commit -m "Release v1.0.0"
```

### 2. Create and Push Tag

```bash
# Create tag (skip if you used npm version)
git tag v1.0.0

# Push commits and tag
git push origin main
git push origin v1.0.0
```

### 3. Monitor Build

```bash
# Option 1: Open in browser
open https://github.com/YOUR_USERNAME/hrs-desktop/actions

# Option 2: Use GitHub CLI
gh run watch
```

### 4. Download Your Builds

Once complete (10-12 minutes):

```bash
# View release
open https://github.com/YOUR_USERNAME/hrs-desktop/releases/latest

# Or download with GitHub CLI
gh release download v1.0.0
```

---

## 📁 Where to Find Your Builds

### On GitHub Releases:

1. Go to: `https://github.com/YOUR_USERNAME/hrs-desktop/releases`
2. Click on your release (e.g., "v1.0.0")
3. Scroll to "Assets" section
4. Download files:
   - `HRS-Desktop-1.0.0-universal.dmg` - For macOS users
   - `HRS-Desktop-Setup-1.0.0.exe` - For Windows users

### In GitHub Actions (Manual Runs):

1. Go to: `https://github.com/YOUR_USERNAME/hrs-desktop/actions`
2. Click on the workflow run
3. Scroll to "Artifacts" section
4. Download `macos-build` or `windows-build`

---

## 🔧 Customization

### Change When Builds Trigger

Edit `.github/workflows/build.yml`:

```yaml
on:
  push:
    tags:
      - 'v*'          # Change pattern (e.g., 'release-*')
    branches:
      - main          # Add this to build on every main push
```

### Build Different Targets

Edit the build commands:

```yaml
# For macOS ARM64 only (faster):
- name: 🍎 Build macOS
  run: npm run dist:mac:arm64

# For Windows 32-bit + 64-bit:
- name: 🪟 Build Windows
  run: npm run dist:win
```

### Change Node.js Version

```yaml
- name: 🔧 Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'  # Change to 20, 18, etc.
```

---

## 🐛 Troubleshooting

### Build fails with "npm ERR! code ELIFECYCLE"

**Solution:** Test locally first:
```bash
npm ci
npm run build
npm run dist:mac:universal
```

### "Permission denied" or "Code signing failed"

**Solution:** Already configured! The workflows use:
```yaml
mac:
  identity: null  # No code signing for open source
```

### Windows build fails

**Solution:** Check that `build/icon.ico` exists:
```bash
ls -lh build/icon.ico
```

If missing, run:
```bash
node scripts/generate-win-icon.mjs
git add build/icon.ico
git commit -m "Add Windows icon"
git push
```

### Build is too slow

**Current times:**
- macOS Universal: ~8-10 min
- Windows 64-bit: ~5-7 min

**To speed up:**
1. Use `dist:mac:arm64` instead of `universal` (50% faster)
2. Use `dist:win:x64` instead of `dist:win` (build one arch)
3. Cache node_modules (already enabled)

### Artifacts not uploaded

**Check:**
1. Workflow completed successfully?
2. `dist/` folder has files?
3. Path in workflow matches output files?

**Debug:**
Add this step before upload:
```yaml
- name: 📊 List build output
  run: |
    ls -lhR dist/
    file dist/*
```

---

## 🎁 What Users Get

### Share Your Release

Once build completes, share this URL:
```
https://github.com/YOUR_USERNAME/hrs-desktop/releases/latest
```

Users can:
1. Click "Assets" dropdown
2. Download for their platform:
   - macOS: `.dmg` file
   - Windows: `.exe` file
3. Install and run!

### Download Stats

GitHub tracks downloads:
- Go to release page
- See download count next to each file
- Track which platform is most popular

---

## 🚀 Advanced: Auto-Updates

Want to add auto-updates? The workflow already creates the necessary files:

1. **macOS:** `.zip` files for auto-updates
2. **Windows:** Can use `.exe` with electron-updater

See: https://www.electron.build/auto-update

---

## 📋 Checklist for First Release

- [ ] Code pushed to GitHub
- [ ] `.github/workflows/build.yml` exists
- [ ] `build/icon.icns` exists (macOS)
- [ ] `build/icon.ico` exists (Windows)
- [ ] Version updated in `package.json`
- [ ] Tag created: `git tag v1.0.0`
- [ ] Tag pushed: `git push origin v1.0.0`
- [ ] Actions tab shows build running
- [ ] Wait ~10 minutes
- [ ] Check Releases tab for new release
- [ ] Download and test installers

---

## 🎯 Quick Command Reference

```bash
# Create new release
npm version 1.0.0
git push origin main
git push origin v1.0.0

# Watch build progress
gh run watch

# Download latest release
gh release download

# List all releases
gh release list

# Create release notes
gh release create v1.0.0 --generate-notes

# Manual trigger workflow
gh workflow run build.yml
```

---

## ✨ You're All Set!

Your GitHub Actions workflows are ready! Just push a tag and let the magic happen:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Then watch your builds at:
```
https://github.com/YOUR_USERNAME/hrs-desktop/actions
```

🎉 **In 10 minutes, you'll have production-ready installers for macOS and Windows!**

---

## 📚 More Resources

- **GitHub Actions Docs:** https://docs.github.com/en/actions
- **electron-builder CI:** https://www.electron.build/multi-platform-build
- **GitHub CLI:** https://cli.github.com/

**Questions?** Check the Actions tab for build logs and error messages!

