import React from 'react'
import ReactDOM from 'react-dom/client'
import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import './index.css'
import App from './App'

console.log('[renderer] main.tsx starting')

let colorSchemeManager: ReturnType<typeof localStorageColorSchemeManager> | undefined
try {
  colorSchemeManager = localStorageColorSchemeManager({
    key: 'hrs-color-scheme'
  })
} catch (error) {
  console.error('[renderer] color scheme manager failed', error)
}

window.addEventListener('error', event => {
  console.error('[renderer] window error', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', event => {
  console.error('[renderer] unhandled rejection', event.reason)
})

console.log('[renderer] main.tsx loaded')

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown) {
    console.error('[renderer] app render crash', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            color: '#dbe8ef',
            background: 'linear-gradient(180deg, rgba(18,26,32,0.95), rgba(10,16,20,0.98))',
            fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
            textAlign: 'center'
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: '8px' }}>App failed to render</div>
            <div style={{ opacity: 0.8, fontSize: '0.9rem' }}>
              Restart app. If this repeats, share log from `/tmp/hrs-desktop-main.log`.
            </div>
            {this.state.message ? (
              <div style={{ opacity: 0.7, fontSize: '0.8rem', marginTop: '8px' }}>
                {this.state.message}
              </div>
            ) : null}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <MantineProvider colorSchemeManager={colorSchemeManager} defaultColorScheme="dark">
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </MantineProvider>
    </React.StrictMode>
  )
} catch (error) {
  console.error('[renderer] render failed', error)
  root.textContent = 'Renderer failed to start. Check console for details.'
}
