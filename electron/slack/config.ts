import Store from 'electron-store'

type KeytarModule = typeof import('keytar')

export type SlackChannelMapping = {
  customerName: string
  channelId: string
  channelName: string
  updatedAt: string
}

type Schema = {
  botToken?: string
  mappings?: Record<string, SlackChannelMapping>
}

const store = new Store<Schema>({
  name: 'slack-config'
})

const KEYTAR_SERVICE = 'hrs-desktop-slack'
const KEYTAR_ACCOUNT = 'bot-token'
let keytarPromise: Promise<KeytarModule | null> | null = null

function nowIso() {
  return new Date().toISOString()
}

async function getKeytar(): Promise<KeytarModule | null> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then(mod => mod)
      .catch(() => null)
  }
  return keytarPromise
}

async function getStoredBotToken() {
  const keytar = await getKeytar()
  if (keytar) {
    try {
      const token = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
      if (token) return token
    } catch {}
  }
  return store.get('botToken') ?? null
}

async function setStoredBotToken(token: string) {
  const trimmed = token.trim()
  const keytar = await getKeytar()
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, trimmed)
      store.delete('botToken')
      return
    } catch {}
  }
  store.set('botToken', trimmed)
}

async function clearStoredBotToken() {
  const keytar = await getKeytar()
  if (keytar) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
    } catch {}
  }
  store.delete('botToken')
}

export async function getSlackBotToken() {
  return getStoredBotToken()
}

export async function setSlackBotToken(token: string) {
  await setStoredBotToken(token)
  return getSlackConfigStatus()
}

export async function clearSlackConfig() {
  await clearStoredBotToken()
  return getSlackConfigStatus()
}

export function getSlackChannelMappings(): Record<string, SlackChannelMapping> {
  return store.get('mappings') ?? {}
}

export function setSlackChannelMapping(
  customerName: string,
  channelId: string,
  channelName: string
) {
  const customer = customerName.trim()
  const mappings = getSlackChannelMappings()
  mappings[customer] = {
    customerName: customer,
    channelId: channelId.trim(),
    channelName: channelName.trim(),
    updatedAt: nowIso()
  }
  store.set('mappings', mappings)
  return mappings[customer]
}

export function removeSlackChannelMapping(customerName: string) {
  const customer = customerName.trim()
  const mappings = getSlackChannelMappings()
  delete mappings[customer]
  store.set('mappings', mappings)
  return mappings
}

export async function getSlackConfigStatus() {
  const token = await getStoredBotToken()
  return {
    configured: Boolean(token),
    hasToken: Boolean(token),
    mappings: getSlackChannelMappings()
  }
}
