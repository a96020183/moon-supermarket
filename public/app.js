/* 買餸小幫手 —— 前端。冇框架，純 JS。 */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (p) => fetch(p).then((r) => r.json());

/* ---------------- 本機儲存 ---------------- */

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('hkpb.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hkpb.' + k, JSON.stringify(v)); } catch { /* 無痕模式會擲錯 */ } },
};

let LIST = store.get('list', []);
let FAVS = store.get('favs', []);
let SAVED = store.get('saved', []);
let RECENT = store.get('recent', []);
let BOOT = null;
let LAST = [];            // 最近一次搜尋結果（畀篩選重畫用）
let CTX = 'find';         // find | cat | fav

/* 搜尋核心（search-core.js）—— server 同靜態版共用同一套詞庫同評分 */
const SC = window.SearchCore;

/* 靜態模式：冇 server 就攞 public/data/ 嗰份快照，全部嘢喺瀏覽器度計 */
const STATIC = {
  on: false,
  meta: null,
  rows: [],           // { p:貨品, n:正規化名, c:正規化分類 }
  byId: new Map(),    // 貨品 id → row
  kids: new Map(),    // 「store:分類id」→ 佢自己同所有仔孫嘅 id
};

const saveAll = () => { store.set('list', LIST); store.set('favs', FAVS); store.set('saved', SAVED); store.set('recent', RECENT); };

/* ---------------- 細工具 ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : (Math.round(n * 100) / 100).toFixed(n % 1 === 0 ? 0 : 2));
// 靜態版冇 server 代理，直接用商品原本條圖 URL
const imgSrc = (u) => (!u ? '' : STATIC.on ? u : '/api/img?u=' + encodeURIComponent(u));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2000);
}

function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

/* 貨品去咗清單／收藏未 */
const inList = (id) => LIST.some((x) => x.id === id);
const inFavs = (id) => FAVS.some((x) => x.id === id);

/* ---------------- 商品卡 ---------------- */

const ICON_FOR = [
  [/奶|milk|乳|芝士|cheese|yog/i, '🥛'], [/蛋\b|雞蛋|egg/i, '🥚'], [/包|麵包|bread|toast/i, '🍞'],
  [/米\b|rice/i, '🍚'], [/麵|noodle|pasta/i, '🍜'], [/雞|chicken/i, '🍗'], [/豬|pork/i, '🥓'],
  [/牛肉|beef/i, '🥩'], [/魚|salmon|fish|蝦|prawn/i, '🐟'], [/菜|vegetable|生菜|菠菜/i, '🥬'],
  [/蘋果|apple/i, '🍎'], [/蕉|banana/i, '🍌'], [/橙|orange|柑/i, '🍊'], [/提子|grape/i, '🍇'],
  [/士多啤梨|strawberry|莓/i, '🍓'], [/水|water/i, '💧'], [/汽水|可樂|cola|coke|soda/i, '🥤'],
  [/咖啡|coffee/i, '☕'], [/茶\b|tea/i, '🍵'], [/酒|wine|beer/i, '🍷'], [/薯片|chips|零食|snack/i, '🍿'],
  [/朱古力|chocolate/i, '🍫'], [/雪糕|ice cream/i, '🍦'], [/餅|biscuit|cookie/i, '🍪'],
  [/廁紙|紙巾|tissue|toilet/i, '🧻'], [/洗頭|shampoo|髮/i, '🧴'], [/洗衣|detergent/i, '🧺'],
  [/牙膏|牙刷|tooth/i, '🪥'], [/尿片|diaper|嬰/i, '🍼'], [/貓|cat/i, '🐱'], [/狗|dog/i, '🐶'],
  [/清潔|cleaner|洗潔/i, '🧽'],
];
const iconFor = (name) => (ICON_FOR.find(([re]) => re.test(name)) || [null, '🛒'])[1];

function cardHTML(p) {
  const added = inList(p.id);
  const faved = inFavs(p.id);
  const promo = (p.promos || [])[0];
  return `
  <article class="card ${p.inStock === false ? 'out' : ''}" data-id="${esc(p.id)}">
    <div class="card-img" data-thumb="${p.store === 'wellcome' && !p.image ? esc(p.sku) : ''}">
      ${p.image ? `<img src="${imgSrc(p.image)}" alt="" loading="lazy">` : `<span class="ph">${iconFor(p.name)}</span>`}
      <div class="badges">
        <span class="badge store-${p.store}">${p.storeName}</span>
        ${p.discountPct ? `<span class="badge off">-${p.discountPct}%</span>` : ''}
        ${p.isLowest && p.lowest ? '<span class="badge low">最低價</span>' : ''}
      </div>
      <button class="fav-btn ${faved ? 'on' : ''}" data-act="fav" aria-label="收藏">${faved ? '💗' : '♡'}</button>
      ${p.inStock === false ? '<div class="out-tag">暫時缺貨</div>' : ''}
    </div>
    <div class="card-body">
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-meta">
        ${p.sizeText ? `<span class="pill size">${esc(p.sizeText)}</span>` : ''}
        ${p.inStock === true ? '<span class="pill stock-yes">有貨</span>' : ''}
        ${p.inStock === false ? '<span class="pill stock-no">缺貨</span>' : ''}
        ${isPet(p) ? '<span class="pill pet">🐾 寵物</span>' : ''}
        ${promo ? `<span class="pill promo">${esc(promo)}</span>` : ''}
      </div>
      <div class="card-foot">
        <div class="price-box">
          <div class="price">$${fmt(p.price)}${p.wasPrice ? `<span class="was">$${fmt(p.wasPrice)}</span>` : ''}</div>
          ${p.unitPrice ? `<div class="unit-price">${esc(p.unitPrice.text)}</div>` : ''}
        </div>
        <button class="add-btn ${added ? 'in' : ''}" data-act="add" aria-label="加入清單">${added ? '✓' : '＋'}</button>
      </div>
      ${altLine(p)}
    </div>
  </article>`;
}

/**
 * 惠康卡片下面嗰行細字：百佳同款貨幾多錢。
 * 佢主要買惠康，呢行淨係「順便話佢知」，唔會搶戲。夾唔夠似就唔顯示。
 */
function altLine(p) {
  const a = p.alt;
  if (!a || !a.price || p.store !== 'wellcome') return '';
  const d = p.price - a.price;
  const tag = d > 0.009 ? `<b class="alt-cheap">平 $${fmt(d)}</b>`
    : d < -0.009 ? `<span class="alt-dear">貴 $${fmt(-d)}</span>`
      : '<span>同價</span>';
  // 規格唔一樣就一定要寫出嚟 —— 唔講就變咗攞唔同大細嘅嘢嚟比，好誤導
  const size = a.sizeText && a.sizeText !== p.sizeText ? `<span class="alt-size">${esc(a.sizeText)}</span>` : '';
  return `<div class="alt-line" title="${esc(a.name)}">
    <span class="alt-tag">百佳</span> $${fmt(a.price)} ${size} ${tag}
  </div>`;
}

function renderGrid(el, products) {
  seeProducts(products);            // 畫得出嚟就一定撳得返，唔可以再靠 LAST
  if (!products.length) { el.innerHTML = ''; return; }
  el.innerHTML = products.map(cardHTML).join('');
  hydrateThumbs(el);
}

/* 惠康列表冇圖，逐張慢慢補（只讀網頁開頭，好慳） */
let thumbObserver;
function hydrateThumbs(root) {
  if (STATIC.on) return;                       // 靜態版冇 /api/thumb，快照有咩圖就用咩圖
  if (!('IntersectionObserver' in window)) return;
  thumbObserver = thumbObserver || new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const box = e.target;
      thumbObserver.unobserve(box);
      const sku = box.dataset.thumb;
      if (!sku) continue;
      box.dataset.thumb = '';
      api('/api/thumb?sku=' + encodeURIComponent(sku)).then((r) => {
        if (!r || !r.image) return;
        // 寫返落貨品物件度，之後加落清單／收藏就有埋張圖
        for (const p of SEEN.values()) if (p.store === 'wellcome' && p.sku === sku && !p.image) p.image = r.image;
        for (const arr of [LAST, FAVS, LIST]) {
          const p = arr.find((x) => x.store === 'wellcome' && x.sku === sku);
          if (p && !p.image) p.image = r.image;
        }
        const img = new Image();
        img.loading = 'lazy';
        img.alt = '';
        img.onload = () => { const ph = box.querySelector('.ph'); if (ph) ph.replaceWith(img); };
        img.src = imgSrc(r.image);
      }).catch(() => {});
    }
  }, { rootMargin: '350px' });
  $$('.card-img[data-thumb]:not([data-thumb=""])', root).forEach((b) => thumbObserver.observe(b));
}

/* ---------------- 卡片動作 ---------------- */

/**
 * 畫過／攞過嘅貨品全部登記喺呢度，撳落張卡先搵得返件貨。
 *
 * 舊版淨係靠 LAST 一個陣列。但 LAST 每次搜尋、每次入分類都會成個換走，
 * 而「搵嘢」嗰版啲卡仲原封不動咁留喺畫面度 —— 件貨已經唔喺 LAST，
 * findProduct 返 undefined，撳 ♡ 同 ＋ 就靜靜哋乜都唔做。
 * （實測撞法：搵「啤酒」→ 入「分類」撳一個 → 撳返「搵嘢」→ 啲啤酒卡個 ♡ 死晒。）
 * 所以改用一個唔會被覆蓋嘅登記處：畫得出嚟就一定撳得返，滿咗先由最舊嗰件開始踢。
 */
const SEEN = new Map();
const SEEN_CAP = 4000;

function seeProducts(products) {
  for (const p of products || []) {
    if (!p || !p.id) continue;
    if (SEEN.has(p.id)) SEEN.delete(p.id);        // 行返去隊尾，變相 LRU
    SEEN.set(p.id, p);
  }
  while (SEEN.size > SEEN_CAP) SEEN.delete(SEEN.keys().next().value);
}

function findProduct(id) {
  return SEEN.get(id) || FAVS.find((p) => p.id === id) || LIST.find((p) => p.id === id);
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  const card = ev.target.closest('.card, .match-row');
  if (btn && card) {
    ev.stopPropagation();
    const p = findProduct(card.dataset.id);
    // 真係搵唔返就至少嗌一聲 —— 舊版喺呢度靜靜哋 return，用家淨係覺得「撳極都冇反應」
    if (!p) { toast('呢件貨嘅資料唔見咗，搵多次先'); return; }
    if (btn.dataset.act === 'add') { toggleList(p); redrawCards(); }
    if (btn.dataset.act === 'fav') { toggleFav(p); redrawCards(); }
    return;
  }
  if (card) {
    const p = findProduct(card.dataset.id);
    if (p) openItem(p);
    else toast('呢件貨嘅資料唔見咗，搵多次先');
  }
});

function toggleList(p) {
  haptic();
  const i = LIST.findIndex((x) => x.id === p.id);
  if (i >= 0) { LIST.splice(i, 1); toast('已經由清單拎走'); }
  else { LIST.push({ ...p, qty: 1 }); toast(`已加入清單 · ${p.name.slice(0, 14)}`); }
  saveAll(); refreshCounts(); renderList();
}

function toggleFav(p) {
  haptic();
  const i = FAVS.findIndex((x) => x.id === p.id);
  if (i >= 0) { FAVS.splice(i, 1); toast('已取消收藏'); }
  else { FAVS.push(p); toast('已收藏 💗 下次一撳就加返'); }
  saveAll(); refreshCounts(); renderFavs();
}

function redrawCards() {
  for (const card of $$('.card, .match-row')) {
    const id = card.dataset.id;
    const add = card.querySelector('[data-act="add"]');
    const fav = card.querySelector('[data-act="fav"]');
    if (add) { const on = inList(id); add.classList.toggle('in', on); add.textContent = on ? '✓' : '＋'; }
    if (fav) { const on = inFavs(id); fav.classList.toggle('on', on); fav.textContent = on ? '💗' : '♡'; }
  }
}

function refreshCounts() {
  const n = LIST.reduce((s, x) => s + (x.qty || 1), 0);
  const badge = $('#listBadge');
  badge.textContent = n; badge.hidden = !n;
  const lc = $('#listCount'); lc.textContent = LIST.length; lc.classList.toggle('show', !!LIST.length);
  const fc = $('#favCount'); fc.textContent = FAVS.length; fc.classList.toggle('show', !!FAVS.length);
}

/* ---------------- 靜態模式引擎 ----------------
 *
 * 部電腦熄咗機、或者成個 public/ 擺咗上 GitHub Pages 嗰陣，係冇 /api 可以打嘅。
 * 咁就改為載 public/data/ 嗰三份快照，搜尋、分類、比價全部喺瀏覽器度計。
 * 評分行嘅係 search-core.js —— 同 server 果套一模一樣，所以搵出嚟嘅次序一致。
 */

/** 三份快照並行載，順手砌好搜尋要用嘅正規化欄位同分類樹 */
async function loadSnapshot() {
  const grab = (f) => fetch('data/' + f, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(f + ' HTTP ' + r.status);
    return r.json();
  });
  const [meta, wc, pns] = await Promise.all([grab('meta.json'), grab('wellcome.json'), grab('parknshop.json')]);

  // 分類 id → 中文名。惠康件貨淨係得個 catId，要靠呢個查返個名先計到「分類命中」分。
  const catName = new Map();
  const walkNames = (store) => function walk(nodes, trail) {
    for (const n of nodes || []) {
      const path = [...trail, n.name];
      catName.set(store + ':' + n.id, path.join(' '));
      walk(n.children, path);
    }
  };
  // 惠康而家 catId 記葉分類，所以要行埋子分類 —— 順手令分類命中分更準
  // （「貓貓專區 貓乾糧」比淨得個「貓貓專區」講得清楚）
  walkNames('wellcome')(meta.categories?.wellcome || [], []);
  walkNames('parknshop')(meta.categories?.parknshop || [], []);

  STATIC.meta = meta;
  STATIC.rows = [...(wc.items || []), ...(pns.items || [])].map((p) => {
    const cat = p.categoryPath?.length ? p.categoryPath.join(' ') : (catName.get(p.store + ':' + p.catId) || '');
    // h = 淨係商品名，用嚟認中心詞（連品牌一齊擺就會認唔到「…全脂牛奶」係奶）
    const h = SC.norm(p.name);
    // hc = 預先去埋規格同括號備註嘅「淨名」，唔預先算嘅話每次搜尋要行成萬次正則。
    // 一定要由**原始**個名度整（cleanHead），唔可以 headName(h) —— h 已經 norm 咗，
    // 括號畀 norm 換成空格，「(包裝隨機發放)」就會賴死喺淨名度，認唔到中心詞。
    return { p, n: SC.norm(`${p.name} ${p.brand || ''}`), h, hc: SC.cleanHead(p.name), hr: SC.headRawOf(p.name), c: SC.norm(cat) };
  });
  STATIC.byId = new Map(STATIC.rows.map((r) => [r.p.id, r]));
  buildCatKids(meta);
  STATIC.on = true;
}

/** 撳中類（例如「紙巾、廁紙」）都要出到入面所有細類嘅貨，所以預先攤平佢 */
function buildCatKids(meta) {
  STATIC.kids = new Map();
  const walk = (store) => function w(n) {
    const set = new Set([String(n.id)]);
    for (const k of n.children || []) for (const id of w(k)) set.add(id);
    STATIC.kids.set(store + ':' + n.id, set);
    return set;
  };
  // 惠康都要攤平：件貨記住嘅係葉分類 id，撳頂層要出得返佢啲仔孫嘅貨
  for (const c of meta.categories?.wellcome || []) walk('wellcome')(c);
  for (const g of meta.categories?.parknshop || []) walk('parknshop')(g);
}

/** 一間超市入面搵。同 server 一樣用同義詞展開，分數帶埋出去等兩間可以撈埋一齊排。 */
function staticSearch(q, limit, store, opts = {}) {
  const terms = [...new Set(SC.synonyms(q).map(SC.norm).filter(Boolean))];
  if (!terms.length) return [];
  const qn = SC.norm(q);
  const out = [];
  for (const r of STATIC.rows) {
    if (store && r.p.store !== store) continue;
    const s = SC.scoreItem(r.n, r.c, terms, qn, r.h,
      { catId: r.p.catIds && r.p.catIds.length ? r.p.catIds : r.p.catId,
        topId: r.p.topIds && r.p.topIds.length ? r.p.topIds : r.p.topId, includePets: !!opts.includePets, head: r.hc, headRaw: r.hr });
    if (s) out.push({ ...r.p, rel: s });
  }
  out.sort((a, b) => b.rel - a.rel || a.price - b.price);
  return out.slice(0, limit || 60);
}

/**
 * 兩間各自搵夠數先撈埋一齊排，唔係一間夠勁就會食晒個榜、另一間得零星幾件。
 * 惠康係主場（朋友主要買惠康），所以同分數嗰陣惠康行先。
 */
function staticSearchBoth(q, stores, opts = {}) {
  const out = [];
  for (const s of stores) out.push(...staticSearch(q, 60, s, opts));
  out.sort((a, b) => (b.rel || 0) - (a.rel || 0)
    || (a.store === 'wellcome' ? -1 : 0) - (b.store === 'wellcome' ? -1 : 0)
    || a.price - b.price);
  return out;
}

function staticCategory(store, id) {
  const ids = STATIC.kids.get(store + ':' + id) || new Set([String(id)]);
  // 一件貨可以同時屬幾個分類，夾中任何一個就要出 ——
  // 淨係睇主分類（catId）會令「廚具及餐桌用品」由 232 件跌到 157 件。
  return STATIC.rows.filter((r) => {
    if (r.p.store !== store) return false;
    const mine = r.p.catIds && r.p.catIds.length ? r.p.catIds : [r.p.catId];
    return mine.some((c) => ids.has(String(c)));
  }).map((r) => r.p);
}

/* ---- 比價：抄返 server 嗰套思路（中心詞 + 分類 + 規格接近） ---- */

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

/** 一件貨可以用幾個字詞去另一間搵：先用完整關鍵詞，唔得就退返用尾嗰幾個中文字（中心詞） */
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

/** 兩件貨有幾似。catNormB 係對面件貨嘅分類（已經正規化好）。 */
function similarity(a, b, sizeA, sizeB, catNormB) {
  const na = SC.norm(a), nb = SC.norm(b);
  const chars = (s) => [...s.replace(/\s/g, '')].filter((c) => SC.hasCJK(c));
  const ta = new Set(na.split(/\s+/).concat(chars(na)));
  const tb = new Set(nb.split(/\s+/).concat(chars(nb)));
  let hit = 0;
  for (const t of ta) if (t && tb.has(t)) hit++;
  let score = ta.size ? (hit / ta.size) * 100 : 0;

  // 詞庫同義詞都當夾中（廁紙 ↔ 衛生紙 ↔ toilet paper）
  const key = keywordsFrom(a);
  const cat = catNormB || '';
  let synHit = false, catHit = false;
  for (const syn of SC.synonyms(key)) {
    const s = SC.norm(syn);
    if (!s) continue;
    if (!synHit && nb.includes(s)) synHit = true;
    if (!catHit && cat && cat.includes(s)) catHit = true;
  }
  if (synHit) score += 25;
  if (catHit) score += 25;                 // 分類啱＝真係同一類貨，唔係得個名似

  // 「雞蛋」夾到「雞蛋饅頭」咁嘅情況：命中詞喺人哋個名度佔得好少就扣返啲
  const kn = SC.norm(key);
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

const catNormOf = (p) => (STATIC.byId.get(p.id) || {}).c || '';

/** 另一間超市有冇似樣嘅貨 */
function staticCompare(src) {
  const res = [];
  const seen = new Set();
  const stores = ['wellcome', 'parknshop'].filter((s) => s !== src.store);
  for (const key of compareKeys(src.name)) {
    for (const s of stores) {
      for (const p of staticSearch(key, 12, s)) if (!seen.has(p.id)) { seen.add(p.id); res.push(p); }
    }
    if (res.length >= 12) break;
  }
  return res
    .map((p) => ({ ...p, matchScore: similarity(src.name, p.name, src.size, p.size, catNormOf(p)) }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 8);
}

/** 成張清單格價：每件貨喺兩間各揀最夾嗰件 */
function staticListCompare(items) {
  return items.slice(0, 40).map((it) => {
    const row = { name: it.name, qty: it.qty || 1, wellcome: null, parknshop: null };
    // 完整關鍵詞搵唔到就退返用中心詞再試（「維達 超韌廁紙 10卷」→「超韌廁紙」→「廁紙」）。
    // server 版淨係試第一個，因為佢每試一個就要打多次上游；喺本機搵就冇呢個成本。
    for (const key of compareKeys(it.name || '')) {
      for (const s of ['wellcome', 'parknshop']) {
        if (!row[s]) row[s] = staticBest(it, staticSearch(key, 20, s));
      }
      if (row.wellcome && row.parknshop) break;
    }
    return row;
  });
}

/**
 * 靜態版：每件惠康貨附返百佳最接近嗰件嘅價（同 server 嘅 attachAlt 一樣意思）。
 * 只做頭 cap 件 —— 卡片一開頭就係咁多，唔使成千件都計。
 */
function staticAttachAlt(products, cap = 40) {
  let n = 0;
  for (const p of products) {
    if (p.store !== 'wellcome' || p.alt !== undefined) continue;
    if (n >= cap) break;
    n++;
    const cands = [];
    for (const key of compareKeys(p.name)) {
      for (const c of staticSearch(key, 10, 'parknshop')) cands.push(c);
      if (cands.length >= 10) break;
    }
    const m = staticBest(p, cands);
    p.alt = m ? {
      store: 'parknshop', storeName: '百佳', id: m.id, sku: m.sku,
      name: m.name, price: m.price, sizeText: m.sizeText, matchScore: m.matchScore,
    } : null;
  }
  return products;
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

function staticBest(item, list) {
  if (!list.length) return null;
  const scored = list
    .filter((p) => sizeComparable(item.size, p.size))
    .map((p) => ({ p, s: similarity(item.name || '', p.name, item.size, p.size, catNormOf(p)) }))
    .sort((a, b) => b.s - a.s || a.p.price - b.p.price);
  const top = scored[0];
  // 夾唔夠似就寧願話搵唔到，好過畀個錯嘅價錢佢
  return top && top.s >= 55 ? { ...top.p, matchScore: top.s } : null;
}

/* ---------------- 資料層：有 server 行 API，冇就行快照 ---------------- */

const DATA = {
  search(q, opts = {}) {
    const stores = opts.stores || ['wellcome', 'parknshop'];
    // 平時寵物糧會被壓低（唔好霸住買餸嘅頭位）；開咗「只睇寵物」就要唔扣分咁搵過
    const pets = !!opts.includePets;
    if (!STATIC.on) {
      return api(`/api/search?q=${encodeURIComponent(q)}&stores=${stores.join(',')}`
        + (opts.sort ? `&sort=${opts.sort}` : '') + (pets ? '&pets=1' : ''));
    }
    return Promise.resolve({
      products: staticAttachAlt(staticSearchBoth(q, stores, { includePets: pets })),
      queries: SC.expandQuery(q, 2),
      notes: [],
    });
  },

  searchPage(q, store, page) {
    return api(`/api/search?q=${encodeURIComponent(q)}&stores=${store}&page=${page}`);
  },

  category(store, id, kind, sort, page) {
    if (!STATIC.on) {
      return api(`/api/category?store=${store}&id=${encodeURIComponent(id)}`
        + `&kind=${encodeURIComponent(kind || 'c')}${page ? `&page=${page}` : ''}&sort=${sort}`);
    }
    return Promise.resolve({ products: staticAttachAlt(staticCategory(store, id)) });
  },

  item(p) {
    if (!STATIC.on) return api(`/api/item?store=${p.store}&sku=${encodeURIComponent(p.sku)}`).catch(() => ({}));
    return Promise.resolve((STATIC.byId.get(p.id) || {}).p || {});   // 快照本身已經有規格／庫存／促銷
  },

  history(id) {
    if (!STATIC.on) return api(`/api/history?id=${encodeURIComponent(id)}`).catch(() => ({}));
    return Promise.resolve({});      // 靜態版得一個時間點，冇走勢好睇
  },

  compare(p) {
    if (!STATIC.on) {
      return api(`/api/compare?name=${encodeURIComponent(p.name)}&exclude=${p.store}`).catch(() => ({ matches: [] }));
    }
    return Promise.resolve({ matches: staticCompare(p) });
  },

  listCompare(list) {
    if (!STATIC.on) {
      return fetch('/api/list-compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: list.map((p) => ({ name: p.name, qty: p.qty || 1 })) }),
      }).then((x) => x.json());
    }
    return Promise.resolve({ rows: staticListCompare(list) });
  },
};

/* ---------------- 搵嘢 ---------------- */

let searchTimer, searchSeq = 0;
const FIND_EMPTY_HTML = $('#findEmpty').innerHTML;   // 留返原本嗰段，搵唔到嘢之後可以還原
let findPage = { q: '', page: 1 };                   // 「睇多啲」用

function currentFilters() {
  return {
    store: $('#storeSeg .is-on').dataset.store,
    sort: $('#sortSel').value,
    stockOnly: $('#stockOnly').checked,
    dealOnly: $('#dealOnly').checked,
    petOnly: $('#petOnly').checked,
  };
}

/** 呢件貨係咪寵物用品（百佳 08 開頭、惠康貓貓／狗狗專區） */
// 傳晒所有分類身份 —— 原箱貓糧同時屬「原箱優惠」同「貓貓專區」，淨睇主分類會甩標籤
const isPet = (p) => !!(SC && SC.isPetCat
  && SC.isPetCat(p.catIds && p.catIds.length ? p.catIds : p.catId,
                 p.topIds && p.topIds.length ? p.topIds : p.topId));

function applyFilters(list) {
  const f = currentFilters();
  // 「分類」入面已經係揀緊某一間超市嘅分類，唔可以再套搜尋嗰個店舖篩選，
  // 唔係就會出現「狀態寫住 160 件、但一張卡都冇」呢種自相矛盾。
  const byStore = CTX !== 'cat';
  const out = list.filter((p) => {
    if (byStore && f.store !== 'all' && p.store !== f.store) return false;
    if (f.stockOnly && p.inStock === false) return false;
    if (f.dealOnly && !p.discountPct) return false;
    if (f.petOnly && !isPet(p)) return false;
    return true;
  });

  // 喺前端都排一次，撳完即刻見到，唔使等 server
  if (f.sort === 'price') out.sort((a, b) => a.price - b.price);
  else if (f.sort === 'discount') out.sort((a, b) => (b.discountPct || 0) - (a.discountPct || 0));
  else if (f.sort === 'unit') {
    out.sort((a, b) => {
      const au = a.unitPrice, bu = b.unitPrice;
      if (au && bu && au.per === bu.per) return au.value - bu.value;
      if (au && !bu) return -1;
      if (!au && bu) return 1;
      return a.price - b.price;
    });
  }
  return out;
}

/** LAST 只留唯一貨品，免得愈積愈多。真正嘅「撳得返」靠 SEEN，唔靠呢個。 */
function remember(products) {
  seeProducts(products);
  const seen = new Set(LAST.map((p) => p.id));
  for (const p of products) if (!seen.has(p.id)) { seen.add(p.id); LAST.push(p); }
  if (LAST.length > 800) LAST = LAST.slice(-500);
}

function redrawCurrent() {
  const target = CTX === 'cat' ? '#catResults' : CTX === 'fav' ? '#favResults' : '#results';
  renderGrid($(target), applyFilters(CTX === 'fav' ? FAVS : LAST));
}

async function doSearch(q) {
  const seq = ++searchSeq;
  CTX = 'find';
  const status = $('#findStatus');
  $('#findEmpty').hidden = true;
  $('#toolbar').hidden = false;
  status.innerHTML = '<span class="spinner"></span>搵緊…';
  $('#results').innerHTML = Array(6).fill('<div class="card sk-card skeleton"></div>').join('');

  try {
    // 一次過攞兩間，之後嘅篩選／排序全部喺本機做，撳完即刻有反應
    const r = await DATA.search(q, {
      stores: ['wellcome', 'parknshop'],
      includePets: $('#petOnly').checked,
    });
    if (seq !== searchSeq) return;
    LAST = r.products || [];
    seeProducts(LAST);              // 畀篩選隱起咗嗰啲，放寬返都要撳得到
    const shown = applyFilters(LAST);
    renderGrid($('#results'), shown);

    const bits = [`搵到 <b>${shown.length}</b> 件`];
    if (r.queries && r.queries.length > 1) bits.push(`同埋幫你搵埋「${esc(r.queries.slice(1).join('、'))}」`);
    for (const n of r.notes || []) bits.push(esc(n.message));
    status.innerHTML = bits.join(' · ');

    if (!shown.length) {
      /* 惠康「暫時缺貨」嘅貨唔會出現喺佢自己嘅分類列表同搜尋，所以我哋亦都爬唔到 ——
         唯一搵得返嘅方法係 Google（朋友就係咁樣搵到兩款寬粉嘅）。
         搵唔到嘢嗰陣畀返條路出去，好過畀人以為間鋪真係冇賣。 */
      const gg = 'https://www.google.com/search?q=' + encodeURIComponent('site:wellcome.com.hk ' + q);
      const wc = 'https://www.wellcome.com.hk/zh-hant/wellcome/search?keyword=' + encodeURIComponent(q);
      $('#findEmpty').hidden = false;
      $('#findEmpty').innerHTML = '<div class="empty-art">🫧</div>'
        + '<p class="empty-title">搵唔到啱嘅嘢</p>'
        + '<p class="empty-sub">試下換個講法，或者放寬上面嘅篩選</p>'
        + '<p class="empty-sub empty-out">如果係暫時缺貨嘅貨品，惠康自己個網都唔會出佢<br>'
        + '<a href="' + gg + '" target="_blank" rel="noopener">🔍 Google 搵惠康全站</a>'
        + ' · <a href="' + wc + '" target="_blank" rel="noopener">去惠康網站搵</a><br>'
        + '搵到嘅話話我知，我加返落去 💗</p>';
    }
    findPage = { q, page: 1 };
    // 靜態版所有貨已經喺手，「睇多啲」冇嘢可以攞，收埋佢
    $('#moreFind').hidden = STATIC.on || !shown.length;
    rememberSearch(q);
    // 網址跟住搜尋字變，refresh 或者 bookmark 返嚟都仲喺同一個結果
    try { history.replaceState(null, '', '?q=' + encodeURIComponent(q)); } catch { /* file:// 會擲錯 */ }
  } catch (e) {
    if (seq !== searchSeq) return;
    status.textContent = '搵嘢時出咗問題：' + e.message;
    $('#results').innerHTML = '';
  }
}

function rememberSearch(q) {
  RECENT = [q, ...RECENT.filter((x) => x !== q)].slice(0, 8);
  saveAll();
  renderChips();
}

function renderChips() {
  const el = $('#quickChips');
  const parts = [];
  if (RECENT.length) {
    parts.push('<span class="chip-label">頭先搵過</span>');
    // 一格分兩橛：左邊撳落去再搵一次，右邊個 ✕ 剷走佢。
    // ✕ 唔可以塞入個 chip 掣入面（button 唔可以套 button），所以外面包一層 span。
    // 兩橛之間有條線分開，✕ 有成 36×40 —— 手指粗都唔會撳錯。
    parts.push(...RECENT.map((t) => `<span class="chip recent"
      ><button class="chip-go" data-q="${esc(t)}">${esc(t)}</button
      ><button class="chip-x" data-drop="${esc(t)}" aria-label="剷走「${esc(t)}」">✕</button
    ></span>`));
    parts.push('<button class="chip chip-clear" data-clear="1">清走全部</button>');
  }
  parts.push('<span class="chip-label">大家都搵</span>');
  parts.push(...(BOOT?.popular || []).map((t) => `<button class="chip" data-q="${esc(t)}">${esc(t)}</button>`));
  el.innerHTML = parts.join('');
}

/** 剷走一個「頭先搵過」 */
function dropRecent(q) {
  const n = RECENT.length;
  RECENT = RECENT.filter((t) => t !== q);
  if (RECENT.length === n) return;
  haptic(); saveAll(); renderChips();
  toast(`剷走咗「${q.slice(0, 10)}」`);
}

/** 成行「頭先搵過」清走 */
function clearRecent() {
  if (!RECENT.length) return;
  RECENT = [];
  haptic(); saveAll(); renderChips();
  toast('頭先搵過嗰啲，清走晒喇');
}

$('#quickChips').addEventListener('click', (e) => {
  // ✕ 同「清走全部」要行喺前面 —— 唔攔住就會跌落去下面順手再搵多次
  const x = e.target.closest('[data-drop]');
  if (x) { dropRecent(x.dataset.drop); return; }
  if (e.target.closest('[data-clear]')) { clearRecent(); return; }
  const c = e.target.closest('[data-q]');
  if (!c) return;
  $('#search').value = c.dataset.q;
  $('#searchClear').hidden = false;
  doSearch(c.dataset.q);
});

$('#search').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  $('#searchClear').hidden = !q;
  clearTimeout(searchTimer);
  if (!q) {
    LAST = [];
    $('#results').innerHTML = '';
    $('#findStatus').textContent = '';
    $('#toolbar').hidden = true;
    $('#moreFind').hidden = true;
    $('#findEmpty').innerHTML = FIND_EMPTY_HTML;
    $('#findEmpty').hidden = false;
    try { history.replaceState(null, '', location.pathname); } catch { /* 唔緊要 */ }
    return;
  }
  searchTimer = setTimeout(() => doSearch(q), 380);
});
$('#search').addEventListener('search', (e) => { if (e.target.value.trim()) doSearch(e.target.value.trim()); });
$('#searchClear').addEventListener('click', () => {
  $('#search').value = ''; $('#search').dispatchEvent(new Event('input'));
  $('#search').focus();
});

$('#storeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  $$('#storeSeg .seg-btn').forEach((x) => x.classList.remove('is-on'));
  b.classList.add('is-on');
  redrawCurrent();
});
for (const id of ['#sortSel', '#stockOnly', '#dealOnly']) $(id).addEventListener('change', redrawCurrent);
// 開咗「只睇寵物」就要重搵一次 —— 平時寵物貨會被壓低，唔重搵會漏咗好多
$('#petOnly').addEventListener('change', () => {
  const q = $('#search').value.trim();
  if (CTX === 'find' && q) doSearch(q); else redrawCurrent();
});

/* 「睇多啲」：惠康仲有下一版，攞返嚟接落去 */
$('#moreFind').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const q = findPage.q;
  if (!q || STATIC.on) return;
  btn.innerHTML = '<span class="spinner"></span>攞緊…';
  try {
    const next = findPage.page + 1;
    const r = await DATA.searchPage(q, 'wellcome', next);
    const fresh = (r.products || []).filter((p) => !LAST.some((x) => x.id === p.id));
    if (!fresh.length) { btn.hidden = true; toast('冇更多喇'); return; }
    findPage.page = next;
    remember(fresh);
    redrawCurrent();
  } catch (err) {
    toast('攞唔到：' + err.message);
  } finally {
    btn.textContent = '睇多啲 ↓';
  }
});

/* ---------------- 分類 ---------------- */

let catStore = 'wellcome';

function renderCatList() {
  const el = $('#catList');
  if (catStore === 'wellcome') {
    el.innerHTML = `<div class="cat-group"><div class="cat-grid">${
      (BOOT?.categories?.wellcome || []).map((c) =>
        `<button class="cat-btn" data-cat="${esc(c.id)}"><span class="cat-ico">${c.icon}</span>${esc(c.name)}</button>`).join('')
    }</div></div>`;
  } else {
    // 百佳分兩層：中類（例如「紙巾、廁紙」）撳落去先出細類同貨品
    el.innerHTML = (BOOT?.categories?.parknshop || []).map((g) => `
      <div class="cat-group">
        <h3>${g.icon} ${esc(g.name)}</h3>
        <div class="cat-grid">${g.children.map((c) =>
          `<button class="cat-btn" data-mid="${esc(c.id)}"><span class="cat-ico">${c.icon}</span>${esc(c.name)}</button>`).join('')}</div>
        <div class="chips" data-subs="${esc(g.id)}" hidden></div>
      </div>`).join('');
  }
}

/** 百佳中類 → 展開細類 */
function openMid(btn) {
  const group = btn.closest('.cat-group');
  const subs = group.querySelector('[data-subs]');
  const gname = group.querySelector('h3').textContent.trim();
  const g = (BOOT?.categories?.parknshop || []).find((x) => gname.endsWith(x.name));
  const mid = g && g.children.find((c) => c.id === btn.dataset.mid);
  if (!mid) return null;

  $$('#catList .cat-btn').forEach((x) => x.classList.remove('is-on'));
  btn.classList.add('is-on');
  $$('#catList [data-subs]').forEach((s) => { if (s !== subs) { s.hidden = true; s.innerHTML = ''; } });

  if (!mid.children || !mid.children.length) { subs.hidden = true; subs.innerHTML = ''; return mid; }
  subs.hidden = false;
  subs.innerHTML = `<span class="chip-label">${esc(mid.name)} 入面</span>` + mid.children
    .map((c) => `<button class="chip" data-cat="${esc(c.id)}" data-kind="${esc(c.kind)}">${esc(c.name)}</button>`).join('');
  return mid.children[0];
}

$('#catStoreSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  $$('#catStoreSeg .seg-btn').forEach((x) => x.classList.remove('is-on'));
  b.classList.add('is-on');
  catStore = b.dataset.store;
  renderCatList();
  $('#catResults').innerHTML = ''; $('#catStatus').textContent = '';
});

let catPage = { id: '', kind: 'c', page: 1 };

async function loadCategory(id, kind) {
  CTX = 'cat';
  $('#catStatus').innerHTML = '<span class="spinner"></span>攞緊貨品…';
  $('#catResults').innerHTML = Array(6).fill('<div class="card sk-card skeleton"></div>').join('');
  $('#moreCat').hidden = true;
  try {
    const r = await DATA.category(catStore, id, kind, $('#sortSel').value);
    LAST = r.products || [];
    seeProducts(LAST);
    const shown = applyFilters(LAST);
    renderGrid($('#catResults'), shown);
    $('#catStatus').innerHTML = shown.length ? `<b>${shown.length}</b> 件貨品`
      : (LAST.length ? '呢批貨畀上面嘅篩選隱藏晒，放寬啲試下。' : '呢個分類暫時攞唔到貨品，試下入面嘅細分類。');
    catPage = { id, kind: kind || 'c', page: 1 };
    $('#moreCat').hidden = STATIC.on || !LAST.length;
  } catch (err) {
    $('#catStatus').textContent = '攞唔到：' + err.message;
    $('#catResults').innerHTML = '';
  }
}

$('#moreCat').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!catPage.id || STATIC.on) return;
  btn.innerHTML = '<span class="spinner"></span>攞緊…';
  try {
    const next = catPage.page + 1;
    const r = await DATA.category(catStore, catPage.id, catPage.kind, $('#sortSel').value, next);
    const fresh = (r.products || []).filter((p) => !LAST.some((x) => x.id === p.id));
    if (!fresh.length) { btn.hidden = true; toast('呢個分類冇更多喇'); return; }
    catPage.page = next;
    LAST = [...LAST, ...fresh];
    seeProducts(fresh);
    const shown2 = applyFilters(LAST);
    renderGrid($('#catResults'), shown2);
    $('#catStatus').innerHTML = `<b>${shown2.length}</b> 件貨品`;
  } catch (err) {
    toast('攞唔到：' + err.message);
  } finally {
    btn.textContent = '睇多啲 ↓';
  }
});

$('#catList').addEventListener('click', async (e) => {
  const mid = e.target.closest('[data-mid]');
  if (mid) {
    const first = openMid(mid);
    if (first) loadCategory(first.id, first.kind);
    return;
  }
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  if (b.classList.contains('cat-btn')) {
    $$('#catList .cat-btn').forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
  }
  loadCategory(b.dataset.cat, b.dataset.kind);
});

/* ---------------- 常買 ---------------- */

function renderFavs() {
  $('#favEmpty').hidden = !!FAVS.length;
  $('#favAddAll').hidden = !FAVS.length;
  renderGrid($('#favResults'), FAVS);
}

$('#favAddAll').addEventListener('click', () => {
  let n = 0;
  for (const p of FAVS) if (!inList(p.id)) { LIST.push({ ...p, qty: 1 }); n++; }
  saveAll(); refreshCounts(); renderList(); redrawCards();
  toast(n ? `加咗 ${n} 件落清單` : '全部已經喺清單度');
});

/* ---------------- 清單 ---------------- */

function renderList() {
  const box = $('#listItems');
  $('#listEmpty').hidden = !!LIST.length;
  $('#totals').hidden = !LIST.length;
  $('#listNote').hidden = !LIST.length;

  box.innerHTML = LIST.map((p) => `
    <div class="li ${p.bought ? 'bought' : ''}" data-id="${esc(p.id)}">
      <button class="tick ${p.bought ? 'on' : ''}" data-tick="1" aria-label="買咗">${p.bought ? '✓' : ''}</button>
      <div class="li-img">${p.image ? `<img src="${imgSrc(p.image)}" alt="">` : `<span>${iconFor(p.name)}</span>`}</div>
      <div class="li-main">
        <div class="li-name">${esc(p.name)}</div>
        <div class="li-sub">
          <span class="badge store-${p.store}" style="padding:1px 7px">${p.storeName}</span>
          ${p.sizeText ? `<span>${esc(p.sizeText)}</span>` : ''}
          ${p.unitPrice ? `<span>${esc(p.unitPrice.text)}</span>` : ''}
        </div>
      </div>
      <div class="qty">
        <button data-q="-1" aria-label="減少">−</button><span>${p.qty || 1}</span><button data-q="1" aria-label="增加">＋</button>
      </div>
      <div class="li-price">$${fmt((p.price || 0) * (p.qty || 1))}</div>
      <button class="li-del" data-del="1" aria-label="刪除">✕</button>
    </div>`).join('');

  renderTotals();
  renderSaved();
}

function renderTotals() {
  const by = {};
  let grand = 0;
  for (const p of LIST) {
    const sub = (p.price || 0) * (p.qty || 1);
    grand += sub;
    by[p.store] = by[p.store] || { name: p.storeName, sum: 0, n: 0 };
    by[p.store].sum += sub; by[p.store].n += p.qty || 1;
  }
  const stores = Object.entries(by);
  const cheapest = stores.length > 1 ? stores.reduce((a, b) => (a[1].sum <= b[1].sum ? a : b)) : null;
  const left = LIST.filter((p) => !p.bought).reduce((s, x) => s + (x.qty || 1), 0);
  const total = LIST.reduce((s, x) => s + (x.qty || 1), 0);

  $('#totals').innerHTML = `
    <div class="total-card">
      <div class="total-label">大約要用</div>
      <div class="total-value">$${fmt(grand)}</div>
      <div class="total-note">${left === total ? `${total} 件` : `仲有 ${left} 件未買（共 ${total} 件）`}</div>
    </div>
    ${stores.length > 1 ? stores.map(([k, v]) => `
      <div class="total-card ${cheapest && cheapest[0] === k ? 'win' : ''}">
        <div class="total-label">${v.name}</div>
        <div class="total-value">$${fmt(v.sum)}</div>
        <div class="total-note">${v.n} 件${cheapest && cheapest[0] === k ? ' · 呢邊平啲' : ''}</div>
      </div>`).join('') : ''}
    <div class="total-card" style="display:grid;place-items:center">
      <button class="primary-btn" id="listCompare">🔍 幫我格價</button>
    </div>`;

  const btn = $('#listCompare');
  if (btn) btn.addEventListener('click', listCompare);
}

$('#listItems').addEventListener('click', (e) => {
  const row = e.target.closest('.li'); if (!row) return;
  const p = LIST.find((x) => x.id === row.dataset.id); if (!p) return;
  if (e.target.closest('[data-tick]')) {
    p.bought = !p.bought;                       // 行超市嗰陣逐件剔走
    haptic(); saveAll(); renderList(); return;
  }
  const qb = e.target.closest('[data-q]');
  if (qb) {
    p.qty = Math.max(1, (p.qty || 1) + Number(qb.dataset.q));   // 最少留一件，想拎走就撳 ✕
    haptic(); saveAll(); refreshCounts(); renderList(); return;
  }
  if (e.target.closest('[data-del]')) {
    LIST = LIST.filter((x) => x.id !== p.id);
    haptic(); saveAll(); refreshCounts(); renderList(); redrawCards(); return;
  }
  openItem(p);
});

$('#clearList').addEventListener('click', () => {
  if (!LIST.length) return;
  if (!confirm('清空成張清單？')) return;
  LIST = []; saveAll(); refreshCounts(); renderList(); redrawCards();
});

$('#copyList').addEventListener('click', () => {
  if (!LIST.length) return toast('清單仲係空嘅');
  const lines = LIST.map((p) => `• ${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''} — ${p.storeName} $${fmt(p.price * (p.qty || 1))}`);
  const total = LIST.reduce((s, p) => s + p.price * (p.qty || 1), 0);
  copyText(`🧺 買餸清單\n${lines.join('\n')}\n─────\n合計 $${fmt(total)}`);
});

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('已複製，可以貼去 WhatsApp')).catch(() => showCopyBox(text));
  } else showCopyBox(text);
}

function showCopyBox(text) {
  openSheet('#itemSheet');
  $('#itemSheetBody').innerHTML = `
    <h3 class="sheet-title">📋 複製清單</h3>
    <p class="sheet-note">長按下面段字揀「全選 → 複製」就得。</p>
    <textarea rows="10" style="width:100%;border:2px solid var(--line);border-radius:16px;padding:13px;background:#fff">${esc(text)}</textarea>`;
  const ta = $('#itemSheetBody textarea');
  ta.focus(); ta.select();
}

/* 一次過幫成張清單喺兩間超市格價 */
async function listCompare() {
  const btn = $('#listCompare');
  btn.innerHTML = '<span class="spinner"></span>格緊價…';
  btn.disabled = true;
  try {
    const r = await DATA.listCompare(LIST);

    let wc = 0, pns = 0, wcMiss = 0, pnsMiss = 0;
    const rows = (r.rows || []).map((row) => {
      const q = row.qty || 1;
      if (row.wellcome) wc += row.wellcome.price * q; else wcMiss++;
      if (row.parknshop) pns += row.parknshop.price * q; else pnsMiss++;
      const cheap = row.wellcome && row.parknshop
        ? (row.wellcome.price <= row.parknshop.price ? 'wellcome' : 'parknshop') : null;
      const cell = (p, key) => p
        ? `<div style="flex:1"><div style="font-size:12px;color:var(--ink-soft)">${p.storeName}${cheap === key ? ' ✅' : ''}</div>
           <div style="font-weight:800;color:${cheap === key ? '#2E7D69' : 'var(--ink)'}">$${fmt(p.price)} ×${q} = $${fmt(p.price * q)}</div>
           <div style="font-size:11.5px;color:var(--ink-soft)">${esc(p.name.slice(0, 22))}</div></div>`
        : '<div style="flex:1;color:var(--ink-soft);font-size:12.5px">呢間搵唔到</div>';
      return `<div style="background:#fff;border-radius:16px;padding:12px;margin-bottom:9px">
        <div style="font-weight:700;font-size:14px;margin-bottom:7px">${esc(row.name)}</div>
        <div style="display:flex;gap:12px">${cell(row.wellcome, 'wellcome')}${cell(row.parknshop, 'parknshop')}</div>
      </div>`;
    }).join('');

    const winner = wc && pns ? (wc <= pns ? '惠康' : '百佳') : null;
    const diff = wc && pns ? Math.abs(wc - pns) : 0;

    openSheet('#itemSheet');
    $('#itemSheetBody').innerHTML = `
      <h3 class="sheet-title">🔍 成張清單格價</h3>
      <div class="totals" style="margin-bottom:14px">
        <div class="total-card ${winner === '惠康' ? 'win' : ''}"><div class="total-label">惠康</div>
          <div class="total-value">$${fmt(wc)}</div><div class="total-note">${wcMiss ? `${wcMiss} 件搵唔到` : '全部搵到'}</div></div>
        <div class="total-card ${winner === '百佳' ? 'win' : ''}"><div class="total-label">百佳</div>
          <div class="total-value">$${fmt(pns)}</div><div class="total-note">${pnsMiss ? `${pnsMiss} 件搵唔到` : '全部搵到'}</div></div>
      </div>
      ${winner ? `<p class="sheet-note">全部喺 <b>${winner}</b> 買，慳到大約 <b>$${fmt(diff)}</b>。<br>不過逐件揀最平嗰間，仲可以再慳啲 —— 下面每行 ✅ 就係嗰件平嘅。</p>` : ''}
      ${rows || '<p class="sheet-note">清單係空嘅。</p>'}`;
  } catch (e) {
    toast('格價失敗：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔍 幫我格價';
  }
}

/* 儲存 / 載入常用清單 */
let savedBound = false;

function renderSaved() {
  const el = $('#savedLists');
  el.innerHTML = `
    <div class="section-head"><h2 style="font-size:16px">我嘅常用清單</h2>
      <button class="ghost-btn" id="saveNow">＋ 儲存而家張清單</button></div>
    ${SAVED.length ? SAVED.map((s, i) => `
      <div class="li">
        <div class="li-img"><span>📝</span></div>
        <div class="li-main"><div class="li-name">${esc(s.name)}</div>
          <div class="li-sub">${s.items.length} 件 · ${new Date(s.at).toLocaleDateString('zh-HK')}</div></div>
        <button class="ghost-btn" data-load="${i}">加返落清單</button>
        <button class="li-del" data-drop="${i}">✕</button>
      </div>`).join('') : '<p class="sheet-note" style="padding:0 2px">儲低成日買嗰批，下次一撳就加返晒 —— 唔使再打字。</p>'}`;

  $('#saveNow').addEventListener('click', () => {
    if (!LIST.length) return toast('清單仲係空嘅');
    const name = prompt('叫佢做咩名？', '每星期例牌');
    if (!name) return;
    SAVED.unshift({ name, at: Date.now(), items: LIST.map((p) => ({ ...p })) });
    SAVED = SAVED.slice(0, 12);
    saveAll(); renderSaved(); toast('儲好咗 📝');
  });

  // 委派監聽只綁一次，唔係每次重畫都會加多個，撳一下做幾次
  if (savedBound) return;
  savedBound = true;
  el.addEventListener('click', (e) => {
    const l = e.target.closest('[data-load]');
    const d = e.target.closest('[data-drop]');
    if (l) {
      let n = 0;
      for (const p of SAVED[+l.dataset.load].items) if (!inList(p.id)) { LIST.push({ ...p }); n++; }
      saveAll(); refreshCounts(); renderList(); toast(n ? `加咗 ${n} 件` : '全部已經喺清單度');
    }
    if (d) { SAVED.splice(+d.dataset.drop, 1); saveAll(); renderSaved(); }
  });
}

/* ---------------- 貼一段字入清單 ---------------- */

for (const id of ['#pasteOpen', '#pasteOpen2']) $(id).addEventListener('click', () => {
  openSheet('#pasteSheet');
  $('#pasteResults').innerHTML = '';
  setTimeout(() => $('#pasteBox').focus(), 250);
});
$('#pasteClose').addEventListener('click', closeSheets);

$('#pasteGo').addEventListener('click', async () => {
  const terms = $('#pasteBox').value
    .split(/[\n,，、;；]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!terms.length) return toast('打幾個字先啦～');

  const box = $('#pasteResults');
  box.innerHTML = `<p class="sheet-note" style="margin-top:14px"><span class="spinner"></span>幫緊你搵 ${terms.length} 樣嘢…</p>`;

  const found = [];
  for (const t of terms) {
    try {
      // 用相關度，唔好用最平 —— 打「雞蛋」唔想夾到最平嗰件「雞蛋饅頭」
      const r = await DATA.search(t, { sort: 'relevance' });
      const best = (r.products || [])[0];
      found.push({ term: t, product: best || null });
      box.innerHTML = `<p class="sheet-note" style="margin-top:14px"><span class="spinner"></span>${found.length}/${terms.length}…</p>`;
    } catch { found.push({ term: t, product: null }); }
  }
  remember(found.map((f) => f.product).filter(Boolean));

  box.innerHTML = `
    <div class="section-head" style="margin:16px 0 10px"><h2 style="font-size:15px">搵到 ${found.filter((f) => f.product).length}/${terms.length} 樣</h2>
      <button class="primary-btn" id="pasteAddAll">全部加入清單</button></div>
    ${found.map((f) => f.product ? `
      <div class="match-row" data-id="${esc(f.product.id)}">
        <div class="li-img">${f.product.image ? `<img src="${imgSrc(f.product.image)}" alt="">` : `<span>${iconFor(f.product.name)}</span>`}</div>
        <div class="li-main">
          <div class="li-name">${esc(f.product.name)}</div>
          <div class="li-sub"><span class="badge store-${f.product.store}" style="padding:1px 7px">${f.product.storeName}</span>
            <span>你打「${esc(f.term)}」</span></div>
        </div>
        <div class="li-price">$${fmt(f.product.price)}</div>
        <button class="add-btn ${inList(f.product.id) ? 'in' : ''}" data-act="add">${inList(f.product.id) ? '✓' : '＋'}</button>
      </div>` : `
      <div class="match-row" style="opacity:.6">
        <div class="li-img"><span>🤔</span></div>
        <div class="li-main"><div class="li-name">${esc(f.term)}</div>
          <div class="li-sub">搵唔到，試下換個講法</div></div>
      </div>`).join('')}`;

  $('#pasteAddAll').addEventListener('click', () => {
    let n = 0;
    for (const f of found) if (f.product && !inList(f.product.id)) { LIST.push({ ...f.product, qty: 1 }); n++; }
    saveAll(); refreshCounts(); renderList(); redrawCards();
    toast(`加咗 ${n} 件落清單 🧺`);
    closeSheets();
    switchTab('list');
  });
});

/* ---------------- 商品詳情 ---------------- */

async function openItem(p) {
  openSheet('#itemSheet');
  const body = $('#itemSheetBody');
  body.innerHTML = `
    <div class="sheet-hero">
      <div class="sheet-hero-img">${p.image ? `<img src="${imgSrc(p.image)}" alt="">` : `<span style="font-size:38px">${iconFor(p.name)}</span>`}</div>
      <div style="flex:1;min-width:0">
        <span class="badge store-${p.store}">${p.storeName}</span>
        <h3 style="font-size:16px;margin:7px 0 5px">${esc(p.name)}</h3>
        <div class="price">$${fmt(p.price)}${p.wasPrice ? `<span class="was">$${fmt(p.wasPrice)}</span>` : ''}</div>
        ${p.unitPrice ? `<div class="unit-price">${esc(p.unitPrice.text)}</div>` : ''}
      </div>
    </div>
    <div class="sheet-actions">
      <button class="primary-btn" data-act="add" data-id="${esc(p.id)}">${inList(p.id) ? '✓ 已喺清單' : '＋ 加入清單'}</button>
      <button class="ghost-btn" data-act="fav" data-id="${esc(p.id)}">${inFavs(p.id) ? '💗 已收藏' : '♡ 收藏'}</button>
      <a class="ghost-btn" href="${esc(p.url)}" target="_blank" rel="noopener">去官網睇 ↗</a>
    </div>
    <div id="sheetDetail"><p class="sheet-note" style="margin-top:16px"><span class="spinner"></span>攞緊詳細資料…</p></div>`;

  body.querySelector('[data-act="add"]').addEventListener('click', (e) => {
    toggleList(p); redrawCards();
    e.currentTarget.textContent = inList(p.id) ? '✓ 已喺清單' : '＋ 加入清單';
  });
  body.querySelector('[data-act="fav"]').addEventListener('click', (e) => {
    toggleFav(p); redrawCards();
    e.currentTarget.textContent = inFavs(p.id) ? '💗 已收藏' : '♡ 收藏';
  });

  const [detail, hist, cmp] = await Promise.all([DATA.item(p), DATA.history(p.id), DATA.compare(p)]);

  const specs = [
    ['規格', detail.spec || p.sizeText],
    ['產地', detail.origin || p.origin],
    ['儲存', detail.storage],
    ['有冇貨', detail.inStock === false ? '暫時缺貨' : detail.inStock === true ? '有貨' : (p.inStock === true ? '有貨' : p.inStock === false ? '暫時缺貨' : '未知')],
    ['促銷', (detail.promos || p.promos || []).join('、')],
  ].filter(([, v]) => v);

  const matches = (cmp.matches || []).filter((m) => m.store !== p.store).slice(0, 4);
  remember(matches);

  $('#sheetDetail').innerHTML = `
    <div class="spec-list">${specs.map(([k, v]) => `<div class="spec-row"><span>${k}</span><span>${esc(v)}</span></div>`).join('')}</div>
    ${hist.points && hist.points.length > 1 ? `
      <h3 style="font-size:15px;margin:18px 0 6px">價格走勢</h3>
      <div style="background:#fff;border-radius:16px;padding:12px">
        ${sparkline(hist.points)}
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);margin-top:6px">
          <span>睇過最低 $${fmt(hist.min)}</span><span>最高 $${fmt(hist.max)}</span></div>
      </div>` : ''}
    <h3 style="font-size:15px;margin:18px 0 8px">另一間超市有冇？</h3>
    ${matches.length ? matches.map((m) => `
      <div class="match-row" data-id="${esc(m.id)}">
        <div class="li-img">${m.image ? `<img src="${imgSrc(m.image)}" alt="">` : `<span>${iconFor(m.name)}</span>`}</div>
        <div class="li-main"><div class="li-name">${esc(m.name)}</div>
          <div class="li-sub"><span class="badge store-${m.store}" style="padding:1px 7px">${m.storeName}</span>
          ${m.sizeText ? `<span>${esc(m.sizeText)}</span>` : ''}
          ${m.price < p.price ? `<span style="color:#2E7D69;font-weight:700">平 $${fmt(p.price - m.price)}</span>`
            : m.price > p.price ? `<span style="color:#C0392B">貴 $${fmt(m.price - p.price)}</span>` : '<span>一樣價</span>'}</div>
        </div>
        <div class="li-price">$${fmt(m.price)}</div>
        <button class="add-btn ${inList(m.id) ? 'in' : ''}" data-act="add">${inList(m.id) ? '✓' : '＋'}</button>
      </div>`).join('') : '<p class="sheet-note">另一間超市暫時搵唔到似樣嘅貨。撳上面「搵嘢」自己搵搵睇？</p>'}`;
}

function sparkline(points) {
  const w = 300, h = 54, pad = 4;
  const ps = points.map((p) => p[1]);
  const min = Math.min(...ps), max = Math.max(...ps);
  const span = max - min || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(pad + i * step).toFixed(1)},${(h - pad - ((p[1] - min) / span) * (h - pad * 2)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="#E8467C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ---------------- 抽屜開關 ---------------- */

function openSheet(sel) {
  closeSheets();
  $('#backdrop').hidden = false;
  $(sel).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheets() {
  $('#backdrop').hidden = true;
  $('#itemSheet').hidden = true;
  $('#pasteSheet').hidden = true;
  document.body.style.overflow = '';
}
$('#backdrop').addEventListener('click', closeSheets);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

/* ---------------- 分頁切換 ---------------- */

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('is-on', v.id === 'view-' + name));
  if (name === 'favs') { CTX = 'fav'; remember(FAVS); renderFavs(); }
  if (name === 'list') renderList();
  if (name === 'find') CTX = 'find';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab'); if (t) switchTab(t.dataset.tab);
});
$('#openList').addEventListener('click', () => switchTab('list'));

/* ---------------- 資料新鮮度 ---------------- */

/** 靜態版：講清楚啲價錢係幾時抓嘅，同埋點樣攞返即時價 */
function renderStaticFoot() {
  const pad = (n) => String(n).padStart(2, '0');
  const t = STATIC.meta && STATIC.meta.builtAt ? new Date(STATIC.meta.builtAt) : null;
  const stamp = t ? `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}` : '未知時間';
  const c = (STATIC.meta && STATIC.meta.counts) || {};
  const n = (x) => (x || 0).toLocaleString('en-US');
  $('#foot').innerHTML = `
    <span class="foot-static">靜態版 · 價錢係 ${esc(stamp)} 抓嘅</span>
    <span>·</span>
    <span>惠康 ${n(c.wellcome)} 件 · 百佳 ${n(c.parknshop)} 件</span>
    <span>·</span>
    <span>想要即時價錢？喺電腦開返 <b>開機.bat</b></span>`;
}

function renderFoot(st) {
  const foot = $('#foot');
  if (STATIC.on) return renderStaticFoot();
  if (!st) { foot.innerHTML = ''; return; }
  const age = st.ageHours == null ? ''
    : st.ageHours < 1 ? '啱啱更新'
      : st.ageHours < 24 ? `${Math.round(st.ageHours)} 個鐘前更新`
        : `${Math.round(st.ageHours / 24)} 日前更新`;
  foot.innerHTML = `
    <span>惠康：每次搵都係即時攞</span>
    <span>·</span>
    <span>百佳目錄：${st.count ? `${st.count.toLocaleString('en-US')} 件${age ? ` · ${age}` : ''}` : '未起'}</span>
    <button class="ghost-btn" id="footRebuild">${st.running ? '更新緊…' : '更新百佳目錄'}</button>`;

  const b = $('#footRebuild');
  if (b && !st.running) {
    b.addEventListener('click', async () => {
      b.innerHTML = '<span class="spinner"></span>更新緊…';
      try {
        await fetch('/api/index/rebuild', { method: 'POST' });
        toast('喺背景更新緊，行完會自動用返新資料');
        pollIndex();
      } catch { toast('連唔到本機 server'); }
    });
  }
}

let pollTimer;
function pollIndex() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const s = await api('/api/status');
      renderFoot(s.index);
      if (!s.index.running) clearInterval(pollTimer);
    } catch { clearInterval(pollTimer); }
  }, 8000);
}

/* ---------------- 開機 ---------------- */

/** 打唔到 /api 就試快照。連快照都冇先至真係咩都做唔到。 */
async function bootStatic() {
  const status = $('#findStatus');
  status.innerHTML = '<span class="spinner"></span>連唔到部電腦，載緊離線嗰份價錢…';
  try {
    if (!SC) throw new Error('冇 search-core.js');
    await loadSnapshot();
    document.body.classList.add('is-static');
    status.innerHTML = '而家行緊<b>靜態版</b> —— 用嘅係最底寫住嗰陣抓落嚟嘅價錢。搵嘢、分類、格價全部照用。';
    return { popular: SC.POPULAR, categories: STATIC.meta.categories || { wellcome: [], parknshop: [] } };
  } catch {
    // 電腦熄咗機／唔喺同一個 Wi-Fi，又冇快照。清單同常買存喺 iPad 度，照用得。
    status.innerHTML = '而家連唔到部電腦，所以搵唔到新價錢。<br>'
      + '<b>唔緊要 —— 你張清單同常買仲喺度，行超市照 tick 得。</b>';
    $('#toolbar').hidden = true;
    return { popular: [], categories: { wellcome: [], parknshop: [] } };
  }
}

(async function boot() {
  refreshCounts();
  renderList();
  renderFavs();
  try {
    BOOT = await api('/api/bootstrap');
  } catch {
    BOOT = await bootStatic();
  }
  renderChips();
  renderCatList();

  const st = BOOT.index || {};
  renderFoot(st);
  if (!STATIC.on) {
    if (st.running) pollIndex();
    if (!st.count) $('#findStatus').textContent = '百佳目錄仲未起好，暫時淨係搵到惠康 —— 撳最底「更新百佳目錄」就會開始。';
  }

  // 網址帶 ?q=… 就即刻搵（可以 bookmark 或者傳條 link 俾人）
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) {
    $('#search').value = q0;
    $('#searchClear').hidden = false;
    doSearch(q0);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
