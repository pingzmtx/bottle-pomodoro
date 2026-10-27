/* 瓶子专注 · Service Worker
 *
 * 目标只有两个：① 加到主屏幕后能离线打开 ② 让 iOS 把它当"已安装"，
 * 从而大幅降低 Safari 对 localStorage 的 7 天自动清除风险。
 *
 * 缓存策略刻意选「网络优先」而不是常见的「缓存优先」——
 * 这个应用改版频繁，缓存优先意味着用户永远停在旧版，还查不出原因。
 * 网络优先：在线时永远拿最新的，离线时才回落到上次的副本。
 *
 * 版本号由 tools/build_site.py 在构建时替换 364e88edf588（取 index.html 的 sha256 前 12 位），
 * 每次改动内容都会生成新缓存名，旧缓存随之清掉。不要手改这个占位符。
 */

const BUILD_ID = '364e88edf588';
const CACHE = 'bottle-pomodoro-' + BUILD_ID;

/* 预缓存：只要这几个文件齐了，断网也能完整打开 */
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "assets/style.8f335c7df260.css", "assets/core.js", "assets/base.js", "assets/engine.js", "assets/app.js", "./fonts/inter-latin.woff2", "./fonts/smiley-sans.woff2", "./fonts/wenkai-regular.woff2", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个 add：任一文件 404 不至于让整次 install 失败（预缓存是加速，不是前提）
    await Promise.all(PRECACHE.map((u) =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    // 给这一代缓存盖时间戳：activate 要靠它决定「保留哪一代」，否则只能瞎删或全留
    await cache.put('__meta__', new Response(String(Date.now())));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    const others = names.filter((n) => n !== CACHE);
    // 只删「≥2 代之前」的：旧页面可能还活着、还在引用上一代的 assets，
    // 立刻删掉会让它离线重载失败。留最近一代做宽限，等下次发版再清。
    const stamped = [];
    for (const n of others) {
      let t = 0;
      try {
        const c = await caches.open(n);
        const r = await c.match('__meta__');
        if (r) t = Number(await r.text()) || 0;
      } catch (e) { /* 老缓存没有 meta，按最旧处理 */ }
      stamped.push([n, t]);
    }
    stamped.sort((a, b) => b[1] - a[1]);
    await Promise.all(stamped.slice(1).map(([n]) => caches.delete(n)));
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
        // cache:'no-cache' = 允许浏览器用 ETag/Last-Modified 去服务端「问一句」：
        // 没变就吃 304（不重下 3MB），变了才重下。
        // 原先是 'no-store'，每次都全量重下 —— 回访用户白付 950 KB。
        // 注意：仍然**不能**用默认的 cache 模式，否则可能直接吐回浏览器里那份旧页面。
        const fresh = await fetch(req, { cache: 'no-cache' });
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

  // config.js 单独走 network-first：它要能被随时改动，落到下面 cache-first 会永远读旧值
  if (url.pathname.slice(-10) === '/config.js') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || new Response('window.TF_CONFIG=window.TF_CONFIG||{};',
          { headers: { 'Content-Type': 'application/javascript' } });
      }
    })());
    return;
  }

  /* 静态资源：先给缓存，同时后台再取一份更新缓存（stale-while-revalidate）。
     ★ 原来这里是纯缓存优先 —— 每个 BUILD_ID 一代新缓存，看着好像自动过期，
       实际是「新一代 SW 还没接管时，页面拿到新 index.html + 上一代的 app.js」，
       于是新功能在页面上凭空消失，用户以为没做。后台补取之后，下一次加载
       一定读到新脚本；再配合页面里的 controllerchange 刷新，一次发版最多两跳。 */
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then((fresh) => {
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        cache.put(req, fresh.clone());
      }
      return fresh;
    });
    if (hit) {
      net.catch(() => {});
      return hit;
    }
    try {
      return await net;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});

// 页面里点「检查更新」会用得上：允许页面主动催新版本接管
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/* 点通知 → 把已经开着的页面切到前台；一个都没开就新开一个。
   ★ 没有这个处理时，通知点了什么都不会发生（浏览器只把通知关掉）——
     对番茄钟来说这很别扭：休息结束的通知点不动，用户还得自己去切 App。
   ★ 用 clients.matchAll 找同源窗口，优先 focus 而不是 openWindow：
     openWindow 每次都新开一个标签页，切几次就攒七八个钟表页。 */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const sameOrigin = all.filter((c) => {
        try { return new URL(c.url).origin === self.location.origin; } catch (err) { return false; }
      });
      if (sameOrigin.length) {
        const c = sameOrigin[0];
        try { await c.focus(); } catch (err) { /* 部分浏览器 focus 会抛，忽略 */ }
        /* 带上来源标记，页面可以据此做点事（比如滚到对应视图） */
        try { c.postMessage({ type: 'NOTIFY_CLICK', kind: data.kind || '' }); } catch (err) { /* 同上 */ }
        return;
      }
      try { await self.clients.openWindow('./'); } catch (err) { /* 忽略 */ }
    })()
  );
});
