import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      registration.update().catch(() => {});
    }
  },
});

if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {});
  }
  if ('caches' in window) {
    window.caches
      .keys()
      .then((keys) => {
        keys.forEach((key) => {
          if (key !== 'ams-runtime-v7') {
            window.caches.delete(key).catch(() => {});
          }
        });
      })
      .catch(() => {});
  }
}

createRoot(document.getElementById('root')!).render(<App />);



