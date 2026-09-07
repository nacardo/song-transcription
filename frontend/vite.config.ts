import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so 127.0.0.1 (required by Spotify OAuth) and
    // your phone on the LAN can both reach the dev server.
    host: true,
    port: 5173,
    // Forward /api/* to the FastAPI backend so the frontend keeps its
    // single-origin story and never has to think about CORS.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
