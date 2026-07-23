import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    // L'app React vit sous /app/ (servie par Vite, avec HMR).
    // Les routes marketing (landing, blog, SEO) sont rendues par FastAPI :
    // on les proxifie pour retrouver en dev l'origine unique de la prod.
    proxy: {
      '/api': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
      '^/$': 'http://localhost:8000',
      '^/blog': 'http://localhost:8000',
      '^/robots.txt$': 'http://localhost:8000',
      '^/sitemap.xml$': 'http://localhost:8000',
    },
  },
})
