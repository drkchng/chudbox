import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  server: {
    // Same-origin in dev: forward API + sync WebSocket to wrangler dev.
    proxy: {
      '/api': 'http://localhost:8787',
      '/sync': {
        target: 'http://localhost:8787',
        ws: true,
      },
    },
  },
})
