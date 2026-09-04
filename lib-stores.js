'use strict';
/* 惠康 (wellcome.com.hk) 同 百佳 / PNS (parknshop.com) 嘅抓取 + 正規化
 *
 * 兩間都係「一個動作 = 一次請求」，加上 lib-cache 嘅快取同節流，
 * 唔會連環掃站。百佳 robots.txt 明文 Disallow /search? ，所以百佳
 * 唔行佢個搜尋頁 —— 改為由 robots 容許嘅分類頁建本地索引再喺本機搜。
 */

const { parseSize, unitPrice, sizeLabel } = require('./lib-units.js');
const cache = require('./lib-cache.js');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* 免運門檻係兩間超市網站上寫嘅，佢哋改咗就要喺呢度改返 */
const STORES = {
  wellcome: {
    key: 'wellcome', name: '惠康', short: '惠', colour: '#E8467C',
    origin: 'https://www.wellcome.com.hk', freeDelivery: 500, freePickup: 50,
  },
  parknshop: {
    key: 'parknshop', name: '百佳', short: '百', colour: '#F0873C',
    origin: 'https://www.parknshop.com', freeDelivery: 399, freePickup: null,
  },
};

// 每個站兩次請求之間最少隔幾耐（毫秒）
const GAP = { 'www.wellcome.com.hk': 900, 'www.parknshop.com': 1500 };

class FetchError extends Error {
  constructor(msg, status) { super(msg); this.status = status; this.name = 'FetchError'; }
}

async function fetchText(url, { timeout = 25000, headers = {}, skipThrottle = false } = {}) {
  const host = new URL(url).host;
  if (!skipThrottle) await cache.throttle(host, GAP[host] || 1000);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal, redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.7',
        ...headers,
      },
    });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
    return await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new FetchError('請求逾時', 408);
    throw e;
  } finally { clearTimeout(t); }
}

/* 補商品圖係一版過嚟廿張，串行會慢到等唔切。放 4 條並行，
   總請求數同你用瀏覽器開嗰版差唔多，唔算狂掃。 */
let headSlots = 4;
const headQueue = [];
function acquireHead() {
  if (headSlots > 0) { headSlots--; return Promise.resolve(); }
  return new Promise((res) => headQueue.push(res));
}
function releaseHead() {
  const next = headQueue.shift();
  if (next) next(); else headSlots++;
}

/** 淨係讀開頭嗰段就收線 —— 惠康商品圖喺 <head> 嘅 og:image，唔使成 200KB 都落齊 */
async function fetchHeadText(url, maxBytes = 24000, timeout = 15000) {
  await acquireHead();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-HK,zh;q=0.9' },
    });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
    const reader = res.body.getReader();
    const chunks = [];
    let len = 0;
    while (len < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      len += value.length;
    }
    try { await reader.cancel(); } catch { /* 已經收線 */ }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(t); releaseHead(); }
}

/* ---------- 共用小工具 ---------- */

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp|apos);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[​‎﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) && s > 0 ? s : null;
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(String(s).replace(/[​\s]/g, ''));
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return isFinite(v) && v > 0 ? v : null;
}

// 百佳嘅 contentSizeUnit 有時唔係數量（EACH / PKT / PACK），當一件計
const COUNT_WORDS = /^(EACH|EA|PKT|PACK|PC|PCS|BTL|BOTTLE|BOX|BAG|TIN|CAN|TUB|SET|PAIR|ROLL|JAR|CTN|PUNNET)$/i;

/** 補上規格、單價、折扣等衍生欄位。sizeHint = 網站畀嘅正式規格（例如百佳嘅 320G） */
function decorate(p, sizeHint) {
  let hint = sizeHint == null ? null : String(sizeHint).trim();
  if (hint && COUNT_WORDS.test(hint)) hint = '1PC';
  else if (hint && !/\d/.test(hint)) hint = null;
  const size = parseSize(hint) || parseSize(p.name);
  p.size = size ? { kind: size.kind, base: size.base, raw: size.raw } : null;
  p.sizeText = size ? sizeLabel(size) : '';
  p.unitPrice = unitPrice(p.price, size);
  if (p.wasPrice && p.price && p.wasPrice > p.price) {
    p.discountPct = Math.round((1 - p.price / p.wasPrice) * 100);
  } else { p.wasPrice = null; p.discountPct = null; }
  p.storeName = STORES[p.store].name;
  p.storeColour = STORES[p.store].colour;
  p.promos = (p.promos || []).filter(Boolean).slice(0, 3);
  return p;
}

/* ================= 惠康 ================= */

const WC = STORES.wellcome.origin;

const WC_CATEGORIES = [
  { id: '100011', name: '水果及蔬菜', icon: '🥬' },
  { id: '100015', name: '肉類及海鮮', icon: '🥩' },
  { id: '100007', name: '乳製品・蛋・冷凍', icon: '🥛' },
  { id: '100003', name: '早餐及麵包', icon: '🥐' },
  { id: '100010', name: '急凍食品', icon: '🧊' },
  { id: '100020', name: '米、油及麵', icon: '🍚' },
  { id: '100004', name: '罐頭、醃製品及湯', icon: '🥫' },
  { id: '100005', name: '調味料及醬料', icon: '🧂' },
  { id: '100022', name: '朱古力、薯片、零食', icon: '🍫' },
  { id: '100002', name: '飲品', icon: '🧃' },
  { id: '100001', name: '酒類', icon: '🍷' },
  { id: '100013', name: '生活用品', icon: '🧻' },
  { id: '100014', name: '廚具及餐桌用品', icon: '🍽️' },
  { id: '100000', name: '個人護理', icon: '🧴' },
  { id: '100016', name: '母嬰用品', icon: '🍼' },
  { id: '100012', name: '醫藥保健', icon: '💊' },
  { id: '161256', name: '塑身保健', icon: '🌿' },
  { id: '100017', name: '戶外及旅行', icon: '🧳' },
  { id: '189651', name: '貓貓專區', icon: '🐱' },
  { id: '189941', name: '狗狗專區', icon: '🐶' },
  { id: '105591', name: '原箱優惠', icon: '📦' },
  { id: '100021', name: '節慶精選', icon: '🎁' },
];

function wcParseCards(html) {
  const out = [];
  const parts = html.split('class="ware-wrapper"');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 5000);
    const href = /href="(\/zh-hant\/wellcome\/p\/[^"]+)"/.exec(chunk);
    if (!href) continue;
    const skuM = /\/i\/(\d+)\.html/.exec(href[1]);
    if (!skuM) continue;

    const nameM = /class="promo"[^>]*>([^<]{1,200})</.exec(chunk);
    let name = nameM ? decodeEntities(nameM[1]) : '';
    if (!name) {
      try { name = decodeEntities(decodeURIComponent(href[1].split('/p/')[1].split('/i/')[0])); } catch { /* ignore */ }
    }
    if (!name) continue;

    const wasM = /class="line-price"[^>]*>([\s\S]{0,80}?)<\/div>/.exec(chunk);
    const bigM = /class="price"[^>]*>\s*\$?\s*([\d,]+(?:\.\d+)?)/.exec(chunk);
    const smallM = /class="small-price"[^>]*>\s*(\.\d+)/.exec(chunk);
    if (!bigM) continue;
    const price = parseFloat(bigM[1].replace(/,/g, '') + (smallM ? smallM[1] : ''));
    if (!isFinite(price) || price <= 0) continue;

    out.push(decorate({
      id: `wellcome:${skuM[1]}`,
      store: 'wellcome',
      sku: skuM[1],
      name,
      price,
      wasPrice: money(wasM && wasM[1]),
      url: WC + href[1],
      image: null,
      inStock: null,
      promos: [],
      enriched: false,
    }));
  }
  return out;
}

async function wcSearch(q, page = 1) {
  const url = `${WC}/zh-hant/wellcome/search?keyword=${encodeURIComponent(q)}&page=${page}`;
  return wcParseCards(await fetchText(url));
}

async function wcCategory(id, page = 1) {
  const url = `${WC}/zh-hant/wellcome/category/${encodeURIComponent(id)}/${page}.html`;
  return wcParseCards(await fetchText(url));
}

/** 逐件補資料：圖片、正式規格、產地、有冇貨、促銷標 */
async function wcDetail(sku) {
  const html = await fetchText(`${WC}/zh-hant/wellcome/p/x/i/${encodeURIComponent(sku)}.html`);
  const head = html.slice(0, 20000);

  const og = (prop) => {
    const m = new RegExp(`(?:name|property)="${prop}"\\s+content="([^"]*)"`).exec(head);
    return m ? decodeEntities(m[1]) : null;
  };

  const spec = {};
  const si = html.indexOf('class="size-line"');
  if (si >= 0) {
    const seg = html.slice(si, si + 4000);
    const re = /class="title"[^>]*>\s*([^<]{1,20}?)\s*<\/div>\s*<div class="value[^"]*"[^>]*>\s*([^<]{0,80}?)\s*</g;
    let m;
    while ((m = re.exec(seg)) !== null) {
      const k = decodeEntities(m[1]), v = decodeEntities(m[2]);
      if (k && v) spec[k] = v;
    }
  }

  // 同款規格卡：class 含 active 嘅係當前商品；同時含 out-of-stock 就係暫時缺貨
  let inStock = null;
  const promos = [];
  const cards = [...html.matchAll(/class="card ([^"]*)"[^>]*>([\s\S]{0,1500}?)(?=<div class="inline-block"|<\/div><\/div><\/div><\/div>)/g)];
  const active = cards.find((c) => /\bactive\b/.test(c[1]));
  if (active) {
    if (/\bout-of-stock\b/.test(active[1])) inStock = false;      // 明確缺貨
    for (const m of active[2].matchAll(/class="label[^"]*"[^>]*>\s*([^<]{1,40}?)\s*</g)) {
      const t = decodeEntities(m[1]);
      if (t && t !== '暫時缺貨' && !promos.includes(t)) promos.push(t);
    }
  }
  if (inStock === null) {
    // 第二個訊號：主商品區嘅「加入購物車」掣。搵唔到就照認未知，唔亂講有貨。
    const ai = html.indexOf('class="actions"');
    const actions = ai >= 0 ? html.slice(ai, ai + 1200) : '';
    if (/class="add-cart"/.test(actions) && !/disable|sold-?out|out-of-stock|缺貨|補貨|到貨通知/i.test(actions)) inStock = true;
    else if (/sold-?out|out-of-stock|暫時缺貨|到貨通知/i.test(actions)) inStock = false;
  }

  return {
    sku: String(sku),
    name: og('og:title'),
    image: og('og:image'),
    price: money(og('product:price:amount')),
    spec: spec['規格'] || null,
    origin: spec['產地'] || null,
    storage: spec['儲存方式'] || null,
    inStock, promos,
  };
}

/* ================= 百佳 / PNS ================= */

const PNS = STORES.parknshop.origin;

function ngState(html) {
  const m = /<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** 由 Angular SSR 狀態樹撈出所有真商品 */
function pnsProductsFrom(state) {
  const out = [], seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.code && o.url && o.price && typeof o.price.value === 'number' && !seen.has(o.code)) {
      seen.add(o.code); out.push(o);
    }
    for (const k of Object.keys(o)) walk(o[k]);
  })(state);
  return out;
}

function pnsImage(p) {
  const g = p.images && (p.images.PRIMARY || p.images.primary);
  if (!g) return null;
  for (const f of ['zoom', 'product', 'thumbnail', 'cartIcon']) if (g[f] && g[f].url) return g[f].url;
  const first = Object.values(g).find((v) => v && v.url);
  return first ? first.url : null;
}

function pnsPromos(p) {
  const out = [];
  for (const t of p.promotionTags || []) {
    const s = decodeEntities(typeof t === 'string' ? t : (t.name || t.label || t.description || ''));
    if (s) out.push(s.slice(0, 24));
  }
  if (p.topPromotion) {
    const s = decodeEntities(p.topPromotion.name || p.topPromotion.description || '');
    if (s) out.push(s.slice(0, 24));
  }
  for (const mb of p.elabFirstMultiBuyDatas || []) {
    if (mb.quantity && mb.totalDiscountedPrice) out.push(`${mb.quantity}件 ${mb.totalDiscountedPrice.formattedValue}`);
  }
  return [...new Set(out)];
}

function pnsMap(p) {
  const price = p.price && p.price.value;
  if (!price) return null;
  const was = (p.strikeThroughPrice && p.strikeThroughPrice.value)
    || (p.elabOldPrice && p.elabOldPrice.value) || null;
  const status = p.stock && p.stock.stockLevelStatus;
  const name = decodeEntities(p.ngProductNameWithoutHTMLTag || p.elabProductName || p.name);
  if (!name) return null;

  return decorate({
    id: `parknshop:${p.code}`,
    store: 'parknshop',
    sku: String(p.code),
    name,
    // masterBrand 有時淨係一舊 flag 物件，唔係字串就當冇品牌，唔好污染個名
    brand: typeof p.masterBrand === 'string' ? p.masterBrand
      : (p.masterBrand && typeof p.masterBrand.name === 'string' ? p.masterBrand.name : null),
    price,
    wasPrice: was,
    url: PNS + '/zh-hk' + (p.url.startsWith('/') ? '' : '/') + p.url,
    image: pnsImage(p),
    inStock: status ? status.toLowerCase() !== 'outofstock' : (p.purchasable === false ? false : null),
    origin: p.elabCountryOfOrigin || null,
    promos: pnsPromos(p),
    categoryPath: (p.categoryNameLevels || []).map((c) => c.name),
    enriched: true,
  }, p.contentSizeUnit);
}

/** 攞一版百佳分類。kind 要同 sitemap 一致：lc = 落腳頁（只列子分類）、c = 真係有貨 */
async function pnsCategory(code, page = 1, kind = 'c') {
  const seg = kind === 'lc' ? 'lc' : 'c';
  const url = `${PNS}/zh-hk/x/${seg}/${encodeURIComponent(code)}${page > 1 ? `?currentPage=${page - 1}` : ''}`;
  const html = await fetchText(url);
  const st = ngState(html);
  if (!st) return { products: [], categories: [] };
  return { products: pnsProductsFrom(st).map(pnsMap).filter(Boolean), categories: pnsHarvestCategories(html) };
}

/** 由頁面收割分類連結（名直接喺 URL 度） */
function pnsHarvestCategories(html) {
  const out = new Map();
  for (const m of html.matchAll(/"(\/[^"]{0,120}?\/(?:c|lc)\/(\d{8}))"/g)) {
    const parts = m[1].split('/').filter(Boolean);
    const name = decodeURIComponent(parts[parts.length - 3] || '');
    if (name && !out.has(m[2])) out.set(m[2], { id: m[2], name, path: m[1] });
  }
  return [...out.values()];
}

// 分類代碼係 8 位 XXYYZZWW：XX000000 = 大類、XXYY0000 = 中類、再落去係細類
const catLevel = (c) => (c.endsWith('000000') ? 1 : c.endsWith('0000') ? 2 : c.endsWith('00') ? 3 : 4);
const tidyName = (s) => s.replace(/\s*-\s*/g, ' ').replace(/\s*、\s*/g, '、').replace(/\s+/g, ' ').trim();

const PNS_ICONS = {
  '04': '🍱', '05': '🏠', '06': '🍼', '07': '🧴', '08': '🐾',
  '0401': '🧃', '0404': '🍚', '0405': '🥫', '0406': '🧂', '0407': '🍫',
  '0408': '🧊', '0409': '🥬', '0410': '🥐', '0411': '🦐', '0415': '🥩',
  '0501': '🧻', '0502': '🧽', '0503': '🍽️', '0505': '🧺', '0507': '🔌',
  '0701': '💄', '0703': '💇', '0704': '🦷', '0709': '💊', '0710': '🌿',
};

/** 完整分類樹 —— 由百佳自己公佈嘅 sitemap 攞（robots.txt 有指名） */
async function pnsCategoryTree() {
  const xml = await fetchText('https://www.pns.hk/sitemap_category_zh_HK_01.xml', { timeout: 30000 });
  const all = new Map();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    let u;
    try { u = decodeURIComponent(m[1]); } catch { continue; }
    const mm = /\/zh-hk\/(.+)\/(c|lc)\/(\d{8})$/.exec(u);
    if (!mm) continue;
    const segs = mm[1].split('/').filter(Boolean);
    const name = tidyName(segs[segs.length - 1] || '');
    if (!name || name === '主頁' || all.has(mm[3])) continue;
    all.set(mm[3], { id: mm[3], name, kind: mm[2], level: catLevel(mm[3]) });
  }

  const list = [...all.values()];
  const under = (pfx, lvl) => list.filter((x) => x.level === lvl && x.id.startsWith(pfx)).sort((a, b) => a.id.localeCompare(b.id));

  const groups = [];
  for (const l1 of list.filter((c) => c.level === 1).sort((a, b) => a.id.localeCompare(b.id))) {
    const children = under(l1.id.slice(0, 2), 2).map((l2) => ({
      id: l2.id, name: l2.name, kind: l2.kind, icon: PNS_ICONS[l2.id.slice(0, 4)] || '🛒',
      // 落腳頁本身冇貨，要行落第三層先攞到商品
      children: under(l2.id.slice(0, 4), 3).map((l3) => ({ id: l3.id, name: l3.name, kind: l3.kind })),
    }));
    if (children.length) groups.push({ id: l1.id, name: l1.name, icon: PNS_ICONS[l1.id.slice(0, 2)] || '🛒', children });
  }
  return groups;
}

/** 所有真係載到貨嘅分類（建索引用） */
function pnsLeafCategories(tree) {
  const out = [];
  for (const g of tree) {
    for (const l2 of g.children) {
      if (l2.children && l2.children.length) {
        for (const l3 of l2.children) out.push({ id: l3.id, kind: l3.kind, name: l3.name, top: g.name, mid: l2.name });
      } else if (l2.kind === 'c') {
        out.push({ id: l2.id, kind: l2.kind, name: l2.name, top: g.name, mid: l2.name });
      }
    }
  }
  return out;
}

async function pnsProduct(code) {
  const html = await fetchText(`${PNS}/zh-hk/x/p/${encodeURIComponent(code)}`);
  const st = ngState(html);
  if (!st) return null;
  const p = pnsProductsFrom(st).find((x) => x.code === code) || pnsProductsFrom(st)[0];
  return p ? pnsMap(p) : null;
}

module.exports = {
  STORES, FetchError, fetchText, fetchHeadText, decodeEntities, money, decorate, ngState,
  wellcome: { search: wcSearch, category: wcCategory, detail: wcDetail, parseCards: wcParseCards, CATEGORIES: WC_CATEGORIES },
  parknshop: {
    category: pnsCategory, product: pnsProduct, harvest: pnsHarvestCategories,
    map: pnsMap, productsFrom: pnsProductsFrom, categoryTree: pnsCategoryTree, leafCategories: pnsLeafCategories,
  },
};
