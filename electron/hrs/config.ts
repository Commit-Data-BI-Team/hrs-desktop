import Store from 'electron-store'

type Schema = {
  customAuth?: string
}

const store = new Store<Schema>({
  name: 'hrs-config'
})

export function getCustomAuth(): string | null {
  return store.get('customAuth') ?? null
}

export function setCustomAuth(token: string): void {
  store.set('customAuth', token.trim())
}

export function clearCustomAuth(): void {
  store.delete('customAuth')
}