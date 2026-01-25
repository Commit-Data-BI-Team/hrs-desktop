import Store from 'electron-store'

type KeytarModule = typeof import('keytar')

type JiraMappings = Record<string, string>

type Schema = {
  baseUrl?: string
  email?: string
  token?: string
  mappings?: JiraMappings
}

const store = new Store<Schema>({
  name: 'jira-config'
})

const DEFAULT_BASE_URL = 'https://commit.atlassian.net'
const KEYTAR_SERVICE = 'hrs-desktop-jira'
let keytarPromise: Promise<KeytarModule | null> | null = null

async function getKeytar(): Promise<KeytarModule | null> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then(mod => mod)
      .catch(() => null)
  }
  return keytarPromise
}

async function getStoredToken(email: string | null, baseUrl: string) {
  if (!email) return null
  const keytar = await getKeytar()
  if (keytar) {
    try {
      const token = await keytar.getPassword(KEYTAR_SERVICE, `${baseUrl}:${email}`)
      if (token) return token
    } catch {}
  }
  return store.get('token') ?? null
}

async function setStoredToken(email: string, baseUrl: string, token: string) {
  const keytar = await getKeytar()
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, `${baseUrl}:${email}`, token)
      store.delete('token')
      return
    } catch {}
  }
  store.set('token', token)
}

async function clearStoredToken(email: string | null, baseUrl: string) {
  const keytar = await getKeytar()
  if (keytar && email) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, `${baseUrl}:${email}`)
    } catch {}
  }
  store.delete('token')
}

export async function getJiraCredentials() {
  const baseUrl = store.get('baseUrl') ?? DEFAULT_BASE_URL
  const email = store.get('email') ?? null
  const token = await getStoredToken(email, baseUrl)
  return {
    baseUrl,
    email,
    token
  }
}

export async function setJiraCredentials(
  email: string,
  token: string,
  baseUrl = DEFAULT_BASE_URL
): Promise<void> {
  const trimmedEmail = email.trim()
  const trimmedUrl = baseUrl.trim()
  store.set('email', trimmedEmail)
  store.set('baseUrl', trimmedUrl)
  await setStoredToken(trimmedEmail, trimmedUrl, token.trim())
}

export async function clearJiraCredentials(): Promise<void> {
  const baseUrl = store.get('baseUrl') ?? DEFAULT_BASE_URL
  const email = store.get('email') ?? null
  store.delete('email')
  await clearStoredToken(email, baseUrl)
}

export function getJiraMappings(): JiraMappings {
  return store.get('mappings') ?? {}
}

export function setJiraMapping(customer: string, epicKey: string | null): JiraMappings {
  const mappings = getJiraMappings()
  if (epicKey) {
    mappings[customer] = epicKey
  } else {
    delete mappings[customer]
  }
  store.set('mappings', mappings)
  return mappings
}
