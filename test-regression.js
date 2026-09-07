'use strict';
/* 完整回歸測試 —— 交貨之前跑呢個。
 *
 *   node test-regression.js            全部（會打惠康官網對價，要網絡）
 *   node test-regression.js --offline  唔打外網（跳過對價同覆蓋率抽驗）
 *   node test-regression.js --api      連本機 server API 一齊測（要自己先開 server）
 *
 * 呢個係「整件事仲 work 唔 work」嘅總檢查，唔係單元測試 ——
 * 單元嗰層喺 test-core.js（詞庫／評分）同 test-ui.js（真 Chrome 撳掣）。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const SC = require('./public/search-core.js');
const S = require('./lib-stores.js');

const OFFLINE = process.argv.includes('--offline');
const WITH_API = process.argv.includes('--api');
const API = 'http://localhost:8787';

/* ---------------- 迷你測試架 ---------------- */
let pass = 0, fail = 0, warn = 0;
const fails = [], warns = [];

function group(n) { console.log(`\n${'─'.repeat(58)}\n${n}`); }
async function t(name, fn) {
  try {
    const note = await fn();
    pass++;
    console.log(`  ✅ ${name}${note ? `　${note}` : ''}`);
  } catch (e) {
    if (e && e.soft) { warn++; warns.push(`${name}：${e.message}`); console.log(`  ⚠️  ${name}\n       ${e.message}`); }
    else { fail++; fails.push(`${name}：${e.message}`); console.log(`  ❌ ${name}\n       ${e.message}`); }
  }
}
function ok(v, msg) { if (!v) throw new Error(msg || '應該成立但唔成立'); }
function soft(msg) { const e = new Error(msg); e.soft = true; throw e; }
const num = (n) => Number(n).toLocaleString('en-US');

/* ---------------- 載入快照，砌返同 app 一樣嘅搜尋 ---------------- */

const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const wcItems = JSON.parse(fs.readFileSync('public/data/wellcome.json', 'utf8')).items;
const pnsItems = JSON.parse(fs.readFileSync('public/data/parknshop.json', 'utf8')).items;

/* 分類 id → 全名（同 app.js loadSnapshot 一樣） */
const catName = new Map();
(function walkWc(nodes, trail) {
  for (const n of nodes || []) {
    const p = [...trail, n.name];
    catName.set('wellcome:' + n.id, p.join(' '));
    walkWc(n.children, p);
  }
}(meta.categories?.wellcome || [], []));
(function walkPns(nodes, trail) {
  for (const n of nodes || []) {
    const p = [...trail, n.name];
    catName.set('parknshop:' + n.id, p.join(' '));
    walkPns(n.children, p);
  }
}(meta.categories?.parknshop || [], []));

const rows = [...wcItems, ...pnsItems].map((p) => {
  const cat = p.categoryPath?.length ? p.categoryPath.join(' ') : (catName.get(p.store + ':' + p.catId) || '');
  const h = SC.norm(p.name);
  return {
    p,
    n: SC.norm(`${p.name} ${p.brand || ''}`),
    h,
    hc: SC.cleanHead ? SC.cleanHead(p.name) : SC.headName(h),
    hr: SC.headRawOf ? SC.headRawOf(p.name) : h,
    c: SC.norm(cat),
  };
});

function search(q, { store, limit = 20, includePets = false } = {}) {
  const terms = [...new Set(SC.synonyms(q).map(SC.norm).filter(Boolean))];
  if (!terms.length) return [];
  const qn = SC.norm(q);
  const out = [];
  for (const r of rows) {
    if (store && r.p.store !== store) continue;
    const s = SC.scoreItem(r.n, r.c, terms, qn, r.h,
      { catId: r.p.catId, topId: r.p.topId, includePets, head: r.hc, headRaw: r.hr });
    if (s) out.push({ ...r.p, rel: s });
  }
  out.sort((a, b) => b.rel - a.rel
    || (a.store === 'wellcome' ? -1 : 0) - (b.store === 'wellcome' ? -1 : 0)
    || a.price - b.price);
  return out.slice(0, limit);
}
const rankOf = (q, sku, opt) => search(q, { limit: 60, ...opt }).findIndex((p) => String(p.sku) === String(sku)) + 1;

/* ================================================================ */

(async () => {
  console.log('🧺 買餸小幫手 · 完整回歸測試');
  console.log(`快照建於 ${new Date(meta.builtAt).toLocaleString('zh-HK')}`);
  console.log(OFFLINE ? '（--offline：跳過所有外網檢查）' : '（會打惠康官網對價，慢啲）');

  /* ---------- 1. 資料完整性 ---------- */
  group('1. 資料完整性');

  await t('惠康件數同 meta 對得上', () => {
    ok(meta.counts.wellcome === wcItems.length, `meta 寫 ${meta.counts.wellcome}，實際 ${wcItems.length}`);
    ok(wcItems.length > 13000, `惠康得 ${wcItems.length} 件，太少（爬蟲係咪跑失敗？）`);
    return `${num(wcItems.length)} 件`;
  });

  await t('百佳件數同 meta 對得上', () => {
    ok(meta.counts.parknshop === pnsItems.length);
    ok(pnsItems.length > 14000, `百佳得 ${pnsItems.length} 件`);
    return `${num(pnsItems.length)} 件`;
  });

  await t('每件貨都有必要欄位', () => {
    const need = ['id', 'store', 'sku', 'name', 'price'];
    for (const [label, arr] of [['惠康', wcItems], ['百佳', pnsItems]]) {
      const bad = arr.find((p) => need.some((k) => p[k] === undefined || p[k] === null || p[k] === ''));
      if (bad) {
        const miss = need.filter((k) => bad[k] === undefined || bad[k] === null || bad[k] === '');
        throw new Error(`${label} 有貨缺 ${miss.join('/')}：${JSON.stringify(bad).slice(0, 120)}`);
      }
    }
    ok(!wcItems.some((p) => !(p.price > 0)), '有惠康貨價錢 <= 0');
    ok(!pnsItems.some((p) => !(p.price > 0)), '有百佳貨價錢 <= 0');
  });

  await t('sku 冇重複', () => {
    for (const [label, arr] of [['惠康', wcItems], ['百佳', pnsItems]]) {
      const s = new Set(arr.map((p) => p.sku));
      ok(s.size === arr.length, `${label} 有 ${arr.length - s.size} 個重複 sku`);
    }
  });

  await t('惠康每件都有 catId 同 topId（分類瀏覽靠佢）', () => {
    const noCat = wcItems.filter((p) => !p.catId).length;
    const noTop = wcItems.filter((p) => !p.topId).length;
    ok(noCat === 0, `${noCat} 件冇 catId`);
    ok(noTop === 0, `${noTop} 件冇 topId`);
  });

  await t('惠康 topId 全部係 22 個頂層之一', () => {
    const tops = new Set(S.wellcome.CATEGORIES.map((c) => String(c.id)));
    const bad = wcItems.filter((p) => !tops.has(String(p.topId)));
    ok(bad.length === 0, `${bad.length} 件 topId 唔喺 22 個頂層入面，例：${bad[0] && bad[0].topId}`);
  });

  await t('商品圖覆蓋率', () => {
    const w = wcItems.filter((p) => p.image).length;
    const p = pnsItems.filter((x) => x.image).length;
    const wr = w / wcItems.length, pr = p / pnsItems.length;
    if (wr < 0.95) soft(`惠康得 ${(wr * 100).toFixed(1)}% 有圖 —— 行 node build-snapshot.js --skip-wellcome --images=3000 補`);
    ok(pr > 0.98, `百佳只有 ${(pr * 100).toFixed(1)}% 有圖`);
    return `惠康 ${(wr * 100).toFixed(1)}% · 百佳 ${(pr * 100).toFixed(1)}%`;
  });

  await t('單價算得出（買餸最緊要嗰個功能）', () => {
    const withUnit = wcItems.filter((p) => p.unitPrice && p.unitPrice.text).length;
    const r = withUnit / wcItems.length;
    if (r < 0.55) soft(`惠康得 ${(r * 100).toFixed(0)}% 算到單價`);
    return `惠康 ${(r * 100).toFixed(0)}% 算到每 100 克／件`;
  });

  await t('快照大細（iPad 要載得起）', () => {
    let raw = 0, gz = 0;
    for (const f of ['meta.json', 'wellcome.json', 'parknshop.json']) {
      const b = fs.readFileSync(path.join('public/data', f));
      raw += b.length; gz += zlib.gzipSync(b, { level: 6 }).length;
    }
    if (gz > 4 * 1048576) soft(`gzip ${(gz / 1048576).toFixed(2)}MB，開始大 —— iPad 第一次載會慢`);
    return `${(raw / 1048576).toFixed(1)}MB raw → ${(gz / 1048576).toFixed(2)}MB gzip`;
  });

  await t('meta 有分類樹（靜態版分類瀏覽靠佢）', () => {
    const w = meta.categories?.wellcome || [];
    const p = meta.categories?.parknshop || [];
    ok(w.length === 22, `惠康頂層應該 22 個，實際 ${w.length}`);
    ok(p.length >= 5, `百佳大類應該 >= 5，實際 ${p.length}`);
    const leaves = [];
    (function walk(ns) { for (const n of ns) { if (n.children?.length) walk(n.children); else leaves.push(n); } }(w));
    ok(leaves.length > 500, `惠康葉分類得 ${leaves.length} 個，分類樹係咪冇攞到？`);
    return `惠康 22 頂層／${leaves.length} 葉 · 百佳 ${p.length} 大類`;
  });

  /* ---------- 2. 用戶報嘅三個問題 ---------- */
  group('2. 用戶實際報嘅問題');

  const CHEESE = '114344291';   // Meadows車打及馬蘇里拉碎芝士150GM $28

  await t('【問題1】目標貨喺快照入面', () => {
    const p = wcItems.find((x) => String(x.sku) === CHEESE);
    ok(p, `sku ${CHEESE} 唔喺快照度`);
    ok(Math.abs(p.price - 28) < 0.01, `價錢應該 $28，實際 $${p.price}`);
    return `${p.name} $${p.price}`;
  });

  for (const q of ['芝士', '芝士碎', '碎芝士', 'cheese', 'Meadows 芝士', '馬蘇里拉']) {
    await t(`【問題1】搜「${q}」→ 目標排頭 10 以內`, () => {
      const r = rankOf(q, CHEESE);
      ok(r > 0, '完全搵唔到');
      ok(r <= 10, `排第 ${r}，跌出頭 10`);
      return `第 ${r} 位`;
    });
  }

  await t('【問題2】搜尋記錄 chip 有得剷（✕ 同「清走全部」）', () => {
    const app = fs.readFileSync('public/app.js', 'utf8');
    const css = fs.readFileSync('public/style.css', 'utf8');
    ok(/data-drop/.test(app), 'app.js 冇 data-drop（逐個剷）');
    ok(/data-clear/.test(app), 'app.js 冇 data-clear（清走全部）');
    ok(/chip-x/.test(css), 'style.css 冇 .chip-x 樣式');
    // 撳 ✕ 唔可以順手再搵一次 —— data-drop 要行喺 data-q 之前
    const iDrop = app.indexOf('data-drop');
    const iQ = app.indexOf("closest('[data-q]')");
    ok(iDrop > 0 && (iQ < 0 || iDrop < iQ), '撳 ✕ 可能會順手觸發搜尋（handler 次序）');
  });

  await t('【問題3】♡ 撳得返（SEEN 登記處 + toast 唔擋撳）', () => {
    const app = fs.readFileSync('public/app.js', 'utf8');
    const css = fs.readFileSync('public/style.css', 'utf8');
    ok(/SEEN/.test(app), 'app.js 冇 SEEN 登記處 —— 換版之後件貨會查唔返');
    ok(/SEEN\.get/.test(app), 'findProduct 冇用 SEEN');
    // 要搵嘅係 `.toast {` 呢個規則本身（唔可以用 indexOf('.toast')，會撞到其他名）
    const m = /\.toast\s*\{([\s\S]*?)\}/.exec(css);
    ok(m, 'style.css 冇 .toast 規則');
    ok(/pointer-events:\s*none/.test(m[1]), 'toast 冇 pointer-events:none —— 會蓋住下面嘅 ♡');
  });

  /* ---------- 3. 搜尋質素（唔好因為修 bug 而整壞其他） ---------- */
  group('3. 搜尋質素冇 regression');

  const QUALITY = [
    ['牛奶', /奶/, '唔應該係奶瓶刷／奶樽'],
    ['milk', /奶|milk/i, ''],
    ['雞蛋', /蛋/, ''],
    ['廁紙', /紙/, ''],
    ['洗頭水', /髮|洗頭|shampoo/i, ''],
    ['薯片', /薯片|片|chips/i, ''],
    ['貓糧', /貓/, ''],
    ['狗糧', /狗/, ''],
    ['貓砂', /砂/, ''],
    ['啤酒', /啤|beer/i, ''],
    ['蕃茄', /茄/, ''],
    ['麵包', /包|bread/i, ''],
  ];
  for (const [q, re] of QUALITY) {
    await t(`搜「${q}」頭 5 名合理`, () => {
      const r = search(q, { limit: 5 });
      ok(r.length > 0, '搵唔到嘢');
      const bad = r.filter((p) => !re.test(p.name));
      ok(bad.length <= 1, `頭 5 名有 ${bad.length} 件唔對題：${bad.map((p) => p.name.slice(0, 14)).join('、')}`);
      return `${r[0].name.slice(0, 20)} $${r[0].price}`;
    });
  }

  await t('「牛奶」唔會夾到奶瓶刷', () => {
    const r = search('牛奶', { limit: 20 });
    const bad = r.filter((p) => /奶瓶|奶樽/.test(p.name));
    ok(bad.length === 0, `夾到 ${bad.map((p) => p.name).join('、')}`);
  });

  await t('寵物糧唔會霸住買餸搜尋（但唔會消失）', () => {
    const top5 = search('三文魚', { limit: 5 });
    const pets = top5.filter((p) => SC.isPetCat(p.catId, p.topId));
    ok(pets.length === 0, `頭 5 名有 ${pets.length} 件寵物貨`);
    const all = search('三文魚', { limit: 60 });
    const petsAll = all.filter((p) => SC.isPetCat(p.catId, p.topId));
    ok(petsAll.length > 0, '寵物貨完全消失咗 —— 唔應該，佢有貓有狗');
    return `頭 5 冇寵物；全榜仍有 ${petsAll.length} 件`;
  });

  await t('搵寵物嘢唔受壓低影響', () => {
    for (const q of ['貓糧', '狗糧', '貓砂']) {
      const r = search(q, { limit: 5 });
      ok(r.length >= 3, `「${q}」得 ${r.length} 件`);
      const pets = r.filter((p) => SC.isPetCat(p.catId, p.topId));
      ok(pets.length >= 3, `「${q}」頭 5 名得 ${pets.length} 件係寵物貨`);
    }
  });

  await t('多詞搜尋 work（之前 0 件）', () => {
    for (const q of ['維他 檸檬茶', '卡樂b 薯片', 'Meadows 芝士']) {
      ok(search(q, { limit: 5 }).length > 0, `「${q}」搵唔到嘢`);
    }
  });

  await t('中英搜尋出同一批貨', () => {
    for (const [zh, en] of [['牛奶', 'milk'], ['廁紙', 'toilet paper'], ['洗頭水', 'shampoo']]) {
      const a = new Set(search(zh, { limit: 30 }).map((p) => p.id));
      const b = search(en, { limit: 30 }).map((p) => p.id);
      const overlap = b.filter((x) => a.has(x)).length;
      ok(overlap >= 15, `「${zh}」同「${en}」頭 30 只重疊 ${overlap} 件`);
    }
  });

  await t('空／垃圾查詢唔會爆', () => {
    for (const q of ['', '   ', '@@@###', '牛奶'.repeat(80)]) search(q, { limit: 5 });
  });

  /* ---------- 4. 百佳參考價 ---------- */
  group('4. 百佳參考價（惠康卡下面嗰行細字）');

  await t('app.js 有 altLine 同規格合理性檢查', () => {
    const app = fs.readFileSync('public/app.js', 'utf8');
    ok(/function altLine/.test(app), '冇 altLine');
    ok(/sizeComparable/.test(app), '冇 sizeComparable —— 會出現 40PC vs 大裝咁嘅誤導比較');
    ok(/alt-size/.test(app), '規格唔同嗰陣冇標出嚟');
  });

  await t('server.js 一樣有（兩個版本要一致）', () => {
    const srv = fs.readFileSync('server.js', 'utf8');
    ok(/function attachAlt/.test(srv), '冇 attachAlt');
    ok(/sizeComparable/.test(srv), '冇 sizeComparable');
  });

  /* ---------- 5. 覆蓋率 ---------- */
  group('5. 覆蓋率');

  await t('冇分類撞住 800 件上限', () => {
    const byCat = {};
    for (const p of wcItems) byCat[p.catId] = (byCat[p.catId] || 0) + 1;
    const capped = Object.entries(byCat).filter(([, n]) => n >= 780);
    ok(capped.length === 0, `${capped.length} 個分類貼住上限：${capped.map(([c, n]) => `${c}(${n})`).join(', ')}`);
    return `最大嘅分類得 ${Math.max(...Object.values(byCat))} 件`;
  });

  await t('葉分類覆蓋面', () => {
    const seen = new Set(wcItems.map((p) => p.catId));
    if (seen.size < 400) soft(`只見過 ${seen.size} 個葉分類 —— 爬蟲係咪未行完？`);
    return `見過 ${seen.size} 個葉分類`;
  });

  if (!OFFLINE) {
    await t('實地抽驗：3 個葉分類逐版揭到底，同索引對數', async () => {
      const byCat = {};
      for (const p of wcItems) (byCat[p.catId] = byCat[p.catId] || []).push(p.sku);
      const cats = Object.keys(byCat).filter((c) => byCat[c].length >= 15 && byCat[c].length <= 120);
      const picks = [0, Math.floor(cats.length / 2), cats.length - 1].map((i) => cats[i]).filter(Boolean);
      const notes = [];
      for (const c of picks) {
        const live = new Set();
        for (let page = 1; page <= 30; page++) {
          let list;
          try { list = await S.wellcome.category(c, page); } catch { break; }
          if (!list.length) break;
          const before = live.size;
          list.forEach((p) => live.add(p.sku));
          if (live.size === before) break;
        }
        const have = new Set(byCat[c]);
        const missing = [...live].filter((s) => !have.has(s));
        notes.push(`${c}: 官網 ${live.size} / 索引 ${have.size} / 漏 ${missing.length}`);
        ok(missing.length === 0, `分類 ${c} 漏咗 ${missing.length} 件：${missing.slice(0, 3).join(',')}`);
      }
      return notes.join(' · ');
    });

    await t('價錢抽驗：20 件同惠康官網逐件對', async () => {
      const sample = [];
      for (let i = 0; i < 20; i++) sample.push(wcItems[Math.floor((i + 0.5) * wcItems.length / 20)]);
      let good = 0, bad = [];
      for (const p of sample) {
        try {
          const d = await S.wellcome.detail(p.sku);
          if (d.price == null) continue;
          if (Math.abs(d.price - p.price) < 0.01) good++;
          else bad.push(`${p.name.slice(0, 18)} 快照$${p.price}≠官網$${d.price}`);
        } catch { /* 攞唔到就算 */ }
      }
      ok(bad.length === 0, `${bad.length} 件價錢對唔上：${bad.slice(0, 3).join('；')}`);
      return `${good}/${sample.length} 逐件對得上`;
    });
  }

  /* ---------- 6. 本機 server API ---------- */
  if (WITH_API) {
    group('6. 本機 server API');
    const get = (p) => fetch(API + p).then((r) => r.json());

    await t('server 開住', async () => {
      const s = await get('/api/status');
      ok(s.index, '冇 index 狀態');
      return `百佳索引 ${num(s.index.count)} 件`;
    });

    await t('/api/bootstrap 有分類同熱門詞', async () => {
      const b = await get('/api/bootstrap');
      ok(b.categories.wellcome.length === 22);
      ok(b.categories.parknshop.length >= 5);
      ok(b.popular.length > 0);
    });

    for (const q of ['牛奶', 'milk', '芝士碎', '廁紙']) {
      await t(`/api/search?q=${q}`, async () => {
        const r = await get('/api/search?q=' + encodeURIComponent(q));
        ok(r.products.length > 0, '零結果');
        const wc = r.products.filter((p) => p.store === 'wellcome');
        ok(wc.length > 0, '冇惠康結果');
        ok(wc.every((p) => p.catId), '有惠康貨冇 catId（🐾 標籤會失效）');
        const alt = wc.filter((p) => p.alt).length;
        return `${r.products.length} 件，${alt} 件有百佳參考價`;
      });
    }

    await t('/api/category 惠康同百佳都得', async () => {
      const w = await get('/api/category?store=wellcome&id=100011');
      ok(w.products.length > 0, '惠康分類零結果');
      const p = await get('/api/category?store=parknshop&id=04090100');
      ok(p.products.length > 0, '百佳分類零結果');
    });

    await t('/api/item 同 /api/compare', async () => {
      const d = await get(`/api/item?store=wellcome&sku=${CHEESE}`);
      ok(d && !d.unavailable, '攞唔到商品詳情');
      const c = await get('/api/compare?name=' + encodeURIComponent('Meadows 常溫全脂奶 1LT') + '&exclude=wellcome');
      ok(Array.isArray(c.matches), 'compare 冇回 matches');
    });

    await t('POST /api/list-compare', async () => {
      const r = await fetch(API + '/api/list-compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ name: '牛奶 1LT', qty: 2 }, { name: '廁紙', qty: 1 }] }),
      }).then((x) => x.json());
      ok(r.rows && r.rows.length === 2, '格價冇回兩行');
    });

    await t('壞輸入唔會 500', async () => {
      for (const p of ['/api/search?q=', '/api/category?store=wellcome&id=999999',
        '/api/item?store=wellcome&sku=000000', '/api/img?u=https://evil.example.com/x.jpg']) {
        const r = await fetch(API + p);
        ok(r.status < 500, `${p} 回 ${r.status}`);
      }
    });
  }

  /* ---------- 7. 發佈衛生 ---------- */
  group('7. 發佈衛生（唔好上錯嘢去 GitHub）');

  await t('public/ 冇測試殘留（成個資料夾會派上 Pages）', () => {
    const junk = fs.readdirSync('public').filter((f) => /^_/.test(f) || /drv|test|driver/i.test(f));
    ok(junk.length === 0, `有殘留：${junk.join(', ')}`);
    return `${fs.readdirSync('public').length} 個項目`;
  });

  await t('.gitignore 擋住本機索引同價格記錄', () => {
    for (const f of ['data/pns-index.json', 'data/wc-index.json', 'data/history.json', 'data/cache/x.json']) {
      let out = '';
      try { out = execFileSync('git', ['check-ignore', '-v', f], { encoding: 'utf8' }); } catch { /* 冇擋到 */ }
      ok(out.trim().length > 0, `${f} 冇被 .gitignore 擋住 —— 會上 GitHub`);
    }
  });

  await t('public/data 冇被誤擋（Pages 靠佢出價）', () => {
    for (const f of ['public/data/meta.json', 'public/data/wellcome.json', 'public/data/parknshop.json']) {
      let ignored = false;
      try { execFileSync('git', ['check-ignore', f], { encoding: 'utf8' }); ignored = true; } catch { /* 冇擋 = 好 */ }
      ok(!ignored, `${f} 畀 .gitignore 擋咗 —— 個網站會白晒`);
    }
  });

  await t('git remote 只有 GitHub（唔可以有 GitLab）', () => {
    const out = execFileSync('git', ['remote', '-v'], { encoding: 'utf8' });
    ok(/github\.com/.test(out), '冇 GitHub remote');
    ok(!/gitlab/i.test(out), '⚠️ 有 GitLab remote！');
    return out.trim().split('\n')[0].replace(/\s+/g, ' ');
  });

  await t('GitHub Actions workflow 齊', () => {
    for (const f of ['.github/workflows/refresh.yml', '.github/workflows/pages.yml']) {
      ok(fs.existsSync(f), `冇 ${f}`);
      const y = fs.readFileSync(f, 'utf8');
      ok(!/\t/.test(y), `${f} 有 TAB（YAML 會爆）`);
    }
  });

  await t('CI 種子機制：冇 data/ 都砌得返快照', () => {
    const bs = fs.readFileSync('build-snapshot.js', 'utf8');
    ok(/seedFromPublished/.test(bs), '冇 seedFromPublished —— CI 會派空資料上網站');
    ok(/dataHash/.test(bs), '冇 dataHash —— 每 6 個鐘都會無謂 commit');
  });

  /* ---------- 8. 兩個版本一致 ---------- */
  group('8. 兩個版本用同一套邏輯');

  await t('search-core 係唯一真相來源', () => {
    const d = fs.readFileSync('lib-dict.js', 'utf8');
    ok(/search-core/.test(d) && !/\['牛奶'/.test(d), 'lib-dict 仲有自己一份詞庫');
    const i = fs.readFileSync('lib-index.js', 'utf8');
    ok(/search-core/.test(i), 'lib-index 冇用 search-core');
    ok(!/function scoreItem/.test(i), 'lib-index 自己另有一份評分');
  });

  await t('index.html 有載 search-core（靜態版靠佢）', () => {
    const h = fs.readFileSync('public/index.html', 'utf8');
    // 要夾實 <script src=…>，唔可以淨係 indexOf 個檔名 ——
    // 註解入面提一句「app.js」都會令呢條測試無端端紅
    const srcs = [...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const iCore = srcs.findIndex((s) => s.includes('search-core.js'));
    const iApp = srcs.findIndex((s) => s.includes('app.js'));
    ok(iCore >= 0, `冇載 search-core.js（載咗：${srcs.join('、')}）`);
    ok(iApp >= 0, `冇載 app.js（載咗：${srcs.join('、')}）`);
    ok(iCore < iApp, `search-core.js 要喺 app.js 之前載，而家次序係 ${srcs.join(' → ')}`);
  });

  await t('service worker 有快取快照', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    ok(/search-core/.test(sw), 'sw 冇 precache search-core.js');
    ok(/wellcome|parknshop|data\\\//.test(sw) || /data\//.test(sw), 'sw 冇處理快照');
  });

  await t('快照換咗料會出聲（唔使開兩次先追到）', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    const app = fs.readFileSync('public/app.js', 'utf8');
    const html = fs.readFileSync('public/index.html', 'utf8');
    const css = fs.readFileSync('public/style.css', 'utf8');
    ok(/ETag/i.test(sw), 'sw 冇比對 ETag，唔知換咗料');
    ok(/snapshot-updated/.test(sw), 'sw 攞到新料冇通知 client');
    ok(/snapshot-updated/.test(app), 'app.js 冇聽');
    ok(/id="updateBar"/.test(html), 'index.html 冇粒更新掣');
    // 條 bar 係要撳嘅，唔可以好似 toast 咁 pointer-events:none
    const i = css.indexOf('.update-bar');
    ok(i > 0, 'style.css 冇 .update-bar');
    ok(!/pointer-events:\s*none/.test(css.slice(i, i + 400)), '條更新掣撳唔到就冇意思');
  });

  await t('sw 快取版本有 bump（唔 bump 舊料唔會走）', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    const m = /const SHELL = 'hkpb-shell-v(\d+)'/.exec(sw);
    ok(m, '搵唔到 SHELL 版本號');
    ok(Number(m[1]) >= 3, `SHELL 仲係 v${m[1]} —— 補完產地要 bump 先會掉走冇 origin 嗰份`);
    return `hkpb-shell-v${m[1]}`;
  });

  /* ---------- 9. 惠康藏起嘅缺貨貨品 ---------- */
  group('9. 惠康藏起嘅缺貨貨品（extra-skus.json）');

  const EXTRA = JSON.parse(fs.readFileSync('extra-skus.json', 'utf8'));
  const extraList = EXTRA.wellcome || [];

  await t('extra-skus.json 格式啱', () => {
    ok(Array.isArray(extraList) && extraList.length, 'wellcome 陣列係空嘅');
    for (const e of extraList) ok(/^\d{6,}$/.test(String(e.sku)), `sku 唔似 sku：${e.sku}`);
    const dup = extraList.length - new Set(extraList.map((e) => String(e.sku))).size;
    ok(dup === 0, `名單有 ${dup} 個重複 sku`);
    return `${extraList.length} 件`;
  });

  await t('名單每一件都真係入咗快照', () => {
    const miss = extraList.filter((e) => !wcItems.some((p) => String(p.sku) === String(e.sku)));
    ok(!miss.length, `快照冇：${miss.map((e) => e.sku).join('、')}　→ 行 node build-snapshot.js --skip-wellcome --skip-images`);
    return `${extraList.length}/${extraList.length}`;
  });

  await t('每件都有分類（分類瀏覽揀得到）', () => {
    const bad = extraList
      .map((e) => wcItems.find((p) => String(p.sku) === String(e.sku)))
      .filter((p) => p && !p.catId);
    ok(!bad.length, `冇 catId：${bad.map((p) => p.sku + ' ' + p.name).join('、')}`);
  });

  // 朋友 2026-09-07 報嘅兩款寬粉 —— 呢兩件係整套機制嘅由來，實要搵得返
  for (const [sku, q, label] of [
    ['101385212', '寬粉', '糧之髓手工鮮薯寬粉'],
    ['113472784', '寬粉', '玖柒牌綠豆馬鈴薯寬粉'],
    ['113472784', '馬鈴薯寬粉', '玖柒牌（全名搵）'],
  ]) {
    await t(`搵「${q}」搵得返 ${label}`, () => {
      const r = rankOf(q, sku);
      ok(r > 0, '搜尋結果入面完全冇佢');
      ok(r <= 5, `排第 ${r}，跌出頭 5 名`);
      return `第 ${r} 名`;
    });
  }

  await t('缺貨貨品有標「暫時缺貨」', () => {
    const two = ['101385212', '113472784'].map((s) => wcItems.find((p) => String(p.sku) === s));
    ok(two.every(Boolean), '搵唔到嗰兩件');
    const wrong = two.filter((p) => p.inStock !== false);
    ok(!wrong.length, `${wrong.map((p) => p.sku).join('、')} 冇標缺貨 → 前端唔會出「暫時缺貨」`);
  });

  await t('「只睇有貨」預設係關（唔係嘅話缺貨貨會隱形）', () => {
    const h = fs.readFileSync('public/index.html', 'utf8');
    const m = /<input[^>]*id="stockOnly"[^>]*>/.exec(h);
    ok(m, '搵唔到 #stockOnly');
    ok(!/\bchecked\b/.test(m[0]), '預設剔咗，啲缺貨貨會即刻消失');
  });

  await t('build 流程真係會行 mergeExtras', () => {
    const b = fs.readFileSync('build-snapshot.js', 'utf8');
    ok(/module\.exports\s*=\s*{[^}]*mergeExtras/.test(b), 'mergeExtras 冇 export');
    ok(/else await mergeExtras\(\)/.test(b), 'main() 冇叫 mergeExtras');
    ok(require('./build-snapshot.js').mergeExtras, 'require 返出嚟冇 mergeExtras');
  });

  await t('搵唔到嘢嗰陣畀到條路出去', () => {
    const a = fs.readFileSync('public/app.js', 'utf8');
    ok(/empty-out/.test(a), 'app.js 冇 empty-out 區塊');
    ok(/site:wellcome\.com\.hk/.test(a), '冇 Google 全站搜尋嘅出路');
    const css = fs.readFileSync('public/style.css', 'utf8');
    ok(/\.empty-out\b/.test(css), 'style.css 冇 .empty-out 樣式');
  });

  if (!OFFLINE) {
    await t('名單啲貨喺惠康度仲開得到，價錢同快照一致', async () => {
      const bad = [];
      for (const e of extraList) {
        const snap = wcItems.find((p) => String(p.sku) === String(e.sku));
        let d;
        try { d = await S.wellcome.detail(e.sku); }
        catch (err) { bad.push(`${e.sku} 開唔到（${err.message}）`); continue; }
        if (!d.name) { bad.push(`${e.sku} 冇名，可能落晒架`); continue; }
        if (snap && d.price !== snap.price) bad.push(`${e.sku} 現場 $${d.price} ≠ 快照 $${snap.price}`);
      }
      if (bad.length) soft(bad.join('；') + '　→ 行返一次 build 就會同步');
      return `${extraList.length}/${extraList.length} 啱`;
    });
  }

  /* ---------- 10. 唔要中國產 ---------- */
  group('10. 「唔要中國產」篩選');

  const appJs = fs.readFileSync('public/app.js', 'utf8');
  const idxHtml = fs.readFileSync('public/index.html', 'utf8');
  const cssTxt = fs.readFileSync('public/style.css', 'utf8');

  await t('search-core 有得判斷產地（前後端共用一套）', () => {
    ok(typeof SC.isChinaOrigin === 'function', 'search-core 冇 export isChinaOrigin');
    ok(SC.isChinaOrigin('China 中國') && !SC.isChinaOrigin('澳洲'), '判斷結果唔啱');
  });

  await t('個掣喺畫面度，而且預設冇剔', () => {
    const m = /<input[^>]*id="noChina"[^>]*>/.exec(idxHtml);
    ok(m, 'index.html 冇 #noChina');
    ok(!/\bchecked\b/.test(m[0]), '唔應該一開機就幫人剔咗，要佢自己揀');
  });

  await t('篩選真係接咗落 applyFilters', () => {
    ok(/noChina: \$\('#noChina'\)\.checked/.test(appJs), 'currentFilters 冇讀個掣');
    ok(/if \(f\.noChina\)/.test(appJs), 'applyFilters 冇用到佢');
    ok(/isChina\(p\)/.test(appJs), '冇叫產地判斷');
  });

  await t('個偏好會記住（唔使次次撳過）', () => {
    ok(/store\.get\('noChina'/.test(appJs), '冇讀返上次嘅選擇');
    ok(/store\.set\('noChina'/.test(appJs), '冇記低');
  });

  await t('產地會喺卡片同狀態列交代', () => {
    ok(/function originPill/.test(appJs), '冇 originPill');
    ok(/function filterNote/.test(appJs), '冇 filterNote（唔講就冇人知隱咗嘢）');
    ok(/LAST_HIDDEN_CN/.test(appJs) && /LAST_UNKNOWN_ORIGIN/.test(appJs), '冇計隱咗幾多件');
    for (const cls of ['.pill.origin', '.pill.origin-cn', '.pill.origin-unknown']) {
      ok(cssTxt.includes(cls), `style.css 冇 ${cls}`);
    }
  });

  await t('產地未知嘅唔會被一刀切隱起', () => {
    // 惠康產地要逐件開商品頁補，補緊嗰陣大把未知 —— 連未知都隱就會成版空白
    const seg = appJs.slice(appJs.indexOf('if (f.noChina)'), appJs.indexOf('if (f.noChina)') + 260);
    ok(/if \(isChina\(p\)\)/.test(seg), '應該淨係隱「知道係中國」嗰啲');
    ok(!/if \(!p\.origin\) return false/.test(seg), '唔可以連未知都隱埋');
  });

  await t('build 流程真係會補產地', () => {
    const b = fs.readFileSync('build-snapshot.js', 'utf8');
    ok(/module\.exports\s*=\s*{[^}]*fillOrigins/.test(b), 'fillOrigins 冇 export');
    ok(/else await fillOrigins\(/.test(b), 'main() 冇叫 fillOrigins');
    ok(/orig\[p\.sku\]/.test(b), 'buildSnapshot 冇將產地表併返落快照');
    ok(/wcSpec|wellcome\.spec/.test(fs.readFileSync('lib-stores.js', 'utf8')), '規格解析冇抽出嚟共用');
  });

  await t('篩選喺真快照上面隱得啱（唔多唔少）', () => {
    const all = [...wcItems, ...pnsItems];
    const cn = all.filter((p) => SC.isChinaOrigin(p.origin));
    const kept = all.filter((p) => !SC.isChinaOrigin(p.origin));
    ok(cn.length > 0, '成份快照一件中國產都認唔到，實係接錯咗');
    const leak = kept.filter((p) => /中國|中国|china/i.test(String(p.origin || '')));
    ok(!leak.length, `漏網：${leak.slice(0, 3).map((p) => p.origin).join('、')}`);
    const wrong = cn.filter((p) => /^(澳洲|澳大利亞|香港|台灣|日本|韓國)$/.test(String(p.origin || '')));
    ok(!wrong.length, `錯殺：${wrong.slice(0, 3).map((p) => p.origin).join('、')}`);
    return `隱 ${num(cn.length)} 件、留 ${num(kept.length)} 件`;
  });

  await t('產地覆蓋率（惠康補緊，只報數唔當錯）', () => {
    // 要數「真係讀得出嘅產地」—— 數 p.origin 會連嗰千幾件免責聲明都當有，報到 100% 咁假
    const wcK = wcItems.filter((p) => SC.cleanOrigin(p.origin)).length;
    const pnsK = pnsItems.filter((p) => SC.cleanOrigin(p.origin)).length;
    const pct = (a, b) => (a / b * 100).toFixed(0) + '%';
    ok(pnsK / pnsItems.length > 0.8, `百佳產地覆蓋率跌到 ${pct(pnsK, pnsItems.length)}，佢個列表本身有，實係解析壞咗`);
    if (wcK / wcItems.length < 0.9) {
      soft(`惠康產地補到 ${pct(wcK, wcItems.length)}（${num(wcK)}/${num(wcItems.length)}）——`
        + ' 未補完，未知嗰啲會照出並標「產地？」。再行 node build-snapshot.js --origins=5000 補多啲');
    }
    return `惠康 ${pct(wcK, wcItems.length)} · 百佳 ${pct(pnsK, pnsItems.length)}`;
  });

  /* ---------------- 總結 ---------------- */
  console.log(`\n${'═'.repeat(58)}`);
  if (fail === 0) {
    console.log(`✅ 回歸測試通過：${pass} 條過${warn ? `，${warn} 條有保留` : ''}`);
    warns.forEach((w) => console.log(`   ⚠️  ${w}`));
    process.exit(0);
  } else {
    console.log(`❌ ${fail} 條唔過（${pass} 條過${warn ? `，${warn} 條有保留` : ''}）：`);
    fails.forEach((f) => console.log(`   - ${f}`));
    warns.forEach((w) => console.log(`   ⚠️  ${w}`));
    process.exit(1);
  }
})().catch((e) => { console.error('回歸測試自己爆咗：', e); process.exit(2); });
