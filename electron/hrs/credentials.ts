import Store from 'electron-store'

type KeytarModule = typeof import('keytar')

type Schema = {
  username?: string
  password?: string
}

const store = new Store<Schema>({
  name: 'hrs-credentials'
})

const KEYTAR_SERVICE = 'hrs-desktop-hrs'
let keytarPromise: Promise<KeytarModule | null> | null = null

async function getKeytar(): Promise<KeytarModule | null> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then(mod => mod)
      .catch(() => null)
  }
  return keytarPromise
}

export async function getHrsCredentials(): Promise<{
  username: string | null
  password: string | null
}> {
  const username = store.get('username') ?? null
  if (!username) return { username: null, password: null }
  const keytar = await getKeytar()
  if (keytar) {
    try {
      const password = await keytar.getPassword(KEYTAR_SERVICE, username)
      if (password) return { username, password }
    } catch {}
  }
  return { username, password: store.get('password') ?? null }
}

export async function setHrsCredentials(username: string, password: string): Promise<void> {
  const trimmedUser = username.trim()
  const trimmedPass = password.trim()
  store.set('username', trimmedUser)
  const keytar = await getKeytar()
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, trimmedUser, trimmedPass)
      store.delete('password')
      return
    } catch {}
  }
  store.set('password', trimmedPass)
}

export async function clearHrsCredentials(): Promise<void> {
  const username = store.get('username') ?? null
  const keytar = await getKeytar()
  if (keytar && username) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, username)
    } catch {}
  }
  store.delete('username')
  store.delete('password')
}
