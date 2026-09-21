import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: '\\.test\\.tsx?$' }),
    react(),
    tailwindcss(),
    VitePWA({
      // Manifest + icons only (spec §11: installable, no offline mode). The self-destroying worker
      // unregisters itself and clears caches on clients that still hold the earlier precaching worker,
      // whose cache-first index.html kept serving a stale build until the browser's own update check.
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'GigHunter',
        short_name: 'GigHunter',
        description: 'Your evening-gig radar',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/jobs',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5173 },
})
