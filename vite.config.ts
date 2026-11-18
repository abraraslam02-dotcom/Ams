import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

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

  return `// AMS Service Worker v14 (Build ${buildHash} - Network-First Auto-Updating App Shell)
const SW_VERSION = 'ams-sw-v14-${buildHash}';
const RUNTIME_CACHE = 'ams-runtime-v14-${buildHash}';
const PRECACHE_URLS = ${JSON.stringify(uniqueUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(RUNTIME_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
            if (
              res &&
              res.status === 200 &&
              !res.redirected &&
              !String(res.url || '').includes('__cookie_check')
            ) {
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
    let deletedLegacyCache = false;
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        if (key !== RUNTIME_CACHE) {
          deletedLegacyCache = true;
          await caches.delete(key);
        }
      }
      await self.clients.claim();
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        try {
          client.postMessage({
            type: 'AMS_SW_ACTIVATED',
            version: SW_VERSION,
            buildHash: '${buildHash}',
            deletedLegacy: deletedLegacyCache,
          });
        } catch (e) {}
        if (deletedLegacyCache && 'navigate' in client && client.url) {
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
  if (
    url.pathname.startsWith('/__') ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/dev-sw.js' ||
    url.pathname === '/registerSW.js' ||
    url.pathname === '/version.json'
  ) {
    return;
  }

  // Navigation requests (HTML app shell): Network-first using original req so browser handles redirects/cookies natively
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(req, { cache: 'no-store' });
        if (networkResponse) {
          if (
            networkResponse.status === 200 &&
            !networkResponse.redirected &&
            !String(networkResponse.url || '').includes('__cookie_check')
          ) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, networkResponse.clone()).catch(() => {});
            cache.put('/index.html', networkResponse.clone()).catch(() => {});
            cache.put('/', networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        }
      } catch (err) {
        // Offline fallback
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
      return new Response('Offline - App Shell Not Cached Yet', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      });
    })());
    return;
  }

  // All static assets & same-origin GET requests: Network-first with offline cache fallback
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const networkResponse = await fetch(req, { cache: 'no-store' });
      if (
        networkResponse &&
        networkResponse.status === 200 &&
        !String(networkResponse.url || '').includes('__cookie_check')
      ) {
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
  const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    define: {
      __AMS_BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    plugins: [
      react(),
      tailwindcss(),
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
                JSON.stringify({ buildId: BUILD_ID, buildHash, builtAt: new Date().toISOString(), assets: assetUrls }),
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

