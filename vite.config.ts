import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function computeBuildHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildOfflineFirstSwScript(assetUrls: string[], buildHash: string): string {
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

  return `// AMS Service Worker v12 (Build ${buildHash} - Auto-Updating Offline-First App Shell)
const SW_VERSION = 'ams-sw-v12-${buildHash}';
const RUNTIME_CACHE = 'ams-runtime-v12-${buildHash}';
const PRECACHE_URLS = ${JSON.stringify(uniqueUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(RUNTIME_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'no-store' });
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
      const keys = await caches.keys();
      for (const key of keys) {
        if (key !== RUNTIME_CACHE) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        client.postMessage({ type: 'AMS_SW_ACTIVATED', version: SW_VERSION, buildHash: '${buildHash}' });
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
  if (
    url.pathname === '/sw.js' ||
    url.pathname === '/dev-sw.js' ||
    url.pathname === '/registerSW.js' ||
    url.pathname === '/version.json'
  ) {
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (HTML app shell for / and /salesman): Network-first with no-store so updates show immediately
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith((async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const networkRequest = new Request(req.url, {
          method: 'GET',
          headers: req.headers,
          cache: 'no-store',
          credentials: req.credentials,
          redirect: req.redirect,
        });
        const networkResponse = await fetch(networkRequest, { signal: controller.signal });
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
      const cache = await caches.open(RUNTIME_CACHE);
      const cachedExact = await cache.match(req, { ignoreSearch: true });
      if (cachedExact) return cachedExact;
      if (url.pathname.startsWith('/salesman')) {
        const cachedSalesman = await cache.match('/salesman', { ignoreSearch: true });
        if (cachedSalesman) return cachedSalesman;
      }
      const cachedIndex = await cache.match('/index.html', { ignoreSearch: true });
      if (cachedIndex) return cachedIndex;
      const cachedRoot = await cache.match('/', { ignoreSearch: true });
      if (cachedRoot) return cachedRoot;
      return new Response('Offline - App Shell Not Cached Yet', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  // Hashed static bundles (/assets/*) and icons: Cache-First (content-hashed filenames guarantee immutability)
  if (url.pathname.startsWith('/assets/') || /\\.(png|svg|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
      if (cached) {
        return cached;
      }
      const netRes = await fetch(req);
      if (netRes && netRes.status === 200) {
        cache.put(req, netRes.clone()).catch(() => {});
      }
      return netRes;
    })());
    return;
  }

  // All other same-origin GET requests: Network-First with Cache Fallback
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const networkResponse = await fetch(new Request(req, { cache: 'no-store' }));
      if (networkResponse && networkResponse.status === 200) {
        cache.put(req, networkResponse.clone()).catch(() => {});
      }
      return networkResponse;
    } catch (err) {
      const cached = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
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
              const assetsDir = path.join(outDir, 'assets');
              const assetUrls: string[] = [];
              if (fs.existsSync(assetsDir)) {
                for (const file of fs.readdirSync(assetsDir).sort()) {
                  if (/\.(js|css|woff2?|ttf|svg|png)$/i.test(file)) {
                    assetUrls.push(`/assets/${file}`);
                  }
                }
              }
              const indexHtmlPath = path.join(outDir, 'index.html');
              const indexHtmlContent = fs.existsSync(indexHtmlPath)
                ? fs.readFileSync(indexHtmlPath, 'utf8')
                : '';
              const buildHash = computeBuildHash(`${assetUrls.join('|')}::${indexHtmlContent}`);
              fs.writeFileSync(
                path.join(outDir, 'sw.js'),
                buildOfflineFirstSwScript(assetUrls, buildHash),
                'utf8'
              );
              fs.writeFileSync(
                path.join(outDir, 'version.json'),
                JSON.stringify({ buildHash, assets: assetUrls }),
                'utf8'
              );
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
