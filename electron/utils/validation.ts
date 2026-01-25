/**
 * Input validation and sanitization utilities for IPC handlers
 */

/**
 * Sanitize string input by removing dangerous characters
 */
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid input: expected string')
  }
  
  // Remove null bytes and control characters
  return input
    .replace(/\0/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
}

/**
 * Validate email format
 */
export function validateEmail(email: unknown): string {
  if (typeof email !== 'string') {
    throw new Error('Invalid email: must be a string')
  }
  
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  const clean = sanitizeString(email)
  
  if (!emailRegex.test(clean)) {
    throw new Error('Invalid email format')
  }
  
  return clean
}

/**
 * Validate URL and ensure it's from allowed domains
 */
export function validateUrl(url: unknown, allowedDomains: string[]): string {
  if (typeof url !== 'string') {
    throw new Error('Invalid URL: must be a string')
  }
  
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL format')
  }
  
  // Check protocol
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL protocol: only HTTP(S) allowed')
  }
  
  // Check domain
  const isAllowed = allowedDomains.some(domain => 
    parsed.hostname === domain || 
    parsed.hostname.endsWith('.' + domain)
  )
  
  if (!isAllowed) {
    throw new Error(`URL domain not allowed: ${parsed.hostname}`)
  }
  
  return url
}

/**
 * Validate Jira issue key format (e.g., PROJECT-123)
 */
export function validateJiraIssueKey(key: unknown): string {
  if (typeof key !== 'string') {
    throw new Error('Invalid issue key: must be a string')
  }
  
  const clean = sanitizeString(key)
  const jiraKeyRegex = /^[A-Z][A-Z0-9_]{0,9}-[0-9]+$/
  
  if (!jiraKeyRegex.test(clean)) {
    throw new Error('Invalid Jira issue key format')
  }
  
  return clean
}

/**
 * Validate date string (YYYY-MM-DD)
 */
export function validateDate(date: unknown): string {
  if (typeof date !== 'string') {
    throw new Error('Invalid date: must be a string')
  }
  
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  const clean = sanitizeString(date)
  
  if (!dateRegex.test(clean)) {
    throw new Error('Invalid date format: expected YYYY-MM-DD')
  }
  
  // Verify it's a valid date
  const parsedDate = new Date(clean)
  if (isNaN(parsedDate.getTime())) {
    throw new Error('Invalid date value')
  }
  
  return clean
}

/**
 * Validate positive integer
 */
export function validatePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid value: must be a positive integer')
  }
  return value
}

/**
 * Validate non-negative integer
 */
export function validateNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Invalid value: must be a non-negative integer')
  }
  return value
}

/**
 * Validate object doesn't contain dangerous keys (prototype pollution prevention)
 */
export function validateSafeObject<T extends Record<string, unknown>>(obj: unknown): T {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('Invalid input: expected object')
  }
  
  const dangerousKeys = ['__proto__', 'constructor', 'prototype']
  const keys = Object.keys(obj)
  
  for (const key of keys) {
    if (dangerousKeys.includes(key)) {
      throw new Error(`Dangerous key detected: ${key}`)
    }
  }
  
  return obj as T
}

/**
 * Validate array of specific type
 */
export function validateArray<T>(
  arr: unknown,
  validator: (item: unknown) => T
): T[] {
  if (!Array.isArray(arr)) {
    throw new Error('Invalid input: expected array')
  }
  
  return arr.map((item, index) => {
    try {
      return validator(item)
    } catch (error) {
      throw new Error(`Invalid array item at index ${index}: ${error}`)
    }
  })
}

/**
 * Validate string length
 */
export function validateStringLength(
  str: unknown,
  minLength: number,
  maxLength: number
): string {
  if (typeof str !== 'string') {
    throw new Error('Invalid input: expected string')
  }
  
  const clean = sanitizeString(str)
  
  if (clean.length < minLength) {
    throw new Error(`String too short: minimum ${minLength} characters`)
  }
  
  if (clean.length > maxLength) {
    throw new Error(`String too long: maximum ${maxLength} characters`)
  }
  
  return clean
}

/**
 * Wrapper for IPC handlers with validation
 */
export function secureIpcHandler<T extends unknown[], R>(
  handler: (...args: T) => Promise<R> | R,
  validator?: (args: unknown[]) => T
) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<R> => {
    try {
      // Validate args if validator provided
      const validatedArgs = validator ? validator(args) : (args as T)
      
      // Call handler
      return await handler(...validatedArgs)
    } catch (error) {
      // Log security-relevant errors
      if (error instanceof Error) {
        console.error('[security] IPC handler error:', error.message)
      }
      throw error
    }
  }
}

