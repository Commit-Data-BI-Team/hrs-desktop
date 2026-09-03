import http, { type IncomingMessage, type ServerResponse } from 'node:http'

export const SUPABASE_CONFIRMATION_REDIRECT_URL = 'http://localhost:3000'

let confirmationServer: http.Server | null = null
let confirmationServerPromise: Promise<boolean> | null = null

function isLocalRequest(request: IncomingMessage) {
  const rawHost = String(request.headers.host || '').toLowerCase()
  const closingBracket = rawHost.indexOf(']')
  const host = rawHost.startsWith('[') && closingBracket > 0
    ? rawHost.slice(1, closingBracket)
    : rawHost.split(':')[0]
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function sendConfirmationPage(response: ServerResponse, headOnly: boolean) {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HRS Desktop · Email confirmed</title>
    <style>
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #071015; color: #f4fbff; }
      main { width: min(520px, calc(100vw - 48px)); padding: 36px; border: 1px solid #25404b; border-radius: 20px; background: #0d1a20; box-shadow: 0 24px 80px #0009; }
      .mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; background: #24b47e; color: #04140e; font-size: 28px; font-weight: 900; }
      h1 { margin: 22px 0 10px; font-size: 26px; }
      p { margin: 0; color: #b8c9d1; line-height: 1.55; }
      strong { color: #fff; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">✓</div>
      <h1>Email confirmed</h1>
      <p>Return to <strong>HRS Desktop</strong> and press <strong>Sign in</strong>. You can close this browser tab.</p>
    </main>
  </body>
</html>`
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  })
  response.end(headOnly ? undefined : body)
}

function handleConfirmationRequest(request: IncomingMessage, response: ServerResponse) {
  if (!isLocalRequest(request)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Local requests only')
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' })
    response.end()
    return
  }
  sendConfirmationPage(response, request.method === 'HEAD')
}

function listenForConfirmations(host: string) {
  return new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer(handleConfirmationRequest)
    server.once('error', reject)
    server.listen({ host, port: 3000 }, () => {
      server.removeListener('error', reject)
      server.unref()
      resolve(server)
    })
  })
}

export function ensureSupabaseConfirmationServer(): Promise<boolean> {
  if (confirmationServer?.listening) return Promise.resolve(true)
  if (confirmationServerPromise) return confirmationServerPromise

  confirmationServerPromise = (async () => {
    try {
      confirmationServer = await listenForConfirmations('localhost')
      return true
    } catch (firstError) {
      const code = (firstError as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        console.warn('[supabase] localhost:3000 is already in use; confirmation landing page unavailable')
        return false
      }
      try {
        confirmationServer = await listenForConfirmations('127.0.0.1')
        return true
      } catch (fallbackError) {
        console.warn('[supabase] failed to start confirmation landing page', fallbackError)
        return false
      }
    }
  })().finally(() => {
    confirmationServerPromise = null
  })

  return confirmationServerPromise
}
