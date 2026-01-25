import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron'
    }
  },

  preload: {
    build: {
      outDir: 'dist-electron'
    }
  },

  renderer: {
    root: '.',
    build: {
      outDir: 'dist'
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    }
  }
})