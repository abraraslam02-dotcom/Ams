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
  app.use('/api/enhancements', enhancementsRouter);

  // Prevent browser/proxy HTTP caching on HTML shell and Service Worker scripts
  app.use((req, res, next) => {
    if (
      req.path === '/' ||
      req.path === '/index.html' ||
      req.path === '/sw.js' ||
      req.path === '/dev-sw.js' ||
      req.path === '/registerSW.js' ||
      req.path === '/manifest.webmanifest'
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // Serve unified Network-First Service Worker that immediately purges legacy caches and refreshes stale tabs
  const networkFirstSwScript = `// AMS Service Worker v7 (Network-First, Auto-Purge Legacy Caches)
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

  app.get(['/sw.js', '/dev-sw.js'], (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(networkFirstSwScript);
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

    // Initialize Cloud SQL / Firestore persistence in the background after port 3000 is open
    initCloudPersistence()
      .then(async (cloudInit) => {
        if (cloudInit.restored) {
          const postMig = runMigrations();
          if (postMig.newlyAppliedCount > 0) {
            await syncDatabaseToCloudSQL('post_migration_startup');
          }
        }
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
