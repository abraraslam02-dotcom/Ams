import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function buildOfflineFirstSwScript(assetUrls: string[]): string {
  const baseUrls = [
    '/',
    '/index.html',
    '/salesman',
    '/manifest.json',
    '/salesman-manifest.json',
    '/pwa-192x192.png',
    '/pwa-512x512.png',
    '/pwa-maskable-512x512.png',
    '/apple-touch-icon.png',
    '/icon.svg',
    ...assetUrls,
  ];
  const uniqueUrls = Array.from(new Set(baseUrls));

  return `// AMS Service Worker v10 (Complete Offline-First Desktop & Mobile App Shell + Fresh Sync)
const SW_VERSION = 'ams-sw-v10-fresh-start';
const RUNTIME_CACHE = 'ams-runtime-v10';
const PRECACHE_URLS = ${JSON.stringify(uniqueUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(RUNTIME_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && res.status === 200) {
              await cache.put(url, res.clone());
            }
          } catch (e) {}
        })
      );
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const targetCache = await caches.open(RUNTIME_CACHE);
      const keys = await caches.keys();
      for (const key of keys) {
        if (key !== RUNTIME_CACHE && key.startsWith('ams-runtime-')) {
          try {
            // Migrate any cached assets from previous runtime cache before deleting it so offline updates never lose assets
            const oldCache = await caches.open(key);
            const oldReqs = await oldCache.keys();
            for (const oldReq of oldReqs) {
              const existing = await targetCache.match(oldReq);
              if (!existing) {
                const oldRes = await oldCache.match(oldReq);
                if (oldRes) await targetCache.put(oldReq, oldRes.clone());
              }
            }
          } catch (e) {}
          await caches.delete(key);
        }
      }
      await self.clients.claim();
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        client.postMessage({ type: 'AMS_SW_ACTIVATED', version: SW_VERSION, deletedLegacy: false });
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
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (HTML app shell for / and /salesman): Network-first with fast fallback to cached app shell
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith((async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const networkResponse = await fetch(req, { signal: controller.signal });
        clearTimeout(timer);
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, networkResponse.clone()).catch(() => {});
          cache.put('/index.html', networkResponse.clone()).catch(() => {});
          cache.put('/', networkResponse.clone()).catch(() => {});
          return networkResponse;
        }
      } catch (err) {
        // Offline or network timeout -> fall back to cached HTML shell
      }
      const cachedExact = await caches.match(req, { ignoreSearch: true });
      if (cachedExact) return cachedExact;
      if (url.pathname.startsWith('/salesman')) {
        const cachedSalesman = await caches.match('/salesman', { ignoreSearch: true });
        if (cachedSalesman) return cachedSalesman;
      }
      const cachedIndex = await caches.match('/index.html', { ignoreSearch: true });
      if (cachedIndex) return cachedIndex;
      const cachedRoot = await caches.match('/', { ignoreSearch: true });
      if (cachedRoot) return cachedRoot;
      return new Response('Offline - App Shell Not Cached Yet', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  // Hashed static bundles (/assets/*) and icons: Cache-First with background refresh
  if (url.pathname.startsWith('/assets/') || /\\.(png|svg|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
      if (cached) {
        fetch(req)
          .then(async (netRes) => {
            if (netRes && netRes.status === 200) {
              const cache = await caches.open(RUNTIME_CACHE);
              await cache.put(req, netRes.clone());
            }
          })
          .catch(() => {});
        return cached;
      }
      const netRes = await fetch(req);
      if (netRes && netRes.status === 200) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, netRes.clone()).catch(() => {});
      }
      return netRes;
    })());
    return;
  }

  // All other same-origin GET requests (including Vite dev modules /src/*, /node_modules/*, manifests): Network-First with Cache Fallback
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(req);
      if (networkResponse && networkResponse.status === 200) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, networkResponse.clone()).catch(() => {});
      }
      return networkResponse;
    } catch (err) {
      const cached = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
      if (cached) return cached;
      throw err;
    }
  })());
});
`;
}

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
          short_name: 'AMS ERP',
          description:
            'Offline-First Desktop Point of Sale (POS), Billing, Inventory & Accounting System for Abrar Medical Store.',
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
          cleanupOutdatedCaches: false,
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
              const assetsDir = path.join(outDir, 'assets');
              const assetUrls: string[] = [];
              if (fs.existsSync(assetsDir)) {
                for (const file of fs.readdirSync(assetsDir)) {
                  if (/\.(js|css|woff2?|ttf|svg|png)$/i.test(file)) {
                    assetUrls.push(`/assets/${file}`);
                  }
                }
              }
              fs.writeFileSync(path.join(outDir, 'sw.js'), buildOfflineFirstSwScript(assetUrls), 'utf8');
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
