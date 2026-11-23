import { useState } from 'react'
import { Alert, Badge, Button, Group, PasswordInput, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'

type Props = {
  username: string
  hasPassword: boolean
  ready: boolean
  onCommit: (username: string, password: string) => Promise<void>
}

// Only the explicit Save action publishes the draft to preferences and meeting sync.
export function MeetingsAccessForm({ username, hasPassword, ready, onCommit }: Props) {
  const saved = Boolean(username && hasPassword)
  const [draft, setDraft] = useState<{ username: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const value = draft ?? { username, password: '' }
  async function commit(name: string, password: string) {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      await onCommit(name, password)
      setDraft(null)
    } catch {
      setError('Could not save the change. Your existing meeting credentials have not been replaced.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack gap="xs" role="group" aria-label="Meetings access">
      <Group justify="space-between">
        <Text fw={700} size="sm">Meetings access</Text>
        <Badge color={saved ? 'blue' : 'gray'} variant="light">
          {saved ? 'Credentials saved' : 'Not configured'}
        </Badge>
      </Group>
      {saved && !draft ? (
        <Group justify="space-between" gap="xs">
          <Text size="xs" c="dimmed">{username}</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" disabled={!ready || busy}
              onClick={() => { setError(''); setDraft({ username, password: '' }) }}>Edit</Button>
            <Button size="xs" variant="subtle" color="red" disabled={!ready || busy}
              onClick={() => void commit('', '')}>Disconnect</Button>
          </Group>
        </Group>
      ) : (
        <form onSubmit={event => {
          event.preventDefault()
          if (value.username.trim() && value.password) void commit(value.username.trim(), value.password)
        }}>
          <Stack gap="xs">
            <SimpleGrid cols={2} spacing="xs">
              <TextInput label="Username" placeholder="you@company.com" autoComplete="username"
                maxLength={200} disabled={!ready || busy} value={value.username}
                onChange={event => setDraft({ ...value, username: event.currentTarget.value })} />
              <PasswordInput label="Password" autoComplete="current-password" maxLength={300}
                disabled={!ready || busy} value={value.password}
                onChange={event => setDraft({ ...value, password: event.currentTarget.value })} />
            </SimpleGrid>
            <Text size="xs" c="dimmed">Microsoft checks these credentials when you sync meetings.</Text>
            <Group justify="flex-end">
              {draft && <Button type="button" size="xs" variant="subtle" disabled={busy}
                onClick={() => { setError(''); setDraft(null) }}>Cancel</Button>}
              <Button type="submit" size="xs" loading={busy}
                disabled={!ready || !value.username.trim() || !value.password}>Save credentials</Button>
            </Group>
          </Stack>
        </form>
      )}
      {error && <Alert color="red" role="alert">{error}</Alert>}
    </Stack>
  )
}
