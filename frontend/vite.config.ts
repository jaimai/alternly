import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// La SPA est hébergée seule (Vercel). En dev, on proxifie /api vers le backend
// FastAPI (le site marketing, lui, se sert directement sur le backend).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      // Flux iCal de marque (/ical/…) → backend /api/ical/… (comme le proxy Vercel en prod)
      '/ical': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/ical/, '/api/ical'),
      },
    },
  },
})
