// Service worker: deixa o app abrir rápido e funcionar offline.
// Ao publicar uma nova versão dos arquivos, aumente o número abaixo.
const CACHE = 'casa-gastos-v1';
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

  // Stale-while-revalidate: responde do cache e atualiza em segundo plano
  e.respondWith(caches.open(CACHE).then(async cache => {
    const emCache = await cache.match(req, { ignoreSearch: url.origin === location.origin });
    const daRede = fetch(req).then(resp => {
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    }).catch(() => emCache);
    return emCache || daRede;
  }));
});
