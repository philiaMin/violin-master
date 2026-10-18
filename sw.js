/* 바이올린 마스터 첫 화면 · 오프라인 저장소
   첫 화면과 앱 타일 그림만 담아요. 각 앱(score/, tuner/, tempo/, record/)은 자기 폴더의 sw.js가 따로 맡아요.
   index.html을 고쳐 올릴 때는 아래 VERSION 숫자를 하나 올려 주세요. */
const VERSION = 'vm-home-3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 
  'score/icons/icon-192.png', 'tuner/icons/icon-192.png', 'tempo/icons/icon-192.png', 'record/icons/icon-192.png'];
const APPS = ['score/', 'tuner/', 'tempo/', 'record/'];
const base = new URL('./', location).pathname;
const mine = url => url.origin === location.origin && url.pathname.startsWith(base) &&
  !APPS.some(a => url.pathname.startsWith(base + a) && !url.pathname.endsWith('/icons/icon-192.png'));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('vm-home-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !mine(url)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(async r => { if (r.ok) (await caches.open(VERSION)).put('index.html', r.clone()); return r; })
      .catch(async () => (await caches.match('index.html')) || Response.error()));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
