/**
 * BabyLog 轻量 PWA Service Worker：
 * 1. 严格放行 /api/* 与非 GET 请求，绝不缓存认证凭据或个人育儿业务数据；
 * 2. 仅缓存同源静态产物（/assets/*、字体、图标），提升主屏幕二次启动速度；
 * 3. 页面导航采用 Network-First，断网时返回友好中文离线提示页。
 */

const CACHE_PREFIX = 'babylog-static-';
const CACHE_NAME = `${CACHE_PREFIX}__BABYLOG_SW_VERSION__`;
const PRECACHE_URLS = ['/favicon.svg', '/apple-touch-icon.png', '/pwa-192x192.png'];

const OFFLINE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>当前处于离线状态 · BabyLog</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: #f8f8f2;
      color: #1f332d;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #181e1c; color: #eceee8; }
      .card { background: #202825; border-color: #2f3b37; }
      p { color: #a7b4ae; }
    }
    .card {
      max-width: 360px;
      width: 100%;
      border: 1px solid #e2e5dc;
      border-radius: 20px;
      background: #ffffff;
      padding: 28px 24px;
      text-align: center;
      box-sizing: border-box;
    }
    h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
    p { margin: 0 0 20px; font-size: 14px; line-height: 1.65; color: #5b6d66; }
    button {
      border: 0;
      border-radius: 12px;
      background: #247568;
      color: #ffffff;
      font-size: 14px;
      font-weight: 500;
      padding: 10px 20px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>暂时无法连接网络</h1>
    <p>BabyLog 需要连接你的家庭服务来保存与同步宝宝记录，请检查网络或服务状态后重试。</p>
    <button type="button" onclick="window.location.reload()">重新连接</button>
  </main>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isCacheableStaticPath(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.svg' ||
    pathname === '/apple-touch-icon.png' ||
    pathname === '/pwa-192x192.png' ||
    pathname === '/pwa-512x512.png' ||
    pathname === '/pwa-maskable-512x512.png'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 严禁拦截或缓存 /api/* 接口，保障登录态与个人育儿数据隐私。
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );
    return;
  }

  if (isCacheableStaticPath(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
