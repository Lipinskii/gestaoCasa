// Service worker: deixa o app abrir rápido e funcionar offline.
// Busca sempre a versão mais nova na rede e usa o cache só quando está offline.
const CACHE = 'casa-gastos-v2';
const ARQUIVOS = [
  './', './index.html', './app.js', './calculo.js', './store.js', './config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Arquivos do app e o SDK do Firebase (gstatic). O tráfego do banco não passa aqui.
  const cacheavel = url.origin === location.origin || url.hostname === 'www.gstatic.com';
  if (!cacheavel) return;

  // Rede primeiro (pega sempre a versão mais nova); sem internet, usa o cache
  e.respondWith(caches.open(CACHE).then(async cache => {
    try {
      const resp = await fetch(req, { cache: 'no-cache' });
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    } catch {
      const emCache = await cache.match(req, { ignoreSearch: url.origin === location.origin });
      if (emCache) return emCache;
      throw new Error('offline e sem cache: ' + req.url);
    }
  }));
});