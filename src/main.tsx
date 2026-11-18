import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare const __AMS_BUILD_ID__: string;
const CLIENT_BUILD_ID = typeof __AMS_BUILD_ID__ !== 'undefined' ? __AMS_BUILD_ID__ : 'dev';

const RELOAD_GUARD_KEY = 'ams_last_sw_auto_reload_at';
const RELOAD_BUILD_GUARD_KEY = 'ams_reloaded_for_build_v2';
let swRegistrationRef: ServiceWorkerRegistration | null = null;
let reloadingForUpdate = false;

function triggerControlledReloadOnce(targetBuildId?: string) {
  if (reloadingForUpdate || typeof window === 'undefined') return;
  try {
    if (targetBuildId) {
      const prevTarget = sessionStorage.getItem(RELOAD_BUILD_GUARD_KEY);
      if (prevTarget === targetBuildId) {
        return;
      }
      sessionStorage.setItem(RELOAD_BUILD_GUARD_KEY, targetBuildId);
    } else {
      const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0');
      if (Date.now() - lastReload < 5000) {
        return;
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    }
  } catch {
    // ignore storage errors
  }
  reloadingForUpdate = true;
  window.location.reload();
}

function getCurrentMainAssetPath(): string | null {
  const scripts = Array.from(document.querySelectorAll('script[type="module"][src]'));
  for (const el of scripts) {
    const src = el.getAttribute('src') || '';
    if (src.includes('/assets/')) {
      try {
        return new URL(src, window.location.origin).pathname;
      } catch {
        return src;
      }
    }
  }
  return null;
}

async function checkForPublishedUpdate() {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  try {
    if (swRegistrationRef) {
      await swRegistrationRef.update().catch(() => {});
    }

    const currentAsset = getCurrentMainAssetPath();
    if (!currentAsset && CLIENT_BUILD_ID === 'dev') {
      // Dev mode (Vite serves /src/main.tsx directly) — skip production bundle hash comparison
      return;
    }

    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { buildId?: string; buildHash?: string; assets?: string[] };
    const remoteBuildId = String(data?.buildId || data?.buildHash || '');
    const buildIdMismatch =
      Boolean(data?.buildId) &&
      CLIENT_BUILD_ID !== 'dev' &&
      !String(data.buildId).startsWith('dev-') &&
      data.buildId !== CLIENT_BUILD_ID;
    const assetMismatch =
      Boolean(currentAsset) &&
      Array.isArray(data?.assets) &&
      data.assets.length > 0 &&
      !data.assets.includes(currentAsset!);

    if (buildIdMismatch || assetMismatch) {
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.allSettled(keys.map((k) => window.caches.delete(k)));
      }
      if (swRegistrationRef) {
        await swRegistrationRef.update().catch(() => {});
      }
      triggerControlledReloadOnce(remoteBuildId || undefined);
    }
  } catch {
    // Ignore update check failures when offline or server restarting
  }
}

async function warmOfflineAppShellCache() {
  if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) return;
  try {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.ready.catch(() => {});
    }
    const cacheNames = await window.caches.keys();
    const activeCacheName = cacheNames.find(
      (name) => name.startsWith('ams-runtime-v14-') || name.startsWith('ams-runtime-v13-')
    );
    if (!activeCacheName) return;
    const cache = await window.caches.open(activeCacheName);
    const urlsToWarm = new Set<string>([
      '/',
      '/index.html',
      '/manifest.json',
      '/salesman-manifest.json',
      '/icon.svg',
      '/pwa-192x192.png',
      '/pwa-512x512.png',
      '/apple-touch-icon.png',
    ]);

    document.querySelectorAll('script[src]').forEach((el) => {
      const src = el.getAttribute('src');
      if (src && (src.startsWith('/') || src.startsWith(window.location.origin))) {
        urlsToWarm.add(src);
      }
    });

    document.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href && (href.startsWith('/') || href.startsWith(window.location.origin))) {
        urlsToWarm.add(href);
      }
    });

    await Promise.allSettled(
      Array.from(urlsToWarm).map(async (url) => {
        const res = await fetch(url, { cache: 'no-store' });
        if (res && res.ok) {
          await cache.put(url, res.clone());
        }
      })
    );
  } catch {
    // Ignore cache warm errors when offline
  }
}

if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        triggerControlledReloadOnce();
      }
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'AMS_SW_ACTIVATED' && hadController) {
        triggerControlledReloadOnce();
      }
    });

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        swRegistrationRef = reg;
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        if (navigator.onLine) {
          reg.update().catch(() => {});
        }
      })
      .catch(() => {});
  }

  window.addEventListener('load', () => {
    void checkForPublishedUpdate();
    void warmOfflineAppShellCache();
  });

  window.addEventListener('focus', () => {
    void checkForPublishedUpdate();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForPublishedUpdate();
    }
  });

  window.setInterval(() => {
    void checkForPublishedUpdate();
  }, 5 * 60 * 1000);
}

createRoot(document.getElementById('root')!).render(<App />);

