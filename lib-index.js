'use strict';
/* 百佳本地索引
 *
 * 百佳 robots.txt 明文 Disallow /search? ，所以我哋唔會去打佢個搜尋頁。
 * 改為由佢公佈嘅 sitemap 攞分類，行 robots 容許嘅分類頁，慢慢砌一份
 * 本地目錄，然後喺本機搜。好處：唔使每次搜尋都打人哋個站，而且即時。
 */

const fs = require('fs');
const path = require('path');
const S = require('./lib-stores.js');
// 詞庫、正規化同評分全部行 search-core —— server 同 iPad 靜態版一定要搜出同一個結果，
// 所以呢度唔會再自己抄一份 norm / headName / score。
const { synonyms, norm, scoreItem, headName } = require('./public/search-core.js');

const FILE = path.join(__dirname, 'data', 'pns-index.json');
// 每個分類最多行幾多版。行到冇新貨就會自己收，所以細分類唔會白行。
const PAGES_PER_CAT = 8;

let state = {
  builtAt: 0,
  running: false,
  progress: { done: 0, total: 0, current: '' },
  items: [],
  byId: new Map(),
};

let loadedMtime = 0;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state.builtAt = raw.builtAt || 0;
    state.items = raw.items || [];
    reindex();
    try { loadedMtime = fs.statSync(FILE).mtimeMs; } catch { /* 唔緊要 */ }
    return true;
  } catch { return false; }
}

/** 如果索引檔喺出面被人重建過（例如行咗 rebuild-index.js），自動讀返新嗰份 */
function maybeReload() {
  if (state.running) return false;
  try {
    if (fs.statSync(FILE).mtimeMs > loadedMtime) {
      console.log('[index] 偵測到索引檔更新咗，重新載入');
      return load();
    }
  } catch { /* 未有檔 */ }
  return false;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ builtAt: state.builtAt, count: state.items.length, items: state.items }));
    loadedMtime = fs.statSync(FILE).mtimeMs;
  } catch (e) { console.error('[index] 寫檔失敗:', e.message); }
}

function reindex() {
  state.byId = new Map(state.items.map((p) => [p.sku, p]));
  for (const p of state.items) {
    p._name = norm(`${p.name} ${p.brand || ''}`);   // 品牌都可以夾中（搵「屈臣氏」都得）
    p._head = norm(p.name);                          // 但判斷中心詞淨係睇商品名
    p._headClean = headName(p._head);                // 預先去埋規格尾巴，慳返每次搜尋成萬次正則
    p._cat = norm((p.categoryPath || []).join(' '));
    p._hay = `${p._name} ${p._cat}`;
  }
}

const status = () => ({
  builtAt: state.builtAt,
  count: state.items.length,
  running: state.running,
  progress: { ...state.progress },
  ageHours: state.builtAt ? Math.round((Date.now() - state.builtAt) / 36e5 * 10) / 10 : null,
});

/**
 * 本地搜尋（會自動用中英對照詞庫擴詞）
 * 評分行 search-core 嘅 scoreItem，偏重三樣：
 * 中心詞係咪喺個名尾、命中詞佔個名幾多、分類有冇對得上。
 */
function search(q, limit = 60, opts = {}) {
  const terms = [...new Set(synonyms(q).map(norm).filter(Boolean))];
  if (!terms.length) return [];
  const qn = norm(q);
  const scored = [];
  for (const p of state.items) {
    const s = scoreItem(p._name, p._cat, terms, qn, p._head,
      { catId: p.catId, includePets: !!opts.includePets, head: p._headClean });
    if (s) scored.push([s, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].price - b[1].price);
  // 分數帶埋出去，等 server 可以同惠康嘅結果一齊排
  return scored.slice(0, limit).map(([s, p]) => ({ ...stripInternal(p), rel: s }));
}

function stripInternal(p) {
  const { _hay, _name, _head, _headClean, _cat, ...rest } = p;
  return rest;
}

function all() { return state.items.map(stripInternal); }

/** 起／更新索引。onTick 會收到進度。 */
async function build({ pages = PAGES_PER_CAT, onTick = () => {}, signal } = {}) {
  if (state.running) return status();
  state.running = true;
  const started = Date.now();
  try {
    const tree = await S.parknshop.categoryTree();
    const cats = S.parknshop.leafCategories(tree);

    state.progress = { done: 0, total: cats.length, current: '' };
    const found = new Map(state.items.map((p) => [p.sku, p]));   // 保留舊資料，逐步覆蓋

    for (const c of cats) {
      if (signal && signal.aborted) break;
      state.progress.current = c.name;
      const seenHere = new Set();          // 呢個分類本身見過嘅貨（唔可以同舊索引比，唔係第一版就收工）
      for (let page = 1; page <= pages; page++) {
        try {
          const r = await S.parknshop.category(c.id, page, c.kind);
          if (!r.products.length) break;
          let fresh = 0;
          for (const p of r.products) {
            if (!seenHere.has(p.sku)) { seenHere.add(p.sku); fresh++; }
            found.set(p.sku, {
              ...p,
              // catId = 抓佢嗰個分類，靜態快照版靠佢做分類瀏覽
              catId: String(c.id),
              categoryPath: p.categoryPath?.length ? p.categoryPath : [c.top, c.mid, c.name].filter(Boolean),
            });
          }
          if (!fresh) break;               // 開始翻炒同一批，唔使再揭落去
        } catch (e) {
          console.error(`[index] ${c.name} p${page}: ${e.message}`);
          break;
        }
      }
      state.progress.done++;
      onTick(status());
    }

    state.items = [...found.values()];
    state.builtAt = Date.now();
    reindex();
    save();
    console.log(`[index] 完成：${state.items.length} 件，用咗 ${Math.round((Date.now() - started) / 1000)} 秒`);
  } finally {
    state.running = false;
    state.progress.current = '';
  }
  return status();
}

module.exports = { load, save, build, search, all, status, norm, maybeReload, get items() { return state.items; } };
