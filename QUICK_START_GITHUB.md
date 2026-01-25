# 🚀 Quick Start - GitHub Actions

## ✅ What I've Set Up For You

✨ **GitHub Actions workflows are ready!** They will automatically build your app for macOS and Windows.

---

## 🎯 Steps to Get Started (5 minutes)

### Step 1: Create GitHub Repository

1. Go to: https://github.com/new
2. Name: `hrs-desktop` (or whatever you want)
3. Make it **Private** (recommended for internal tools)
4. **Don't** initialize with README (you already have files)
5. Click "Create repository"

---

### Step 2: Push Your Code

GitHub will show you commands. Use these:

```bash
cd /Users/drorr/Desktop/hrs-desktop/hrs-desktop

# Initialize git (if not already done)
git init

# Add all files
git add .

# First commit
git commit -m "Initial commit with GitHub Actions"

# Add your GitHub repository (REPLACE with your actual URL!)
git remote add origin https://github.com/YOUR_USERNAME/hrs-desktop.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username!**

---

### Step 3: Create Your First Release

```bash
# Option A: Use npm version (automatically updates package.json and creates tag)
npm version 1.0.0
git push origin main
git push origin v1.0.0

# Option B: Manual version update
# 1. Edit package.json: change "version": "0.0.0" to "version": "1.0.0"
# 2. Then:
git add package.json
git commit -m "Release v1.0.0"
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

---

### Step 4: Watch the Build! 🎬

```bash
# Open GitHub Actions in browser
open https://github.com/YOUR_USERNAME/hrs-desktop/actions
```

You'll see:
- 🍎 **macOS build** - Building universal binary
- 🪟 **Windows build** - Building 64-bit installer

**Build time:** ~10 minutes

---

### Step 5: Download Your Apps! 🎉

Once complete:

```bash
# Open releases page
open https://github.com/YOUR_USERNAME/hrs-desktop/releases
```

You'll find:
- ✅ `HRS Desktop-1.0.0-universal.dmg` - macOS installer
- ✅ `HRS Desktop Setup 1.0.0.exe` - Windows installer
- ✅ `HRS Desktop-1.0.0-portable.exe` - Windows portable
- ✅ `.zip` files - For auto-updates

---

## 📋 Complete Command Sequence

Here's everything in one block (copy-paste):

```bash
# Navigate to project
cd /Users/drorr/Desktop/hrs-desktop/hrs-desktop

# Initialize git
git init
git add .
git commit -m "Initial commit with GitHub Actions"

# Add remote (REPLACE YOUR_USERNAME!)
git remote add origin https://github.com/YOUR_USERNAME/hrs-desktop.git

# Push to GitHub
git branch -M main
git push -u origin main

# Create and push release tag
npm version 1.0.0
git push origin main
git push origin v1.0.0

# Open GitHub to watch
open https://github.com/YOUR_USERNAME/hrs-desktop/actions
```

---

## 🎯 What Happens Automatically

When you push `v1.0.0`:

1. **GitHub Actions starts:**
   - Runner 1 (macOS): Builds universal DMG
   - Runner 2 (Windows): Builds installer + portable

2. **Each runner:**
   - ✅ Installs Node.js 18
   - ✅ Runs `npm ci` (clean install)
   - ✅ Runs `npm run build` (React app)
   - ✅ Runs `electron-builder` (creates installer)
   - ✅ Uploads to GitHub Release

3. **Result:**
   - New release "v1.0.0" created
   - All installers attached
   - Ready to download and share!

---

## 📱 Workflow Files Created

I've created these files:

```
.github/
└── workflows/
    ├── build.yml          ← Builds releases when you tag
    └── test-build.yml     ← Tests builds on every push
```

### `build.yml` - Release Workflow

**Triggers:**
- ✅ When you push a tag (e.g., `v1.0.0`)
- ✅ Manual trigger from GitHub UI

**Creates:**
- GitHub Release with all installers attached

---

### `test-build.yml` - Test Workflow

**Triggers:**
- ✅ Every push to main/master/develop
- ✅ Every pull request

**Purpose:**
- Verifies your code builds successfully
- No release created

---

## 🎮 Future Releases

After your first release, creating new ones is easy:

```bash
# Update version
npm version 1.1.0

# Push
git push origin main
git push origin v1.1.0

# ✅ Done! GitHub builds everything automatically
```

---

## 🔍 Monitoring Builds

### View in Browser:
```bash
open https://github.com/YOUR_USERNAME/hrs-desktop/actions
```

### Using GitHub CLI (optional):
```bash
# Install GitHub CLI
brew install gh

# Authenticate
gh auth login

# Watch build progress
gh run watch

# List releases
gh release list

# Download latest
gh release download
```

---

## 🐛 If Something Goes Wrong

### Build fails?

1. **Check logs:**
   - Go to Actions tab
   - Click on failed workflow
   - Expand failed step
   - Read error message

2. **Common issues:**
   - Missing dependencies: Check `package.json`
   - Build errors: Test locally first: `npm run dist:mac:universal`
   - Icon missing: Ensure `build/icon.icns` and `build/icon.ico` exist

3. **Test locally first:**
   ```bash
   npm ci
   npm run build
   npm run dist:mac:universal
   ```

---

### Can't push to GitHub?

```bash
# Check remote
git remote -v

# Should show your GitHub URL
# If not, add it:
git remote add origin https://github.com/YOUR_USERNAME/hrs-desktop.git

# Try push again
git push -u origin main
```

---

### Tag already exists?

```bash
# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin :refs/tags/v1.0.0

# Create new tag
git tag v1.0.0
git push origin v1.0.0
```

---

## 📚 Documentation Files

I've created these guides for you:

1. **`QUICK_START_GITHUB.md`** ← You are here!
2. **`GITHUB_ACTIONS_GUIDE.md`** - Complete reference
3. **`BUILD_GUIDE.md`** - Local build instructions
4. **`QUICK_BUILD.md`** - Quick local build reference

---

## ✨ You're Ready!

**Next steps:**

1. ✅ Create GitHub repository
2. ✅ Push your code
3. ✅ Create a tag (e.g., `v1.0.0`)
4. ✅ Watch GitHub Actions build
5. ✅ Download installers from Releases
6. ✅ Share with users!

---

## 🎁 What Users See

Share this URL with users:
```
https://github.com/YOUR_USERNAME/hrs-desktop/releases/latest
```

They'll see:
- Professional release page
- Download buttons for macOS and Windows
- Release notes (you can add these)
- Download counts

---

## 🚀 Let's Do This!

Ready to create your GitHub repository?

1. Go to: https://github.com/new
2. Name it `hrs-desktop`
3. Click "Create repository"
4. Copy the commands GitHub shows you
5. Run them in your terminal

**In 15 minutes, you'll have automated builds for both platforms!** 🎉

---

**Questions?** See `GITHUB_ACTIONS_GUIDE.md` for complete documentation!

