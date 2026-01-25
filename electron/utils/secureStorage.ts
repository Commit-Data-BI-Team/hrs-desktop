import { safeStorage } from 'electron'
import Store from 'electron-store'

const encryptedStore = new Store({
  name: 'secure-credentials',
  encryptionKey: 'hrs-desktop-v1' // App-specific encryption key
})

/**
 * Store a credential securely using Electron's safeStorage API
 * This uses the OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service)
 */
export function setSecureCredential(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[security] OS encryption not available, falling back to encrypted store')
    // Fallback: still store encrypted, just not using OS keychain
    encryptedStore.set(key, value)
    return
  }
  
  try {
    const encrypted = safeStorage.encryptString(value)
    encryptedStore.set(key, encrypted.toString('base64'))
    console.log('[security] Credential stored securely:', key)
  } catch (error) {
    console.error('[security] Failed to encrypt credential:', error)
    throw new Error('Failed to store credential securely')
  }
}

/**
 * Retrieve a securely stored credential
 */
export function getSecureCredential(key: string): string | null {
  const encrypted = encryptedStore.get(key)
  
  if (!encrypted || typeof encrypted !== 'string') {
    return null
  }
  
  if (!safeStorage.isEncryptionAvailable()) {
    // Was stored without OS encryption
    return encrypted
  }
  
  try {
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('[security] Failed to decrypt credential:', error)
    // Might be an old unencrypted value
    return typeof encrypted === 'string' ? encrypted : null
  }
}

/**
 * Delete a securely stored credential
 */
export function deleteSecureCredential(key: string): void {
  encryptedStore.delete(key)
  console.log('[security] Credential deleted:', key)
}

/**
 * Check if a credential exists
 */
export function hasSecureCredential(key: string): boolean {
  return encryptedStore.has(key)
}

/**
 * Clear all secure credentials (use with caution!)
 */
export function clearAllSecureCredentials(): void {
  encryptedStore.clear()
  console.warn('[security] All credentials cleared')
}

/**
 * Migrate from plain-text storage to secure storage
 */
export function migratePlainToSecure(
  plainStore: Store,
  keys: string[]
): { migrated: number; failed: string[] } {
  const failed: string[] = []
  let migrated = 0
  
  for (const key of keys) {
    try {
      const value = plainStore.get(key)
      if (value && typeof value === 'string') {
        setSecureCredential(key, value)
        plainStore.delete(key) // Remove from plain storage
        migrated++
      }
    } catch (error) {
      console.error(`[security] Failed to migrate ${key}:`, error)
      failed.push(key)
    }
  }
  
  console.log(`[security] Migration complete: ${migrated} migrated, ${failed.length} failed`)
  return { migrated, failed }
}

