import Store from 'electron-store'

type KeytarModule = typeof import('keytar')

type Schema = {
  model?: string
  apiKey?: string
}

const store = new Store<Schema>({
  name: 'agenda-ai-config'
})

const KEYTAR_SERVICE = 'hrs-desktop-agenda-ai'
const KEYTAR_ACCOUNT = 'openai-api-key'
const DEFAULT_MODEL = 'gpt-4o-mini'
let keytarPromise: Promise<KeytarModule | null> | null = null

async function getKeytar(): Promise<KeytarModule | null> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then(mod => mod)
      .catch(() => null)
  }
  return keytarPromise
}

async function getStoredApiKey() {
  const keytar = await getKeytar()
  if (keytar) {
    try {
      const value = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
      if (value) return value
    } catch {}
  }
  return store.get('apiKey') ?? null
}

async function setStoredApiKey(apiKey: string) {
  const trimmed = apiKey.trim()
  const keytar = await getKeytar()
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, trimmed)
      store.delete('apiKey')
      return
    } catch {}
  }
  store.set('apiKey', trimmed)
}

async function clearStoredApiKey() {
  const keytar = await getKeytar()
  if (keytar) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
    } catch {}
  }
  store.delete('apiKey')
}

export async function getAgendaAiConfig() {
  const apiKey = await getStoredApiKey()
  return {
    apiKey,
    model: store.get('model') ?? DEFAULT_MODEL
  }
}

export async function setAgendaAiConfig(apiKey: string | null, model: string | null) {
  if (apiKey !== null) {
    if (apiKey.trim()) {
      await setStoredApiKey(apiKey)
    } else {
      await clearStoredApiKey()
    }
  }
  if (model !== null) {
    const trimmedModel = model.trim()
    if (trimmedModel) {
      store.set('model', trimmedModel)
    } else {
      store.delete('model')
    }
  }
  return getAgendaAiConfig()
}

export async function clearAgendaAiConfig() {
  await clearStoredApiKey()
  store.delete('model')
}
