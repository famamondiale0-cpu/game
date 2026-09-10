/**
 * sw.js - Service Worker di Zenith Block.
 *
 * Strategia:
 *  - install : precache dell'intera app (e' piccola e interamente statica)
 *  - activate: elimina le cache delle versioni precedenti
 *  - fetch   : navigazioni -> network-first con fallback offline all'index
 *              risorse    -> cache-first con aggiornamento in background
 *
 * Tutti i percorsi sono RELATIVI: funziona sia su dominio radice sia in una
 * sottocartella di GitHub Pages (es. /nome-repo/).
 */

const VERSION = 'zenith-block-v1.1.0';
const CORE_CACHE = VERSION + '-core';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './src/config/Config.js',
  './src/core/BlockFactory.js',
  './src/core/Engine.js',
  './src/core/Game.js',
  './src/core/Grid.js',
  './src/main.js',
  './src/render/RenderEngine.js',
  './src/systems/EconomyEngine.js',
  './src/systems/EventSystem.js',
  './src/systems/GrowthSystem.js',
  './src/systems/ParticleEngine.js',
  './src/systems/PhysicsSystem.js',
  './src/systems/SaveSystem.js',
  './src/systems/SeasonSystem.js',
  './src/systems/SecuritySystem.js',
  './src/systems/SkybridgeSystem.js',
  './src/systems/SoundEngine.js',
  './src/systems/WeatherSystem.js',
  './src/ui/TutorialSystem.js',
  './src/ui/UIController.js',
  './src/utils/EventBus.js',
  './src/utils/Random.js',
  './src/utils/Utils.js',
  './assets/apple-touch-icon.png',
  './assets/favicon-32.png',
  './assets/icon-192.png',
  './assets/icon-256.png',
  './assets/icon-384.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // addAll fallisce in blocco se un solo file manca: si aggiunge uno per uno
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[SW] impossibile mettere in cache', url, err); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CORE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // font e CDN: gestiti dal browser

  // Navigazione: prima la rete (per prendere gli aggiornamenti), poi la cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CORE_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CORE_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
               new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Risorse statiche: prima la cache, aggiornamento silenzioso in background
  event.respondWith((async () => {
    const cache = await caches.open(CORE_CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) ||
           new Response('Risorsa non disponibile offline', { status: 504 });
  })());
});

// Permette alla pagina di forzare l'attivazione di una nuova versione
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
