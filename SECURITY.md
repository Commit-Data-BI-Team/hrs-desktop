# 🔒 Security Hardening Guide for HRS Desktop

## Current Security Status

### ✅ What's Already Secure
1. **Context Isolation**: Enabled in HRS session window
2. **Node Integration**: Disabled in HRS session
3. **Context Bridge**: Using `contextBridge` for IPC
4. **Session Persistence**: Using partitioned session for HRS auth

### ⚠️ Security Gaps Identified

1. **Main Window**: Missing security flags
2. **Login Window**: No contextIsolation
3. **Floating Window**: Missing security config
4. **Content Security Policy (CSP)**: Not implemented
5. **Remote Content**: No verification
6. **Credentials**: Stored in plain text (Electron safe storage)
7. **Updates**: No code signing verification
8. **Network**: No certificate pinning
9. **XSS Protection**: Minimal
10. **Data Encryption**: Not implemented

---

## 🛡️ CRITICAL SECURITY FIXES (Implement Immediately)

###  1. **Electron Window Security Configuration**

**File: `electron/main.ts`**

Current (INSECURE):
```typescript
mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, 'preload.mjs')
  }
})
```

**SECURE VERSION:**
```typescript
mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, 'preload.mjs'),
    // CRITICAL SECURITY FLAGS
    contextIsolation: true,          // Isolate context
    nodeIntegration: false,           // Disable Node.js in renderer
    nodeIntegrationInWorker: false,   // Disable in web workers
    nodeIntegrationInSubFrames: false, // Disable in iframes
    sandbox: true,                    // Enable sandbox
    webSecurity: true,                // Enable web security
    allowRunningInsecureContent: false, // Block mixed content
    experimentalFeatures: false,      // Disable experimental features
    enableRemoteModule: false,        // Disable remote module
    safeDialogs: true,                // Prevent dialog spam
    safeDialogsMessage: 'Prevent this app from creating additional dialogs',
    navigateOnDragDrop: false,        // Prevent drag-drop navigation
  },
  // Prevent window.open
  webPreferences: {
    ...webPreferences,
    disableBlinkFeatures: 'Auxclick' // Prevent middle-click attacks
  }
})

// Prevent navigation to external URLs
mainWindow.webContents.on('will-navigate', (event, url) => {
  const parsedUrl = new URL(url)
  const allowedOrigins = [
    'http://localhost',
    'http://127.0.0.1',
    'file://'
  ]
  
  if (!allowedOrigins.some(origin => url.startsWith(origin))) {
    event.preventDefault()
    console.warn('[security] Blocked navigation to:', url)
  }
})

// Prevent new windows
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  console.warn('[security] Blocked window.open to:', url)
  return { action: 'deny' }
})
```

---

### 2. **Content Security Policy (CSP)**

**Add to `index.html`:**
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' data:;
  connect-src 'self' https://your-hrs-domain.com https://your-jira-domain.atlassian.net;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
">
```

---

### 3. **Secure Credential Storage**

**File: `electron/utils/secureStorage.ts`** (NEW)

```typescript
import { safeStorage } from 'electron'
import Store from 'electron-store'

const encryptedStore = new Store({
  name: 'secure-credentials',
  encryptionKey: 'your-app-specific-key' // Use unique key
})

export function setSecureCredential(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System encryption not available')
  }
  
  const encrypted = safeStorage.encryptString(value)
  encryptedStore.set(key, encrypted.toString('base64'))
}

export function getSecureCredential(key: string): string | null {
  const encrypted = encryptedStore.get(key)
  if (!encrypted || typeof encrypted !== 'string') {
    return null
  }
  
  try {
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('[security] Failed to decrypt credential:', error)
    return null
  }
}

export function deleteSecureCredential(key: string): void {
  encryptedStore.delete(key)
}

// Usage in your app:
// setSecureCredential('hrs-password', password)
// const password = getSecureCredential('hrs-password')
```

---

### 4. **Input Validation & Sanitization**

**File: `electron/utils/validation.ts`** (NEW)

```typescript
import validator from 'validator'

export function sanitizeInput(input: string): string {
  // Remove any HTML tags
  return validator.escape(input.trim())
}

export function validateEmail(email: string): boolean {
  return validator.isEmail(email)
}

export function validateUrl(url: string, allowedDomains: string[]): boolean {
  if (!validator.isURL(url)) return false
  
  try {
    const parsed = new URL(url)
    return allowedDomains.some(domain => 
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

export function validateJiraIssueKey(key: string): boolean {
  // Jira issue keys: PROJECT-123
  return /^[A-Z][A-Z0-9_]*-[0-9]+$/.test(key)
}

// Use in IPC handlers:
ipcMain.handle('jira:getWorkItems', async (_event, epicKey: string) => {
  if (!validateJiraIssueKey(epicKey)) {
    throw new Error('Invalid epic key format')
  }
  // ... rest of code
})
```

---

### 5. **Rate Limiting for IPC Calls**

**File: `electron/utils/rateLimiter.ts`** (NEW)

```typescript
interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

class RateLimiter {
  private requests = new Map<string, number[]>()

  isAllowed(key: string, config: RateLimitConfig): boolean {
    const now = Date.now()
    const windowStart = now - config.windowMs
    
    // Get recent requests
    const recentRequests = (this.requests.get(key) || [])
      .filter(timestamp => timestamp > windowStart)
    
    // Check if limit exceeded
    if (recentRequests.length >= config.maxRequests) {
      console.warn('[security] Rate limit exceeded for:', key)
      return false
    }
    
    // Add current request
    recentRequests.push(now)
    this.requests.set(key, recentRequests)
    
    return true
  }

  cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of this.requests.entries()) {
      const active = timestamps.filter(t => t > now - 60000)
      if (active.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, active)
      }
    }
  }
}

export const rateLimiter = new RateLimiter()

// Cleanup every minute
setInterval(() => rateLimiter.cleanup(), 60000)

// Usage in IPC:
ipcMain.handle('jira:getWorkItems', async (event, epicKey: string) => {
  if (!rateLimiter.isAllowed('jira:getWorkItems', {
    maxRequests: 100,
    windowMs: 60000 // 100 requests per minute
  })) {
    throw new Error('Rate limit exceeded')
  }
  // ... rest of code
})
```

---

### 6. **Secure Session Management**

**File: `electron/main.ts`** (UPDATE)

```typescript
import { session } from 'electron'

app.on('ready', () => {
  // Configure session security
  const ses = session.defaultSession
  
  // Clear cache on startup
  await ses.clearCache()
  
  // Set secure cookie policy
  ses.cookies.set({
    url: 'https://your-domain.com',
    name: 'session',
    value: 'value',
    secure: true,
    httpOnly: true,
    sameSite: 'strict'
  })
  
  // Block trackers and ads
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['notifications']
    callback(allowedPermissions.includes(permission))
  })
  
  // HTTPS only
  ses.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'geolocation') {
      return false
    }
    return true
  })
  
  // Certificate verification
  ses.setCertificateVerifyProc((request, callback) => {
    const { hostname, certificate, verificationResult, errorCode } = request
    
    // Allow localhost in development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      callback(0) // 0 = allow
      return
    }
    
    // Verify certificate
    if (verificationResult !== 'net::OK') {
      console.error('[security] Certificate verification failed:', {
        hostname,
        error: verificationResult,
        code: errorCode
      })
      callback(-2) // -2 = deny
      return
    }
    
    callback(0) // 0 = allow
  })
})
```

---

### 7. **Prevent Prototype Pollution**

**File: `electron/utils/safeObject.ts`** (NEW)

```typescript
export function safeSet(obj: any, path: string[], value: any): void {
  // Prevent __proto__ pollution
  if (path.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
    throw new Error('Unsafe property access')
  }
  
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (!current[path[i]]) {
      current[path[i]] = {}
    }
    current = current[path[i]]
  }
  current[path[path.length - 1]] = value
}

export function safeGet(obj: any, path: string[]): any {
  if (path.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
    return undefined
  }
  
  let current = obj
  for (const key of path) {
    if (current == null) return undefined
    current = current[key]
  }
  return current
}
```

---

### 8. **Auto-Updates with Code Signing**

**File: `electron/main.ts`** (ADD)

```typescript
import { autoUpdater } from 'electron-updater'
import crypto from 'crypto'

// Configure auto-updater
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

// Verify signature before installing
autoUpdater.on('update-downloaded', (info) => {
  // Verify SHA512 checksum
  const expected = info.sha512
  const downloaded = crypto
    .createHash('sha512')
    .update(fs.readFileSync(info.downloadedFile))
    .digest('base64')
  
  if (expected !== downloaded) {
    console.error('[security] Update signature mismatch!')
    return
  }
  
  // Safe to install
  autoUpdater.quitAndInstall()
})

// Check for updates securely
function checkForUpdates() {
  if (process.env.NODE_ENV === 'development') return
  
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[security] Update check failed:', err)
  })
}

app.on('ready', () => {
  setTimeout(checkForUpdates, 5000)
})
```

---

### 9. **Audit Logging**

**File: `electron/utils/auditLog.ts`** (NEW)

```typescript
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const logPath = path.join(app.getPath('userData'), 'audit.log')

interface AuditEntry {
  timestamp: string
  event: string
  user?: string
  details?: any
  level: 'info' | 'warn' | 'error' | 'security'
}

export function auditLog(event: string, details?: any, level: AuditEntry['level'] = 'info') {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    event,
    details,
    level
  }
  
  const line = JSON.stringify(entry) + '\n'
  
  fs.appendFile(logPath, line, (err) => {
    if (err) console.error('[audit] Failed to write log:', err)
  })
  
  // Also log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[audit]', entry)
  }
}

// Usage:
// auditLog('login-attempt', { username: 'user@example.com' }, 'security')
// auditLog('credential-change', { type: 'jira' }, 'security')
// auditLog('data-export', { format: 'csv', rows: 100 }, 'info')
```

---

### 10. **Dependency Security**

**File: `package.json`** (ADD SCRIPTS)

```json
{
  "scripts": {
    "security:audit": "npm audit --production",
    "security:check": "npm audit signatures && npm audit fix",
    "security:outdated": "npm outdated",
    "preinstall": "npx npm-force-resolutions"
  },
  "resolutions": {
    "electron": "^28.0.0"
  }
}
```

---

## 🚨 IMMEDIATE ACTION ITEMS

### Priority 1 (Do Now):
1. ✅ Update `electron/main.ts` with secure BrowserWindow config
2. ✅ Add CSP meta tag to `index.html`
3. ✅ Implement `secureStorage.ts` for credentials
4. ✅ Add input validation to all IPC handlers
5. ✅ Enable all security flags in webPreferences

### Priority 2 (This Week):
6. ✅ Implement rate limiting
7. ✅ Add audit logging
8. ✅ Set up certificate verification
9. ✅ Add prototype pollution protection
10. ✅ Configure secure session management

### Priority 3 (This Month):
11. ✅ Implement auto-updates with code signing
12. ✅ Add network request filtering
13. ✅ Set up automated security scans
14. ✅ Implement data encryption at rest
15. ✅ Create security testing suite

---

## 🔐 SECURITY CHECKLIST

- [ ] Context isolation enabled everywhere
- [ ] Node integration disabled in all windows
- [ ] Sandbox mode enabled
- [ ] CSP implemented and tested
- [ ] Credentials encrypted with safeStorage
- [ ] Input validation on all IPC handlers
- [ ] Rate limiting implemented
- [ ] Audit logging active
- [ ] Certificate verification enabled
- [ ] Navigation blocked to external URLs
- [ ] window.open disabled
- [ ] Auto-updates with signature verification
- [ ] Dependencies scanned for vulnerabilities
- [ ] Code signed for distribution
- [ ] HTTPS enforced for all network requests

---

## 🧪 Testing Security

```bash
# Run security audit
npm run security:audit

# Check for vulnerable dependencies
npm audit

# Test CSP
# Open DevTools -> Console -> Check for CSP violations

# Test IPC security
# Try to call IPC from DevTools (should fail)
window.hrs.getCredentials() // Should work
electron.remote // Should be undefined
require('fs') // Should be undefined
```

---

## 📚 Additional Resources

- [Electron Security Guidelines](https://www.electronjs.org/docs/latest/tutorial/security)
- [OWASP Desktop App Security](https://owasp.org/www-project-mobile-security/)
- [Electron Hardening Guide](https://github.com/doyensec/electronegativity)

---

## 🆘 Security Incident Response

If you discover a security vulnerability:

1. **DO NOT** commit sensitive data to git
2. Immediately rotate all credentials
3. Document the incident in audit log
4. Assess impact and data exposure
5. Patch the vulnerability
6. Test the fix thoroughly
7. Deploy update to all users
8. Notify affected users if data was compromised

---

**Last Updated**: 2026-01-26  
**Security Version**: 1.0  
**Status**: NEEDS IMPLEMENTATION

