import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// La SPA est hébergée seule (Vercel). En dev, on proxifie /api vers le backend
// FastAPI (le site marketing, lui, se sert directement sur le backend).
// Cible du proxy de dev surchargeable (ex. API_PROXY_TARGET=http://localhost:8001).
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
      // Flux iCal de marque (/ical/…) → backend /api/ical/… (comme le proxy Vercel en prod)
      '/ical': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/ical/, '/api/ical'),
      },
    },
  },
})
