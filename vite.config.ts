import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const NETWORK_FIRST_SW_SCRIPT = `// AMS Service Worker v7 (Network-First, Auto-Purge Legacy Caches)
const SW_VERSION = 'ams-sw-v7-2026-11-10-prod-sync';
const RUNTIME_CACHE = 'ams-runtime-v7';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      let deletedLegacy = false;
      for (const key of keys) {
        if (key !== RUNTIME_CACHE) {
          await caches.delete(key);
          deletedLegacy = true;
        }
      }
      await self.clients.claim();
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        client.postMessage({ type: 'AMS_SW_ACTIVATED', version: SW_VERSION, deletedLegacy });
        if (deletedLegacy && 'navigate' in client) {
          try {
            await client.navigate(client.url);
          } catch (e) {}
        }
      }
    } catch (err) {}
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js' || url.pathname === '/dev-sw.js' || url.pathname === '/registerSW.js') return;

  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(req);
      if (networkResponse && networkResponse.status === 200 && !url.pathname.startsWith('/api/')) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, networkResponse.clone()).catch(() => {});
      }
      return networkResponse;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await caches.match('/index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
`;

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'Abrar Medical Store (AMS) - POS & ERP',
          short_name: 'AMS POS',
          description:
            'Professional Medical Store Point of Sale (POS), Billing, Inventory & Accounting System for Abrar Medical Store.',
          theme_color: '#065f46',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          categories: ['business', 'finance', 'medical', 'productivity'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: [],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: null,
        },
        devOptions: {
          enabled: false,
          type: 'module',
          resolveTempFolder: () => '/tmp/ams-pwa-dev-dist',
        },
      }),
      {
        name: 'ams-network-first-sw',
        enforce: 'post',
        closeBundle() {
          try {
            const outDir = path.resolve(import.meta.dirname, 'dist');
            if (fs.existsSync(outDir)) {
              fs.writeFileSync(path.join(outDir, 'sw.js'), NETWORK_FIRST_SW_SCRIPT, 'utf8');
            }
          } catch {
            // ignore
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio preview environment to prevent WebSocket connection errors.
      hmr: false,
      watch: null,
    },
  };
});
