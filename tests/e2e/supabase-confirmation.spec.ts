import { expect, test } from '@playwright/test'
import { ensureSupabaseConfirmationServer } from '../../electron/supabase/confirmationServer'

test('serves the Supabase email-confirmation landing page on localhost', async () => {
  expect(await ensureSupabaseConfirmationServer()).toBe(true)

  const response = await fetch('http://localhost:3000')
  const body = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(body).toContain('Email confirmed')
  expect(body).toContain('Return to <strong>HRS Desktop</strong>')
})
