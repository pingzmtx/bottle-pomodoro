/* 瓶子专注 · Service Worker
 *
 * 目标只有两个：① 加到主屏幕后能离线打开 ② 让 iOS 把它当"已安装"，
 * 从而大幅降低 Safari 对 localStorage 的 7 天自动清除风险。
 *
 * 缓存策略刻意选「网络优先」而不是常见的「缓存优先」——
 * 这个应用改版频繁，缓存优先意味着用户永远停在旧版，还查不出原因。
 * 网络优先：在线时永远拿最新的，离线时才回落到上次的副本。
 *
 * 版本号由 tools/build_site.py 在构建时替换 162029715f14（取 index.html 的 sha256 前 12 位），
 * 每次改动内容都会生成新缓存名，旧缓存随之清掉。不要手改这个占位符。
 */

const BUILD_ID = '162029715f14';
const CACHE = 'bottle-pomodoro-' + BUILD_ID;

/* 预缓存：只要这几个文件齐了，断网也能完整打开 */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个 add：任一文件 404 不至于让整次 install 失败（预缓存是加速，不是前提）
    await Promise.all(PRECACHE.map((u) =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n === CACHE ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // 只接管自己域名下的 GET；跨域（如网易云封面、用户自定义皮肤图）一律放行，
  // 缓存它们既占空间又容易串版本。
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，失败回落缓存
  const isDoc = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') >= 0;

  if (isDoc) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        const hit = (await cache.match(req)) || (await cache.match('./index.html')) ||
          (await cache.match('./'));
        if (hit) return hit;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>离线</title>' +
          '<body style="font:16px/1.7 system-ui;padding:2em;color:#333">' +
          '<h2>现在离线</h2><p>这个页面还没被缓存过，联网后再打开一次即可离线使用。</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        );
      }
    })());
    return;
  }

  // 静态资源：缓存优先（图标、manifest 基本不变）
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});

// 页面里点「检查更新」会用得上：允许页面主动催新版本接管
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
