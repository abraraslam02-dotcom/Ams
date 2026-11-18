import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare const __AMS_BUILD_ID__: string;
const CLIENT_BUILD_ID = typeof __AMS_BUILD_ID__ !== 'undefined' ? __AMS_BUILD_ID__ : 'dev';

const RELOAD_GUARD_KEY = 'ams_last_sw_auto_reload_at';
const RELOAD_BUILD_GUARD_KEY = 'ams_reloaded_for_build_v2';
const RELOAD_NUKED_GUARD_KEY = 'ams_sw_nuked_for_build_v1';
let swRegistrationRef: ServiceWorkerRegistration | null = null;
let reloadingForUpdate = false;

function triggerControlledReloadOnce(targetBuildId?: string): boolean {
  if (reloadingForUpdate || typeof window === 'undefined') return false;
  try {
    if (targetBuildId) {
      const prevTarget = sessionStorage.getItem(RELOAD_BUILD_GUARD_KEY);
      if (prevTarget === targetBuildId) {
        return false;
      }
      sessionStorage.setItem(RELOAD_BUILD_GUARD_KEY, targetBuildId);
    } else {
      const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0');
      if (Date.now() - lastReload < 5000) {
        return false;
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    }
  } catch {
    // ignore storage errors
  }
  reloadingForUpdate = true;
  window.location.reload();
  return true;
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

async function waitForServiceWorkerActivation(reg: ServiceWorkerRegistration | null, timeoutMs = 2200): Promise<void> {
  if (!reg || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await reg.update().catch(() => {});
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    const pendingWorker = reg.installing || reg.waiting;
    if (!pendingWorker) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
      pendingWorker.addEventListener('statechange', () => {
        if (pendingWorker.state === 'installed') {
          pendingWorker.postMessage({ type: 'SKIP_WAITING' });
        } else if (pendingWorker.state === 'activated' || pendingWorker.state === 'redundant') {
          finish();
        }
      });
    });
  } catch {
    // proceed with reload
  }
}

async function clearAllBrowserCaches(): Promise<void> {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await window.caches.keys();
      await Promise.allSettled(keys.map((k) => window.caches.delete(k)));
    } catch {
      // ignore
    }
  }
}

async function checkForPublishedUpdate(): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.onLine) return false;
  try {
    if (swRegistrationRef) {
      await swRegistrationRef.update().catch(() => {});
    }

    const currentAsset = getCurrentMainAssetPath();
    if (!currentAsset && CLIENT_BUILD_ID === 'dev') {
      // Dev mode (Vite serves /src/main.tsx directly) — skip production bundle hash comparison
      return false;
    }

    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return false;
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
      await clearAllBrowserCaches();

      // Check if a normal reload already ran for this build yet an old SW still served stale HTML
      let alreadyTriedReloadForBuild = false;
      let alreadyNukedForBuild = false;
      try {
        alreadyTriedReloadForBuild =
          Boolean(remoteBuildId) && sessionStorage.getItem(RELOAD_BUILD_GUARD_KEY) === remoteBuildId;
        alreadyNukedForBuild =
          Boolean(remoteBuildId) && sessionStorage.getItem(RELOAD_NUKED_GUARD_KEY) === remoteBuildId;
      } catch {
        // ignore
      }

      if (alreadyTriedReloadForBuild && !alreadyNukedForBuild && 'serviceWorker' in navigator) {
        try {
          if (remoteBuildId) {
            sessionStorage.setItem(RELOAD_NUKED_GUARD_KEY, remoteBuildId);
          }
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.allSettled(regs.map((r) => r.unregister()));
          await clearAllBrowserCaches();
        } catch {
          // ignore
        }
        reloadingForUpdate = true;
        window.location.reload();
        return true;
      }

      await waitForServiceWorkerActivation(swRegistrationRef);
      return triggerControlledReloadOnce(remoteBuildId || undefined);
    }
  } catch {
    // Ignore update check failures when offline or server restarting
  }
  return false;
}

async function warmOfflineAppShellCache() {
  if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) return;
  try {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.ready.catch(() => {});
    }
    const cacheNames = await window.caches.keys();
    const activeCacheName = cacheNames.find((name) => name.startsWith('ams-runtime-v'));
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
        if (res && res.ok && !res.redirected && !String(res.url || '').includes('__cookie_check')) {
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
    void (async () => {
      const triggeredUpdate = await checkForPublishedUpdate();
      if (!triggeredUpdate) {
        await warmOfflineAppShellCache();
      }
    })();
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

