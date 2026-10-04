import { defineConfig } from 'vite'
import type { PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import posthog from '@posthog/rollup-plugin'

// La SPA est hébergée seule (Vercel). En dev, on proxifie /api vers le backend
// FastAPI (le site marketing, lui, se sert directement sur le backend).
// Cible du proxy de dev surchargeable (ex. API_PROXY_TARGET=http://localhost:8001).
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:8000'

// Source maps → PostHog (suivi d'erreurs lisible) : seulement au build Vercel quand
// POSTHOG_SOURCEMAPS_API_KEY est défini (clé personnelle « error tracking write »).
// Les .map sont envoyées puis supprimées : jamais servies publiquement.
const sourcemapsKey = process.env.POSTHOG_SOURCEMAPS_API_KEY
const plugins: PluginOption[] = [react()]
if (sourcemapsKey) {
  plugins.push(
    posthog({
      personalApiKey: sourcemapsKey,
      projectId: process.env.POSTHOG_PROJECT_ID || '285303',
      host: 'https://eu.posthog.com',
      sourcemaps: {
        enabled: true,
        releaseName: 'alternly-app',
        releaseVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
        deleteAfterUpload: true,
      },
    }) as PluginOption,
  )
}

export default defineConfig({
  plugins,
  build: { sourcemap: sourcemapsKey ? 'hidden' : false },
  server: {
    proxy: {
      '/api': apiTarget,
      // Flux iCal de marque (/ical/…) → backend /api/ical/… (comme le proxy Vercel en prod)
      '/ical': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/ical/, '/api/ical'),
      },
      // PostHog (comme le proxy Vercel en prod) : utile seulement avec VITE_POSTHOG_KEY en dev.
      '/ingest/static': {
        target: 'https://eu-assets.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
      '/ingest': {
        target: 'https://eu.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
    },
  },
})
