import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  // Use relative paths for Chrome extension compatibility
  base: '',
  resolve: {
    alias: {
      '@shared-extension': path.resolve(__dirname, '../../packages/shared-extension/src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@optimandoai/code-block-library': path.resolve(__dirname, '../../packages/code-block-library/src'),
    }
  },
  build: {
    rollupOptions: {
      input: {
        'popup-chat': path.resolve(__dirname, 'src/popup-chat.html')
      }
    }
  }
})
