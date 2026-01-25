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

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <MantineProvider colorSchemeManager={colorSchemeManager} defaultColorScheme="dark">
        <App />
      </MantineProvider>
    </React.StrictMode>
  )
} catch (error) {
  console.error('[renderer] render failed', error)
  root.textContent = 'Renderer failed to start. Check console for details.'
}
