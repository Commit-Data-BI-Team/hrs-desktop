import { Button, Paper, Title, Text, Stack } from '@mantine/core'

type Props = {
  onLogin: () => void
}

export default function Login({ onLogin }: Props) {
  return (
    <Paper p="xl" withBorder maw={420} mx="auto">
      <Stack>
        <Title order={3}>Login to HRS</Title>

        <Text c="dimmed" size="sm">
          You will be redirected to the official HRS login page.
        </Text>

        <Button
          size="md"
          onClick={() => {
            console.log('[ui] login clicked')
            onLogin()
          }}
        >
          Login
        </Button>
      </Stack>
    </Paper>
  )
}