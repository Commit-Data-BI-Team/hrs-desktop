import { Button, Paper, Title, Text, Group } from '@mantine/core'

export function Connect({ onConnected }: { onConnected: () => void }) {
  return (
    <Paper p="md" withBorder>
      <Title order={4}>Connect to HRS</Title>
      <Text size="sm" c="dimmed" mt={6}>
        Login using the official admin page. The app will capture the key automatically.
      </Text>

      <Group mt="md">
        <Button
          onClick={async () => {
            await window.hrs.connectViaAdminLogin()
            onConnected()
          }}
        >
          Login
        </Button>
      </Group>
    </Paper>
  )
}
