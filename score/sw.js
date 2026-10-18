/* 바이올린 마스터 악보 · 오프라인 저장소
   앱 화면과 PDF 도구, 글꼴을 이 기기에 담아 두어 인터넷 없이도 열리게 해요.
   index.html을 고쳐 올릴 때는 아래 VERSION 숫자를 하나 올려 주세요. */
const VERSION = 'vm-score-6';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
const RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(CDN.map(async u => {
      try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await c.put(u, r); } catch {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 같은 주소의 다른 시리즈 앱 저장소는 건드리지 않고, 이 앱의 옛 버전만 지워요
    const mine = VERSION.replace(/\d+$/, '');
    for (const k of await caches.keys()) if (k.startsWith(mine) && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 앱 화면: 인터넷이 되면 새 버전을, 안 되면 담아 둔 것을
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) { const c = await caches.open(VERSION); c.put('index.html', r.clone()); }
        return r;
      } catch {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // PDF 도구·글꼴·아이콘: 담아 둔 것을 먼저, 없으면 받아서 담기
  if (url.origin === location.origin || RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') { const c = await caches.open(VERSION); c.put(req, r.clone()); }
        return r;
      } catch {
        return Response.error();
      }
    })());
  }
});
