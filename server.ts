import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './server/config.ts';
import { systemRouter } from './server/routes/system.ts';
import { itemsRouter } from './server/routes/items.ts';
import { accountsRouter } from './server/routes/accounts.ts';
import { purchasesRouter } from './server/routes/purchases.ts';
import { salesRouter } from './server/routes/sales.ts';
import { authRouter } from './server/routes/auth.ts';
import { inventoryRouter } from './server/routes/inventory.ts';
import { accountingRouter } from './server/routes/accounting.ts';
import { staffRouter } from './server/routes/staff.ts';
import { whatsappRouter } from './server/routes/whatsapp.ts';
import { syncRouter } from './server/routes/sync.ts';
import { cashBookRouter } from './server/routes/cashBook.ts';
import { supplyRouter } from './server/routes/supply.ts';
import { enhancementsRouter } from './server/routes/enhancements.ts';
import { closingRouter } from './server/routes/closing.ts';
import { payrollRouter } from './server/routes/payroll.ts';
import { authenticateToken, enforceModulePermissions } from './server/middleware/authMiddleware.ts';
import { runMigrations } from './server/db/migrations.ts';
import { checkDatabaseConnection, getDatabase } from './server/db/connection.ts';
import { ensureAuthTables } from './server/services/authService.ts';
import { ensureDailyAutomaticBackup } from './server/services/backupService.ts';
import {
  initCloudPersistence,
  syncDatabaseToCloudSQL,
  cloudPersistenceMiddleware,
} from './server/services/cloudPersistenceService.ts';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50mb' }));

  const distPath = path.resolve(process.cwd(), 'dist');
  const distIndexHtml = path.resolve(distPath, 'index.html');
  const serveStaticDist = process.env.NODE_ENV === 'production' || fs.existsSync(distIndexHtml);

  console.log('----------------------------------------------------');
  console.log(' [AMS] Abrar Medical Store - System Initializing...');
  console.log(` [AMS] Environment: ${config.nodeEnv} (Static Dist: ${serveStaticDist ? 'YES' : 'NO'})`);
  console.log(` [AMS] Port: ${config.port}`);
  console.log(` [AMS] Currency: ${config.appCurrency} (${config.appCurrencySymbol})`);
  console.log(` [AMS] Timezone: ${config.appTimezone} (${config.appTimezoneOffset})`);
  console.log('----------------------------------------------------');

  // Verify local SQLite database synchronously (<15ms) so server starts immediately
  try {
    const migration = runMigrations();
    console.log(`[AMS DB] ${migration.message}`);
    ensureAuthTables(getDatabase());

    const connectionTest = checkDatabaseConnection();
    console.log(`[AMS DB] Connection verification: ${connectionTest.connected ? 'SUCCESS' : 'FAILED'}`);
    console.log(`[AMS DB] Storage: ${connectionTest.databasePath} (${connectionTest.fileSizeBytes} bytes)`);
    console.log(`[AMS DB] Journal Mode: ${connectionTest.journalMode}, Foreign Keys: ${connectionTest.foreignKeysEnabled}`);
    console.log(`[AMS DB] Verified Tables: ${connectionTest.tables.length} tables active and ready`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AMS DB ERROR] Migration or connection failed: ${errorMsg}`);
  }

  // Synchronize all API operations with permanent Cloud SQL database across Dev, Published, Computer & Mobile
  app.use('/api', cloudPersistenceMiddleware);

  // Mount API routes with server-side authentication and module RBAC enforcement
  app.use('/api/auth', authRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/items', authenticateToken, enforceModulePermissions('items'), itemsRouter);
  app.use('/api/accounts', authenticateToken, enforceModulePermissions('accounts'), accountsRouter);
  app.use('/api/purchases', authenticateToken, enforceModulePermissions('purchases'), purchasesRouter);
  app.use('/api/sales', authenticateToken, enforceModulePermissions('sales'), salesRouter);
  app.use('/api/staff', authenticateToken, enforceModulePermissions('sales'), staffRouter);
  app.use('/api/inventory', authenticateToken, enforceModulePermissions('inventory'), inventoryRouter);
  app.use('/api/accounting', authenticateToken, enforceModulePermissions('accounting'), accountingRouter);
  app.use('/api/whatsapp', authenticateToken, enforceModulePermissions('sales'), whatsappRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/cash-book', cashBookRouter);
  app.use('/api/supply', authenticateToken, enforceModulePermissions('supply'), supplyRouter);
  app.use('/api/closing', authenticateToken, enforceModulePermissions('closing'), closingRouter);
  app.use('/api/payroll', authenticateToken, enforceModulePermissions('payroll'), payrollRouter);
  app.use('/api/enhancements', enhancementsRouter);

  // Prevent browser/proxy HTTP caching on HTML shell and Service Worker scripts
  app.use((req, res, next) => {
    if (
      req.path === '/' ||
      req.path === '/salesman' ||
      req.path === '/salesman/' ||
      req.path === '/index.html' ||
      req.path === '/sw.js' ||
      req.path === '/dev-sw.js' ||
      req.path === '/registerSW.js' ||
      req.path === '/manifest.json' ||
      req.path === '/salesman-manifest.json' ||
      req.path === '/manifest.webmanifest'
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  const desktopManifestPayload = {
    id: '/',
    name: 'Abrar Medical Store (AMS) - POS & ERP',
    short_name: 'AMS ERP',
    description:
      'Offline-First Desktop Point of Sale (POS), Billing, Inventory & Accounting System for Abrar Medical Store.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0f172a',
    theme_color: '#065f46',
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
  };

  const salesmanManifestPayload = {
    id: '/salesman',
    name: 'Abrar Medical Store - Salesman Booking App',
    short_name: 'AMS Booking',
    description: 'Offline-First Mobile Salesman Order Booking & Sync PWA for Abrar Medical Store',
    start_url: '/salesman',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#022c22',
    theme_color: '#065f46',
    categories: ['business', 'productivity', 'medical'],
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
  };

  app.get(['/manifest.json', '/manifest.webmanifest'], (_req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json(desktopManifestPayload);
  });

  app.get('/salesman-manifest.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json(salesmanManifestPayload);
  });

  // Dynamically build the Service Worker script including all compiled /assets/* bundles if dist/assets exists
  function getDynamicSwScript(): string {
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
    ];
    try {
      const assetsDir = path.join(distPath, 'assets');
      if (fs.existsSync(assetsDir)) {
        for (const file of fs.readdirSync(assetsDir)) {
          if (/\.(js|css|woff2?|ttf|svg|png)$/i.test(file)) {
            baseUrls.push(`/assets/${file}`);
          }
        }
      }
    } catch {
      // ignore
    }
    const uniqueUrls = Array.from(new Set(baseUrls));

    return `// AMS Service Worker v11 (Complete Offline-First App Shell + Simple Sync)
const SW_VERSION = 'ams-sw-v11-simple-sync';
const RUNTIME_CACHE = 'ams-runtime-v11';
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
      } catch (err) {}
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

  app.get(['/sw.js', '/dev-sw.js'], (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(getDynamicSwScript());
  });

  // Vite integration in development, static dist serving in production
  if (!serveStaticDist) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(distIndexHtml);
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[AMS Ready] Listening on http://0.0.0.0:${config.port}`);

    // Initialize persistence check after port 3000 is open (automatic restore disabled)
    initCloudPersistence()
      .then(() => {
        try {
          const dailyBackup = ensureDailyAutomaticBackup();
          if (dailyBackup) {
            console.log(`[AMS Backup] Automatic daily backup created: ${dailyBackup.filename}`);
          }
        } catch {
          // ignore non-critical backup error on startup
        }
      })
      .catch((err) => {
        console.warn('[AMS Cloud] Background persistence init skipped:', err?.message || err);
      });

    setInterval(() => {
      try {
        ensureDailyAutomaticBackup();
      } catch {
        // ignore scheduled backup error
      }
    }, 60 * 60 * 1000);
  });
}

startServer().catch((err) => {
  console.error('[AMS Fatal] Server failed to start:', err);
  process.exit(1);
});
