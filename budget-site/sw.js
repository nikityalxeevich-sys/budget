// Service worker: хранит приложение на телефоне, чтобы оно открывалось без интернета.
// После изменения любого файла сайта увеличьте число в VERSION, тогда телефоны скачают новую версию.
const VERSION = 'budget-v4';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const same = u.origin === self.location.origin;
  const sdk = u.hostname === 'www.gstatic.com' && u.pathname.indexOf('/firebasejs/') === 0;
  if (!same && !sdk) return; // запросы к базе и входу идут напрямую

  if (sdk) {
    // Файлы библиотеки версионные и не меняются: берём из хранилища, а если нет, скачиваем и сохраняем.
    e.respondWith(
      caches.match(r).then(hit => hit || fetch(r).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(r, copy)); }
        return res;
      }))
    );
    return;
  }

  // Свои файлы: сразу отдаём сохранённую копию, а свежую подтягиваем в фоне.
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then(hit => {
      const net = fetch(r).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(r, copy)); }
        return res;
      }).catch(() => hit || (r.mode === 'navigate' ? caches.match('index.html') : undefined));
      return hit || net;
    })
  );
});
