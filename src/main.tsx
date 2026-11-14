import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

const RUNTIME_CACHE_NAME = 'ams-runtime-v11';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration && navigator.onLine) {
      registration.update().catch(() => {});
    }
  },
});

async function warmOfflineAppShellCache() {
  if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) return;
  try {
    const cache = await window.caches.open(RUNTIME_CACHE_NAME);
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
        const res = await fetch(url, { cache: 'no-cache' });
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
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (navigator.onLine) {
          reg.update().catch(() => {});
        }
      })
      .catch(() => {});
  }
  window.addEventListener('load', () => {
    warmOfflineAppShellCache();
  });
}

createRoot(document.getElementById('root')!).render(<App />);
