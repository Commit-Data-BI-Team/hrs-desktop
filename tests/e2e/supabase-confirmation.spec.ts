import { expect, test } from '@playwright/test'
import { listenForConfirmations, SUPABASE_CONFIRMATION_REDIRECT_URL } from '../../electron/supabase/confirmationServer'

test('serves the Supabase email-confirmation landing page on localhost', async () => {
  expect(SUPABASE_CONFIRMATION_REDIRECT_URL).toBe('http://localhost:3000')
  const server = await listenForConfirmations('127.0.0.1',0)
  try {
  const address = server.address()
  if (!address || typeof address==='string') throw Error('No loopback port')
  const response = await fetch('http://127.0.0.1:'+address.port)
  const body = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(body).toContain('Email confirmed')
  expect(body).toContain('Return to <strong>HRS Desktop</strong>')
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())) }
})
