/* Service worker
 *   · 介面同商品圖 → 快取（開得快、離線都見到）
 *   · /api/*（本機 server 版）→ 永遠行網絡，唔好畀舊價出街
 *   · /data/*.json（GitHub Pages 靜態版）→ 先出快取即刻有嘢睇，背景攞新嗰份
 *     （快照本身就係「幾個鐘前抓」嘅，遲少少冇所謂，開得快緊要過爭嗰幾秒）
 */
const SHELL = 'hkpb-shell-v2';   // 加咗 search-core.js，要 bump 先會重新 precache
const IMGS = 'hkpb-img-v1';
const FILES = ['./', './index.html', './style.css', './search-core.js', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== IMGS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 商品圖：有就即刻用，順手更新
  if (url.pathname === '/api/img') {
    e.respondWith(caches.open(IMGS).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // 靜態版嘅快照：先用快取即刻出到嘢，背景順手攞新嗰份（stale-while-revalidate）
  if (/\/data\/(meta|wellcome|parknshop)\.json$/.test(url.pathname)) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // 價錢資料：永遠行網絡，唔好畀舊價出街
  if (url.pathname.startsWith('/api/')) return;

  // 介面檔：先攞新，攞唔到先用快取（例如電腦熄咗機）
  e.respondWith(
    fetch(e.request)
      .then((r) => { const cl = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, cl)); return r; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
