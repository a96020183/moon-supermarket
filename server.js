'use strict';
/* 香港超市比價小幫手 —— 本機 server
 *
 * 惠康：即時搜尋 + 即時分類（robots.txt 冇擋）
 * 百佳：分類即時攞；搜尋行本地索引（因為佢 robots.txt Disallow /search?）
 *
 * 全部資料淨係經你部機，冇上傳去任何地方。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const S = require('./lib-stores.js');
const cache = require('./lib-cache.js');
const idx = require('./lib-index.js');
const { expandQuery, synonyms, POPULAR } = require('./lib-dict.js');
const { parseSize, unitPrice } = require('./lib-units.js');

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC = path.join(__dirname, 'public');
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');

const TTL = {
  search: 30 * 60e3,      // 惠康搜尋 30 分鐘
  category: 30 * 60e3,
  detail: 6 * 3600e3,     // 商品詳情 6 小時
  thumb: 7 * 24 * 3600e3, // 商品圖 7 日
  tree: 7 * 24 * 3600e3,
  image: 30 * 24 * 3600e3,
};

/* ---------------- 價格記錄 ---------------- */

let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { history = {}; }
let historyDirty = false;

function recordPrice(p) {
  if (!p || !p.price) return;
  const arr = (history[p.id] = history[p.id] || []);
  const last = arr[arr.length - 1];
  const now = Date.now();
  if (last && last[1] === p.price && now - last[0] < 12 * 3600e3) return;
  if (last && last[1] === p.price) { last[0] = now; historyDirty = true; return; }
  arr.push([now, p.price]);
  if (arr.length > 60) arr.splice(0, arr.length - 60);
  historyDirty = true;
}

function priceStats(id) {
  const arr = history[id];
  if (!arr || arr.length < 2) return null;
  const prices = arr.map((x) => x[1]);
  return {
    points: arr,
    min: Math.min(...prices),
    max: Math.max(...prices),
    prev: prices[prices.length - 2],
  };
}

setInterval(() => {
  if (!historyDirty) return;
  historyDirty = false;
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFile(HISTORY_FILE, JSON.stringify(history), () => {});
}, 20000).unref();

/* ---------------- 惠康 sku → 分類 ----------------
 * 惠康個網頁本身唔會話你知件貨屬邊個分類，但 build-snapshot.js 爬目錄嗰陣記低咗。
 * 讀返嚟做個對照表，令 server 版都有 catId —— 靠佢先認得出邊件係寵物用品。
 */
const WC_INDEX_FILE = path.join(__dirname, 'data', 'wc-index.json');
let wcCat = new Map();
let wcCatMtime = 0;

function loadWcCat() {
  try {
    const m = fs.statSync(WC_INDEX_FILE).mtimeMs;
    if (m === wcCatMtime) return;
    const raw = JSON.parse(fs.readFileSync(WC_INDEX_FILE, 'utf8'));
    wcCat = new Map((raw.items || []).filter((p) => p.catId).map((p) => [String(p.sku), String(p.catId)]));
    wcCatMtime = m;
    console.log(`[wc] 惠康分類對照表：${wcCat.size} 件`);
  } catch { /* 未跑過 build-snapshot 就冇，唔緊要 */ }
}
loadWcCat();

/** 幫件貨補返 catId（server 版本身冇呢個欄位） */
function stampCat(p, fallback) {
  if (p.catId) return p;
  if (p.store === 'wellcome') {
    const c = wcCat.get(String(p.sku));
    if (c) p.catId = c;
  }
  if (!p.catId && fallback) p.catId = String(fallback);
  return p;
}

/* ---------------- 商品處理 ---------------- */

function attachHistory(p) {
  recordPrice(p);
  const st = priceStats(p.id);
  if (st) {
    p.lowest = st.min;
    p.isLowest = p.price <= st.min + 0.001;
    if (st.prev && st.prev !== p.price) p.priceMove = p.price < st.prev ? 'down' : 'up';
  }
  return p;
}

function sortProducts(list, sort) {
  const arr = [...list];
  if (sort === 'relevance') {
    arr.sort((a, b) => (b.rel || 0) - (a.rel || 0) || a.price - b.price);
  } else if (sort === 'price') arr.sort((a, b) => a.price - b.price);
  else if (sort === 'unit') {
    arr.sort((a, b) => {
      const au = a.unitPrice, bu = b.unitPrice;
      if (au && bu && au.per === bu.per) return au.value - bu.value;
      if (au && !bu) return -1;
      if (!au && bu) return 1;
      return a.price - b.price;
    });
  } else if (sort === 'discount') arr.sort((a, b) => (b.discountPct || 0) - (a.discountPct || 0));
  return arr;
}

/* ---------------- 各 API ---------------- */

async function apiSearch(q, { stores, sort, page, includePets }) {
  const queries = expandQuery(q, 2);
  const out = [];
  const notes = [];

  let fetchedAt = null;

  if (stores.includes('wellcome')) {
    const seen = new Set();
    for (const term of queries) {
      try {
        const r = await cache.cached(`wc:search:${term}:${page}`, TTL.search,
          () => S.wellcome.search(term, page), { stale: true });
        fetchedAt = fetchedAt == null ? r.at : Math.min(fetchedAt, r.at);
        // 惠康自己個搜尋排得幾好，就照跟佢個次序做相關度，
        // 咁兩間先可以撈埋一齊排而唔會冤枉任何一邊。
        r.value.forEach((p, i) => { if (p.rel == null) p.rel = 108 - i * 2; });
        for (const p of r.value) if (!seen.has(p.sku)) { seen.add(p.sku); out.push(p); }
      } catch (e) {
        notes.push({ store: 'wellcome', message: `惠康搵唔到嘢：${e.message}` });
        break;
      }
    }
  }

  if (stores.includes('parknshop')) {
    idx.maybeReload();          // 外面重建咗索引就即刻用新嗰份
    const st = idx.status();
    if (!st.count) {
      notes.push({ store: 'parknshop', message: '百佳索引仲未起好，暫時淨係搵到惠康', action: 'rebuild' });
    } else {
      out.push(...idx.search(q, 60, { includePets }));
    }
  }

  loadWcCat();
  out.forEach((p) => { stampCat(p); attachHistory(p); });
  const sorted = sortProducts(out, sort);
  if (idx.status().count) attachAlt(sorted);
  return { products: sorted, notes, queries, fetchedAt };
}

async function apiCategory(store, id, page, sort, kind) {
  if (store === 'wellcome') {
    const r = await cache.cached(`wc:cat:${id}:${page}`, TTL.category,
      () => S.wellcome.category(id, page), { stale: true });
    r.value.forEach((p) => { stampCat(p, id); attachHistory(p); });
    const sorted = sortProducts(r.value, sort);
    if (idx.status().count) attachAlt(sorted);
    return { products: sorted, from: r.from };
  }
  const r = await cache.cached(`pns:cat:${id}:${page}:${kind}`, TTL.category,
    () => S.parknshop.category(id, page, kind), { stale: true });
  r.value.products.forEach((p) => { stampCat(p, id); attachHistory(p); });
  return { products: sortProducts(r.value.products, sort), from: r.from };
}

/** 惠康商品圖（只讀 head，好慳） */
async function apiThumb(sku) {
  try {
    const r = await cache.cached(`wc:thumb:${sku}`, TTL.thumb, async () => {
      const head = await S.fetchHeadText(`https://www.wellcome.com.hk/zh-hant/wellcome/p/x/i/${sku}.html`, 24000);
      const m = /(?:name|property)="og:image"\s+content="([^"]*)"/.exec(head);
      return { image: m ? m[1] : null };
    });
    return r.value;
  } catch {
    return { image: null };          // 攞唔到張圖唔算事，卡片會用返可愛 icon
  }
}

async function apiItem(store, sku) {
  // 攞唔到（貨品落咗架、網站改版）就靜靜哋回空，介面照顯示基本資料就算
  try {
    if (store === 'wellcome') {
      const r = await cache.cached(`wc:detail:${sku}`, TTL.detail, () => S.wellcome.detail(sku), { stale: true });
      return r.value;
    }
    const hit = idx.items.find((p) => p.sku === sku);
    if (hit) return hit;
    const r = await cache.cached(`pns:prod:${sku}`, TTL.detail, () => S.parknshop.product(sku), { stale: true });
    return r.value;
  } catch (e) {
    console.error('[item]', store, sku, e.message);
    return { sku: String(sku), unavailable: true };
  }
}

/** 惠康搜尋，順手用中英詞庫擴詞（「廁紙」都會搵埋 toilet paper） */
async function wcSearchExpanded(key, limit = 20) {
  const out = [];
  const seen = new Set();
  for (const term of expandQuery(key, 2)) {
    try {
      const r = await cache.cached(`wc:search:${term}:1`, TTL.search, () => S.wellcome.search(term, 1), { stale: true });
      for (const p of r.value) if (!seen.has(p.sku)) { seen.add(p.sku); out.push(p); }
    } catch { break; }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 每件惠康貨附返百佳最接近嗰件嘅價，畀卡片用細字寫住做參考。
 * 惠康係主場：佢主要睇惠康，百佳只係「順便知一知」，所以夾唔夠似寧願唔顯示。
 */
function attachAlt(products, cap = 40) {
  let n = 0;
  for (const p of products) {
    if (p.store !== 'wellcome' || p.alt !== undefined) continue;
    if (n >= cap) break;
    n++;
    const cands = [];
    for (const key of compareKeys(p.name)) {
      for (const c of idx.search(key, 10)) cands.push(c);
      if (cands.length >= 10) break;
    }
    const m = bestMatch({ name: p.name }, cands);
    p.alt = m ? {
      store: 'parknshop', storeName: '百佳', id: m.id, sku: m.sku,
      name: m.name, price: m.price, sizeText: m.sizeText, matchScore: m.matchScore,
    } : null;
  }
  return products;
}

/** 喺另一間超市搵相似貨品 */
async function apiCompare(name, exclude) {
  const res = [];
  const seen = new Set();
  for (const key of compareKeys(name)) {
    if (exclude !== 'wellcome') {
      for (const p of (await wcSearchExpanded(key, 12)).slice(0, 12)) {
        if (!seen.has(p.id)) { seen.add(p.id); res.push(p); }
      }
    }
    if (exclude !== 'parknshop') {
      for (const p of idx.search(key, 12)) if (!seen.has(p.id)) { seen.add(p.id); res.push(p); }
    }
    if (res.length >= 12) break;
  }
  res.forEach(attachHistory);
  const name0 = name;
  const target = parseSize(name0);
  return res
    .map((p) => ({ ...p, matchScore: similarity(name0, p.name, target, p.size, p.categoryPath) }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 8);
}

/**
 * 一件貨可以用幾個字詞去另一間搵：
 * 先用完整關鍵詞（夠準），搵唔到就退返用「中心詞」——
 * 「Rokeby Fitmilk 蛋白無乳糖牛奶飲品 900ML」→「牛奶飲品」。
 */
function compareKeys(name) {
  const keys = [keywordsFrom(name)];
  const stripped = String(name || '')
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*[A-Za-z克公斤毫升公升片包件入支條盒卷]*\s*$/g, '')
    .trim();
  const cjk = stripped.replace(/[^一-鿿]/g, '');
  for (const n of [4, 3, 2]) {
    if (cjk.length >= n) {
      const tail = cjk.slice(-n);
      if (!keys.includes(tail)) keys.push(tail);
    }
  }
  return keys.slice(0, 3);
}

/** 由商品名抽出最有代表性嘅字詞（去掉規格同括號備註） */
function keywordsFrom(name) {
  let s = String(name || '')
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:KGS?|GMS?|GR|G|MLS?|LTRS?|LTS?|LT|L|PCS?|PKT?S?|EA|X|公斤|公升|毫升|克|片|包|件|入|支|條|盒|卷)(?![A-Za-z0-9])/gi, ' ')
    .replace(/[０-９0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 12) s = s.slice(0, 12);
  return s || String(name || '').slice(0, 10);
}

function similarity(a, b, sizeA, sizeB, catB) {
  const na = idx.norm(a), nb = idx.norm(b);
  const ta = new Set(na.split(/\s+/).concat([...na.replace(/\s/g, '')].filter((c) => /[一-鿿]/.test(c))));
  const tb = new Set(nb.split(/\s+/).concat([...nb.replace(/\s/g, '')].filter((c) => /[一-鿿]/.test(c))));
  let hit = 0;
  for (const t of ta) if (t && tb.has(t)) hit++;
  let score = ta.size ? (hit / ta.size) * 100 : 0;

  // 詞庫同義詞都當夾中（廁紙 ↔ 衛生紙 ↔ toilet paper）
  const key = keywordsFrom(a);
  const cat = idx.norm((catB || []).join(' '));
  let synHit = false, catHit = false;
  for (const syn of synonyms(key)) {
    const s = idx.norm(syn);
    if (!s) continue;
    if (!synHit && nb.includes(s)) synHit = true;
    if (!catHit && cat && cat.includes(s)) catHit = true;
  }
  if (synHit) score += 25;
  if (catHit) score += 25;                 // 分類啱＝真係同一類貨，唔係得個名似

  // 「雞蛋」夾到「雞蛋饅頭」咁嘅情況：命中詞喺人哋個名度佔得好少就扣返啲
  const kn = idx.norm(key);
  if (kn && nb.includes(kn)) {
    const share = kn.length / Math.max(kn.length, nb.replace(/\s/g, '').length);
    score += Math.round(share * 30) - 10;
  }
  if (sizeA && sizeB && sizeA.kind === sizeB.kind) {
    const ratio = Math.min(sizeA.base, sizeB.base) / Math.max(sizeA.base, sizeB.base);
    score += ratio * 25;
  }
  return Math.round(score);
}

/** 一次過清單比價：每件貨喺兩間各搵最平嗰件 */
async function apiListCompare(items) {
  const rows = [];
  for (const it of items.slice(0, 40)) {
    const key = keywordsFrom(it.name || it.q || '');
    const row = { name: it.name, qty: it.qty || 1, wellcome: null, parknshop: null };
    row.wellcome = bestMatch(it, await wcSearchExpanded(key, 20));
    row.parknshop = bestMatch(it, idx.search(key, 20));
    rows.push(row);
  }
  return rows;
}

/**
 * 兩件貨嘅份量差太遠就唔好當同一件。
 * 唔加呢個就會出現「皇冠濕廁紙 40PC $17 vs 百佳 $66.50 貴 $49.50」——
 * 個名夾中晒，但人哋係大好多倍嗰個裝，寫出嚟只會誤導。
 */
function sizeComparable(a, b) {
  if (!a || !b || a.kind !== b.kind || !a.base || !b.base) return true;   // 唔知就唔攔
  return Math.min(a.base, b.base) / Math.max(a.base, b.base) >= 0.7;
}

function bestMatch(item, list) {
  if (!list || !list.length) return null;
  const target = parseSize(item.name || '');
  const scored = list
    .filter((p) => sizeComparable(target, p.size))
    .map((p) => ({ p, s: similarity(item.name || '', p.name, target, p.size, p.categoryPath) }))
    .sort((a, b) => b.s - a.s || a.p.price - b.p.price);
  const top = scored[0];
  // 夾唔夠似就寧願話搵唔到，好過畀個錯嘅價錢佢
  return top && top.s >= 55 ? attachHistory({ ...top.p, matchScore: top.s }) : null;
}

/* ---------------- HTTP ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('nope'); }
  try {
    const data = await fs.promises.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('搵唔到呢頁');
  }
}

/** 由檔頭認圖片格式（CDN 唔一定畀啱 content-type） */
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 3 && buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 200).toString('utf8').includes('<svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

/** 圖片代理：令 iPad 一定載到圖，又可以俾 service worker 快取落機 */
const imgCache = new Map();
async function serveImage(res, target) {
  if (!/^https:\/\/(img\.rtacdn-os\.com|medias\.pns\.hk|[a-z0-9.-]*\.pns\.hk|[a-z0-9.-]*\.rtacdn-os\.com)\//.test(target)) {
    res.writeHead(400); return res.end('bad image host');
  }
  const hit = imgCache.get(target);
  if (hit && hit.exp > Date.now()) {
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=2592000' });
    return res.end(hit.buf);
  }
  try {
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    let type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) type = sniffImage(buf);      // CDN 有時回 binary/octet-stream
    if (imgCache.size > 600) imgCache.clear();
    imgCache.set(target, { buf, type, exp: Date.now() + TTL.image });
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end();
  }
}

let rebuildAbort = null;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const q = u.searchParams;
  const p = u.pathname;

  try {
    if (!p.startsWith('/api/')) return serveStatic(res, p);

    if (p === '/api/bootstrap') {
      const tree = await cache.cached('pns:tree', TTL.tree, () => S.parknshop.categoryTree(), { stale: true })
        .then((r) => r.value).catch(() => []);
      return sendJSON(res, 200, {
        stores: S.STORES,
        popular: POPULAR,
        categories: { wellcome: S.wellcome.CATEGORIES, parknshop: tree },
        index: idx.status(),
      });
    }

    if (p === '/api/search') {
      const term = (q.get('q') || '').trim();
      if (!term) return sendJSON(res, 200, { products: [], notes: [] });
      const stores = (q.get('stores') || 'wellcome,parknshop').split(',');
      return sendJSON(res, 200, await apiSearch(term, {
        stores, sort: q.get('sort') || 'relevance', page: Math.max(1, Number(q.get('page')) || 1),
        includePets: q.get('pets') === '1',
      }));
    }

    if (p === '/api/category') {
      return sendJSON(res, 200, await apiCategory(
        q.get('store') === 'parknshop' ? 'parknshop' : 'wellcome',
        q.get('id'), Math.max(1, Number(q.get('page')) || 1), q.get('sort') || 'relevance',
        q.get('kind') === 'lc' ? 'lc' : 'c',
      ));
    }

    if (p === '/api/thumb') return sendJSON(res, 200, await apiThumb(q.get('sku')));
    if (p === '/api/item') return sendJSON(res, 200, await apiItem(q.get('store'), q.get('sku')) || {});
    if (p === '/api/compare') return sendJSON(res, 200, { matches: await apiCompare(q.get('name') || '', q.get('exclude')) });
    if (p === '/api/history') return sendJSON(res, 200, priceStats(q.get('id')) || {});
    if (p === '/api/status') { idx.maybeReload(); return sendJSON(res, 200, { index: idx.status(), cache: cache.stats(), uptime: process.uptime() }); }
    if (p === '/api/img') return serveImage(res, q.get('u') || '');

    if (p === '/api/list-compare' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 200, { rows: await apiListCompare(body.items || []) });
    }

    if (p === '/api/index/rebuild' && req.method === 'POST') {
      if (idx.status().running) return sendJSON(res, 200, idx.status());
      rebuildAbort = new AbortController();
      idx.build({ pages: 8, signal: rebuildAbort.signal }).catch((e) => console.error('[index]', e.message));
      return sendJSON(res, 200, idx.status());
    }

    sendJSON(res, 404, { error: '冇呢個 API' });
  } catch (e) {
    console.error('[api]', p, e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* ---------------- 開機 ---------------- */

idx.load();
server.listen(PORT, '0.0.0.0', () => {
  const st = idx.status();
  const nets = require('os').networkInterfaces();
  const lan = Object.values(nets).flat().find((n) => n && n.family === 'IPv4' && !n.internal);
  console.log('');
  console.log('  🛒  香港超市比價小幫手 已經開咗');
  console.log('  ─────────────────────────────────');
  console.log(`  本機：      http://localhost:${PORT}`);
  if (lan) console.log(`  同一 Wi-Fi：http://${lan.address}:${PORT}   ← iPad 用呢條`);
  console.log(`  百佳索引：  ${st.count} 件${st.builtAt ? `（${st.ageHours} 小時前更新）` : '（未起，撳一撳介面上嘅「更新百佳」）'}`);
  console.log('  ─────────────────────────────────');
  console.log('  Ctrl+C 熄機');
  console.log('');

  if (st.count && st.ageHours > 24) {
    console.log('[index] 索引超過一日，喺背景更新緊…');
    idx.build({ pages: 8 }).catch(() => {});
  }
});
