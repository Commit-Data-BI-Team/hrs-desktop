import Store from 'electron-store'

type KeytarModule = typeof import('keytar')

type SupabaseSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
}

type Schema = {
  url?: string
  publishableKey?: string
  session?: SupabaseSession
}

const DEFAULT_URL = 'https://qyafofkruvflczsxhqbt.supabase.co'
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_kK0PgoUdPPovoKWd6S3MWw_2ZeKNajY'
const KEYTAR_SERVICE = 'hrs-desktop-supabase'
const KEYTAR_ACCOUNT = 'session'
const IS_E2E = process.env.HRS_E2E === '1'

const store = new Store<Schema>({
  name: 'supabase-config'
})

let keytarPromise: Promise<KeytarModule | null> | null = null

async function getKeytar(): Promise<KeytarModule | null> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then(mod => mod)
      .catch(() => null)
  }
  return keytarPromise
}

export function getSupabaseConfig() {
  return {
    url: store.get('url') ?? DEFAULT_URL,
    publishableKey: store.get('publishableKey') ?? DEFAULT_PUBLISHABLE_KEY
  }
}

export function setSupabaseConfig(url: string, publishableKey: string) {
  const trimmedUrl = url.trim().replace(/\/+$/, '')
  const trimmedKey = publishableKey.trim()
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(trimmedUrl)) {
    throw new Error('Invalid Supabase project URL')
  }
  if (!trimmedKey) {
    throw new Error('Supabase publishable key is required')
  }
  store.set('url', trimmedUrl)
  store.set('publishableKey', trimmedKey)
  return getSupabaseConfig()
}

export async function getSupabaseSession(): Promise<SupabaseSession | null> {
  // Automated HRS fixtures must never inherit a developer's real OS-keychain session.
  // Otherwise an automatic report sync can publish synthetic data to production.
  if (IS_E2E) return null
  const keytar = await getKeytar()
  if (keytar) {
    try {
      const value = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
      if (value) return JSON.parse(value) as SupabaseSession
    } catch {}
  }
  return store.get('session') ?? null
}

export async function setSupabaseSession(session: SupabaseSession | null) {
  if (IS_E2E) return
  const keytar = await getKeytar()
  if (!session) {
    if (keytar) {
      try {
        await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
      } catch {}
    }
    store.delete('session')
    return
  }

  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(session))
      store.delete('session')
      return
    } catch {}
  }
  store.set('session', session)
}

export async function clearSupabaseConfig() {
  store.clear()
  if (!IS_E2E) await setSupabaseSession(null)
}
