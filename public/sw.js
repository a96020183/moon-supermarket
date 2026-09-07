/* Service worker
 *   · 介面同商品圖 → 快取（開得快、離線都見到）
 *   · /api/*（本機 server 版）→ 永遠行網絡，唔好畀舊價出街
 *   · /data/*.json（GitHub Pages 靜態版）→ 先出快取即刻有嘢睇，背景攞新嗰份
 *     （快照本身就係「幾個鐘前抓」嘅，遲少少冇所謂，開得快緊要過爭嗰幾秒）
 */
const SHELL = 'hkpb-shell-v3';   // v3：補咗全站產地，舊快取入面嗰份冇 origin，要掉咗佢
const IMGS = 'hkpb-img-v1';
const FILES = ['./', './index.html', './style.css', './search-core.js', './app.js', './manifest.webmanifest', './icon.svg'];

/* GitHub Pages 每份檔都有 ETag，內容一變就變 —— 攞嚟分辨「背景攞返嚟嗰份係咪新料」 */
const tagOf = (r) => (r && (r.headers.get('ETag') || r.headers.get('Last-Modified'))) || null;

async function tellClients(msg) {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of cs) c.postMessage(msg);
}

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

  /* 靜態版嘅快照：先用快取即刻出到嘢，背景順手攞新嗰份（stale-while-revalidate）。
     但「背景攞咗」唔等於「你今次見到」—— 今次畫面用緊嘅仍然係舊嗰份，
     要開多次先追到。補完全站產地嗰次就係咁：朋友一開，悅鮮活仲寫住「產地？」。
     所以攞到新料就出聲，畀個掣佢撳一下即刻用返新嗰份（已經喺快取，秒開）。 */
  if (/\/data\/(meta|wellcome|parknshop)\.json$/.test(url.pathname)) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(async (r) => {
        if (!r.ok) return r;
        const before = tagOf(hit), after = tagOf(r);
        await c.put(e.request, r.clone());
        // 兩邊都有 ETag 而且唔同 = 真係換咗料。冇 ETag 就唔亂嘈。
        if (hit && before && after && before !== after) {
          await tellClients({ type: 'snapshot-updated', path: url.pathname });
        }
        return r;
      }).catch(() => hit);
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
