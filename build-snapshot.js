'use strict';
/* 靜態快照產生器 —— 出一份 public/data/ 出嚟，冇 server 都用得
 *
 * 做三件事：
 *   1. 惠康目錄爬蟲   → data/wc-index.json（同百佳嗰份 pns-index.json 平排，方便下次增量）
 *   2. 惠康商品圖增量補 → data/wc-images.json（{sku: 圖網址}），每次行有預算上限，唔會一次過狂打人哋
 *   3. 出快照         → public/data/{meta,wellcome,parknshop}.json
 *
 * 用法：
 *   node build-snapshot.js                 全套做
 *   node build-snapshot.js --skip-wellcome  唔行惠康爬蟲（讀返上次嗰份 wc-index.json）
 *   node build-snapshot.js --skip-images    唔補圖
 *   node build-snapshot.js --skip-extras    唔補 extra-skus.json 嗰批（惠康列表見唔到嘅缺貨貨品）
 *   node build-snapshot.js --cats=3         惠康只行頭 3 個**頂層**底下嘅葉分類（試機用）
 *   node build-snapshot.js --pages=10       每個葉分類最多揭 10 版
 *   node build-snapshot.js --images=200     今次最多補 200 張圖（或者行 IMAGE_BUDGET=200）
 *   node build-snapshot.js --retry-images   連之前試過攞唔到圖嗰啲都再試一次
 *   node build-snapshot.js --warn-mb=12     百佳嗰份大過幾多 MB 就出聲（預設 12）
 *
 * ⚠️ 百佳嗰份 data/pns-index.json 唔係呢度整嘅（rebuild-index.js 負責），
 *    呢個 script 淨係「讀」佢，唔會寫、唔會刪。就算佢正被爬蟲寫緊，讀壞咗都會等陣再試。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const S = require('./lib-stores.js');

const DATA_DIR = path.join(__dirname, 'data');
const OUT_DIR = path.join(__dirname, 'public', 'data');
const WC_FILE = path.join(DATA_DIR, 'wc-index.json');
const WC_IMG_FILE = path.join(DATA_DIR, 'wc-images.json');
const PNS_FILE = path.join(DATA_DIR, 'pns-index.json');

const WC_ORIGIN = S.STORES.wellcome.origin;

/* ---------------- 細眉細眼嘅小工具 ---------------- */

const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes(`--${n}`);
function optVal(n, dflt) {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? dflt : hit.slice(n.length + 3);
}
const optNum = (n, dflt) => {
  const v = Number(optVal(n, NaN));
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => (bytes / 1048576).toFixed(2);
const hhmm = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${hhmm()}]`, ...a);

/* ---------------- CI 種子：由已經派出去嗰份快照還原 ----------------
 *
 * GitHub Actions 每次都係全新 checkout，而 data/ 成個資料夾都畀 .gitignore 擋咗，
 * 所以 CI 度根本冇 wc-index / wc-images / pns-index。唔理佢嘅話：
 *   · 百佳會變成 0 件 → 派上去個網站啲貨全部消失
 *   · 惠康啲圖每次由零開始 → 永遠停喺一次預算嗰 800 張
 *
 * 但 public/data/ 本身係 commit 咗上 repo 嘅 —— 佢就係我哋嘅持久狀態。
 * 所以開工之前，見到 data/ 嗰邊冇嘢就由上一份快照 seed 返。
 */
async function seedFromPublished() {
  const outWc = path.join(OUT_DIR, 'wellcome.json');
  const outPns = path.join(OUT_DIR, 'parknshop.json');

  if (!fs.existsSync(WC_FILE)) {
    const prev = await readJsonSafe(outWc, null);
    if (prev && prev.items && prev.items.length) {
      writeJsonAtomic(WC_FILE, { builtAt: prev.builtAt || 0, count: prev.items.length, items: prev.items });
      log(`由上一份快照 seed 返惠康索引：${prev.items.length} 件`);
    }
  }
  if (!fs.existsSync(WC_IMG_FILE)) {
    const prev = await readJsonSafe(outWc, null);
    if (prev && prev.items && prev.items.length) {
      const map = {};
      for (const p of prev.items) if (p.image) map[p.sku] = p.image;
      if (Object.keys(map).length) {
        writeJsonAtomic(WC_IMG_FILE, map);
        log(`由上一份快照 seed 返惠康圖片：${Object.keys(map).length} 張`);
      }
    }
  }
  if (!fs.existsSync(PNS_FILE)) {
    const prev = await readJsonSafe(outPns, null);
    if (prev && prev.items && prev.items.length) {
      writeJsonAtomic(PNS_FILE, { builtAt: prev.builtAt || 0, count: prev.items.length, items: prev.items });
      log(`由上一份快照 seed 返百佳索引：${prev.items.length} 件`);
    }
  }
}

/**
 * 讀 JSON。人哋個爬蟲可能啱啱寫緊同一個檔（writeFileSync 唔係原子），
 * 讀到半截 JSON 好正常 —— 唞陣再試，試極都唔得先當佢冇。
 */
async function readJsonSafe(file, fallback) {
  for (let i = 0; i < 5; i++) {
    if (!fs.existsSync(file)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (i === 4) {
        console.error(`[warn] ${path.basename(file)} 讀唔掂（${e.message}），當佢冇`);
        return fallback;
      }
      await sleep(600);      // 等佢寫完
    }
  }
  return fallback;
}

/** 寫檔：先寫 .tmp 再改名，咁就算中途死機都唔會整爛原本嗰份 */
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = Buffer.from(JSON.stringify(obj));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  return buf;
}

/* ---------------- 1. 惠康目錄爬蟲 ---------------- */

/**
 * 行晒惠康**葉分類**，逐版揭到「呢版冇新 sku」或者「攞唔到嘢」為止。
 * 全程串行 —— lib-stores 嘅 fetchText 本身已經幫每個 host 排住隊
 * （惠康 900ms 一次），所以呢度唔會自己再開並行。
 *
 * 點解唔爬返嗰 22 個頂層？因為惠康每個分類揭到第 41 版就 HTTP 500，
 * 即係一個分類封頂 ~800 件。爬頂層嗰陣「個人護理」「原箱優惠」等 8 個
 * 分類全部貼住上限 = 有貨攞唔到。葉分類各有各嘅 800 件上限，所以
 * 爬 760 個葉 ≈ 覆蓋率大躍進。
 *
 * 每件貨記兩個分類欄位：
 *   catId = 葉分類 id（搜尋分數靠佢查返分類全名）
 *   topId = 佢屬邊個頂層（前端「分類」版面同寵物判斷淨係識 22 個頂層）
 */
async function crawlWellcome({ pages, catLimit }) {
  const prev = await readJsonSafe(WC_FILE, { items: [] });
  // 舊資料照留，逐件覆蓋 —— 就算今次某個分類抓唔到，件貨都唔會憑空消失
  const found = new Map((prev.items || []).map((p) => [p.sku, p]));
  const before = found.size;

  /* 舊索引嗰陣 catId 記嘅就係頂層 id、冇 topId。補返佢，
     唔係嘅話今次冇重新抓到嗰啲舊貨會冇晒 topId → 分類版面同寵物篩選漏咗佢哋。 */
  const TOP_IDS = new Set(S.wellcome.CATEGORIES.map((c) => String(c.id)));
  let backfilled = 0;
  for (const p of found.values()) {
    if (!p.topId && TOP_IDS.has(String(p.catId))) { p.topId = String(p.catId); backfilled++; }
  }
  if (backfilled) log(`舊索引補返 topId：${backfilled} 件`);

  /* 分類樹攞唔到就退返去爬嗰 22 個頂層（即係舊行為），總好過乜都唔爬 */
  let leaves;
  try {
    const tree = await S.wellcome.categoryTree();
    leaves = S.wellcome.leafCategories(tree);
    log(`惠康分類樹：${tree.length} 個頂層 → ${leaves.length} 個葉分類`);
  } catch (e) {
    console.error(`[warn] 攞唔到惠康分類樹（${e.message}），退返去淨爬 22 個頂層`);
    leaves = S.wellcome.CATEGORIES.map((c) => ({ id: String(c.id), name: c.name, topId: String(c.id), topName: c.name }));
  }

  /* 一件貨可以同時擺喺幾個分類（例如原箱水又係「原箱優惠」又係「飲品」），
     但我哋一件貨得一個 catId —— 邊個分類最後爬到就邊個認領。
     所以葉分類次序要照返 CATEGORIES 嗰 22 個嘅次序（原箱優惠排第 21），
     唔係嘅話認領權會大執位，「原箱優惠」會突然變到得返零星幾件。 */
  const topOrder = new Map(S.wellcome.CATEGORIES.map((c, i) => [String(c.id), i]));
  /* 唯一例外：貓貓／狗狗專區排到最尾。「原箱優惠」底下有成條「寵物用品」
     子樹（原箱貓乾糧咁），畀佢認領咗嘅話件貨個 topId 就變咗原箱優惠，
     「只睇寵物」個篩選即刻搵佢唔返。寵物專區行最後，貓糧就實係貓糧。 */
  const PET_TOPS = new Set(['189651', '189941']);
  const ord = (l) => {
    const t = String(l.topId);
    return (topOrder.has(t) ? topOrder.get(t) : 99) + (PET_TOPS.has(t) ? 100 : 0);
  };
  leaves = leaves.map((l, i) => ({ l, i })).sort((a, b) => ord(a.l) - ord(b.l) || a.i - b.i).map((x) => x.l);

  // --cats=N 淨係爬頭 N 個頂層底下嘅葉分類（試機用）
  if (catLimit) {
    const keep = new Set(S.wellcome.CATEGORIES.slice(0, catLimit).map((c) => String(c.id)));
    leaves = leaves.filter((l) => keep.has(String(l.topId)));
  }

  log(`惠康爬蟲開始：${leaves.length} 個葉分類，每個最多 ${pages} 版；由 ${before} 件開始`);
  const started = Date.now();
  const capped = [];                   // 揭到上限先停嘅葉分類，行完出報告
  const failedLeaves = [];             // 真係抓失敗（唔係「冇貨」）嘅葉分類
  let pagesTotal = 0;
  let failedPages = 0;

  for (let i = 0; i < leaves.length; i++) {
    const c = leaves[i];
    const seenHere = new Set();        // 呢個分類自己見過嘅 sku（唔可以同舊索引比，唔係第一版就收工）
    let pagesRead = 0;
    let hitLimit = false;
    let broke = false;                 // 中途抓失敗（同「揭到底」要分得清楚）
    for (let page = 1; page <= pages; page++) {
      let list = null;
      let lastErr = null;
      /* 網絡抖一抖唔應該令成個分類白爬。試 3 次先當佢死 ——
         之前試過一轉 760 個葉入面有 2 個係純粹抓失敗、一件都冇入索引，
         而且喺 log 度同「呢個分類真係冇貨」完全分唔開。 */
      for (let attempt = 1; attempt <= 3 && list === null; attempt++) {
        try {
          list = await S.wellcome.category(c.id, page);
        } catch (e) {
          lastErr = e;
          if (e.status === 500) break;              // 揭爆咗，唔使再試
          if (attempt < 3) await sleep(1500 * attempt);
        }
      }
      if (list === null) {
        if (lastErr && lastErr.status === 500) hitLimit = true;   // 人哋封頂，唔係我哋壞
        else { failedPages++; broke = true; console.error(`  [FAIL] ${c.topName} › ${c.name} 第 ${page} 版：${lastErr && lastErr.message}（試咗 3 次）`); }
        break;
      }
      pagesRead++; pagesTotal++;
      if (!list.length) break;         // 揭到底
      let fresh = 0;
      for (const p of list) {
        if (!seenHere.has(p.sku)) { seenHere.add(p.sku); fresh++; }
        /* 一件貨可以同時擺喺幾個分類（例如「原箱優惠 › 汽水」同「飲品 › 汽水」都有佢）。
           以前淨係記一個 catId，後爬嘅葉會覆蓋前面 → 分類瀏覽報少貨
           （實測「廚具及餐桌用品」官網 232 件、app 只出 157 件）。
           而家全部都記低：catId/topId 保留做「主分類」（向後相容），
           catIds/topIds 收晒佢所有身份，分類瀏覽夾中任何一個就算。 */
        const old = found.get(p.sku);
        const catIds = new Set(old && old.catIds ? old.catIds : (old && old.catId ? [old.catId] : []));
        const topIds = new Set(old && old.topIds ? old.topIds : (old && old.topId ? [old.topId] : []));
        catIds.add(String(c.id));
        topIds.add(String(c.topId));
        found.set(p.sku, {
          ...p,
          catId: old && old.catId ? old.catId : String(c.id),      // 主分類：邊個先認領就係邊個
          topId: old && old.topId ? old.topId : String(c.topId),
          catIds: [...catIds],
          topIds: [...topIds],
        });
      }
      if (!fresh) break;               // 開始翻炒同一批，唔使再揭落去
      if (page === pages) hitLimit = true;
    }
    if (hitLimit) capped.push(`${c.topName} › ${c.name}（${seenHere.size} 件）`);
    if (broke) failedLeaves.push(`${c.topName} › ${c.name}（只攞到 ${seenHere.size} 件）`);
    log(`  [${i + 1}/${leaves.length}] ${c.topName} › ${c.name} → ${seenHere.size} 件（揭咗 ${pagesRead} 版）${hitLimit ? ' ⚠️ 貼住上限' : ''}`);

    // 行成粒鐘咁耐，中途死機／畀人 Ctrl+C 唔應該白行 —— 每 25 個葉存一次
    if ((i + 1) % 25 === 0 || i === leaves.length - 1) {
      const snap = [...found.values()];
      writeJsonAtomic(WC_FILE, { builtAt: Date.now(), count: snap.length, items: snap });
      const per = (Date.now() - started) / (i + 1);
      const left = Math.round(per * (leaves.length - i - 1) / 60000);
      log(`  … 存檔：${snap.length} 件（新增 ${snap.length - before}），估計仲有 ${left} 分鐘`);
    }
  }

  const items = [...found.values()];
  writeJsonAtomic(WC_FILE, { builtAt: Date.now(), count: items.length, items });
  log(`惠康爬蟲完成：${items.length} 件（新增 ${items.length - before}），揭咗 ${pagesTotal} 版，用咗 ${Math.round((Date.now() - started) / 1000)} 秒`);
  if (capped.length) {
    log(`⚠️ ${capped.length} 個葉分類貼住上限，可能仲有貨：`);
    for (const c of capped) log(`   · ${c}`);
  }
  if (failedLeaves.length) {
    // 呢個同「貼住上限」唔同：上限係人哋唔畀，失敗係我哋攞唔到，要記住返轉頭補
    log(`❌ ${failedLeaves.length} 個葉分類抓失敗（${failedPages} 版），呢啲分類今次冇更新到：`);
    for (const c of failedLeaves) log(`   · ${c}`);
    log('   → 想補返就再行一次（索引係增量嘅，唔會白行）');
  } else {
    log('✅ 冇任何葉分類抓失敗');
  }
  return items;
}

/* ---------------- 1.5 補返惠康自己藏起嘅貨 ---------------- */

const EXTRA_FILE = path.join(__dirname, 'extra-skus.json');

/**
 * 惠康「暫時缺貨」嘅貨品唔會出現喺分類列表，連佢自己個搜尋都搵唔到 ——
 * 但商品頁仲喺度、價錢照更新。即係話上面個爬蟲點爬都爬佢哋唔到，
 * 唔關分類漏爬事，係人哋根本冇喺列表出過。
 *
 * extra-skus.json 就係補丁：報咗缺失嘅 sku 擺入去，呢度直接開商品頁攞。
 * 每次都重新抓（唔係淨抓新嘅），咁「價錢」同「有冇貨」先跟得上；
 * 名單得十幾件，多打幾個 request 唔算失禮。
 *
 * 行喺爬蟲之後：爬蟲會用列表資料冚正個 record，跟住呢度再用商品頁資料補返
 * 圖同「有冇貨」。件貨返晒貨、重新入返列表嗰陣，兩邊資料一樣，冇衝突。
 */
async function mergeExtras() {
  const extra = await readJsonSafe(EXTRA_FILE, null);
  const list = (extra && extra.wellcome) || [];
  if (!list.length) { log('extra-skus.json 冇嘢要補'); return 0; }

  const idx = await readJsonSafe(WC_FILE, { items: [] });
  const found = new Map((idx.items || []).map((p) => [String(p.sku), p]));
  const imgs = (await readJsonSafe(WC_IMG_FILE, {})) || {};

  /* 分類唔使人手填 —— 商品頁自己講到佢叫「米粉/粉絲」，對返葉分類個名就有 id。
     人手填反而易錯（第一次就填錯咗做「即食麵/米粉」）。名單入面有寫先當人手指定。 */
  let byName = new Map();
  try {
    const leaves = S.wellcome.leafCategories(await S.wellcome.categoryTree());
    for (const l of leaves) if (!byName.has(l.name)) byName.set(l.name, l);
  } catch (e) {
    console.error(`[warn] 攞唔到惠康分類樹（${e.message}），今次啲貨會冇分類（搜尋照出，分類瀏覽揀唔到）`);
  }

  log(`補返惠康藏起嘅貨：名單 ${list.length} 件`);
  let ok = 0, failed = 0, oos = 0;
  for (const e of list) {
    const sku = String(e.sku);
    let d = null, lastErr = null;
    for (let attempt = 1; attempt <= 3 && !d; attempt++) {
      try { d = await S.wellcome.detail(sku); }
      catch (err) {
        lastErr = err;
        if (attempt < 3) await sleep(1200 * attempt);
      }
    }
    if (!d) {
      // 唔好靜靜雞食咗個 error —— 名單細，一件都唔應該無聲無息漏咗
      console.error(`  [FAIL] ${sku}：${lastErr ? lastErr.message : '攞唔到'}（試咗 3 次）${e.note ? ' — ' + e.note : ''}`);
      failed++;
      continue;
    }
    if (!d.name || !(d.price > 0)) {
      console.error(`  [SKIP] ${sku}：開到頁但冇名或者冇價，可能已經落架`);
      failed++;
      continue;
    }

    const old = found.get(sku) || {};
    // 分類：名單寫死 > 商品頁自己講 > 上次記住嗰個
    const leaf = d.categoryName ? byName.get(d.categoryName) : null;
    const catId = String(e.catId || (leaf && leaf.id) || old.catId || '');
    const topId = String(e.topId || (leaf && leaf.topId) || old.topId || '');

    const rec = S.decorate({
      ...old,
      id: `wellcome:${sku}`,
      store: 'wellcome',
      sku,
      name: d.name,
      price: d.price,
      wasPrice: old.wasPrice || null,
      url: `${WC_ORIGIN}/zh-hant/wellcome/p/${encodeURIComponent(d.name)}/i/${sku}.html`,
      image: d.image || old.image || null,
      inStock: d.inStock,
      promos: d.promos || [],
      catId,
      topId,
      fromExtra: true,
    }, d.spec);
    if (d.origin) rec.origin = d.origin;

    found.set(sku, rec);
    if (d.image) imgs[sku] = d.image;
    if (d.inStock === false) oos++;
    ok++;
    const catNote = catId ? `${leaf ? leaf.topName + ' › ' + leaf.name : catId}` : '⚠️ 無分類';
    log(`  ✓ ${sku} ${d.name} $${d.price}${d.inStock === false ? '（暫時缺貨）' : ''} — ${catNote}`);
  }

  writeJsonAtomic(WC_FILE, { builtAt: Date.now(), count: found.size, items: [...found.values()] });
  writeJsonAtomic(WC_IMG_FILE, imgs);
  log(`補貨完成：入到 ${ok} 件（其中 ${oos} 件暫時缺貨）${failed ? `，${failed} 件失敗` : ''}`);
  return ok;
}

/* ---------------- 2. 惠康商品圖增量補 ---------------- */

const OG_IMAGE = /(?:name|property)="og:image"\s+content="([^"]*)"/;

/**
 * 惠康個列表冇圖，要入商品頁攞 og:image。用 fetchHeadText 淨係讀頭 24KB 就收線，
 * 唔使成 200KB 都落齊。每次行最多補 budget 件（預設 800），排程行幾次就會慢慢儲齊。
 *
 * wc-images.json 入面：
 *   "12345": "https://..."  → 有圖
 *   "12345": ""             → 試過，人哋真係冇圖（或者 404）；除非 --retry-images 否則唔再試
 *   冇呢個 key              → 未試過 / 上次超時，下次再試
 */
async function fillImages({ budget, retry }) {
  const idx = await readJsonSafe(WC_FILE, { items: [] });
  const items = idx.items || [];
  if (!items.length) { log('惠康索引係空嘅，跳過補圖'); return {}; }

  /* 補圖預算有限，要行幾次先儲齊，所以邊個分類行先好緊要。
     日常買開嗰啲（生果、肉、奶蛋、麵包、急凍、米麵）同埋貓狗嘢排最前 ——
     唔排嘅話貓貓／狗狗專區喺分類次序度排第 19、20，隨時等幾日先有圖。 */
  const CAT_PRIORITY = [
    '100011', // 水果及蔬菜
    '100015', // 肉類及海鮮
    '100007', // 乳製品・蛋・冷凍
    '189651', // 貓貓專區
    '189941', // 狗狗專區
    '100003', // 早餐及麵包
    '100010', // 急凍食品
    '100020', // 米、油及麵
    '100013', // 生活用品
    '100002', // 飲品
    '100000', // 個人護理
    '100022', // 朱古力、薯片、零食
  ];
  const rank = new Map(CAT_PRIORITY.map((id, i) => [id, i]));
  // catId 而家係葉分類，所以要睇 topId 先對得返上面呢張頂層清單
  const prio = (p) => {
    const t = String(p.topId || p.catId);
    return rank.has(t) ? rank.get(t) : 99;
  };

  const map = (await readJsonSafe(WC_IMG_FILE, {})) || {};
  const todo = items.filter((p) => {
    const v = map[p.sku];
    if (v === undefined) return true;
    return retry && !v;                // 之前試過冇圖，今次先再試
  }).sort((a, b) => prio(a) - prio(b)).slice(0, budget);

  const have = items.filter((p) => map[p.sku]).length;
  log(`補圖：已經有 ${have}/${items.length} 張，今次補 ${todo.length} 件（預算 ${budget}）`);
  if (!todo.length) return map;

  let cursor = 0, done = 0, hit = 0, miss = 0, fail = 0;
  const started = Date.now();

  // fetchHeadText 內部已經限住同時 4 條線，所以呢度開 4 個工人啱啱好，唔會再加壓
  const CONC = 4;
  async function worker() {
    while (cursor < todo.length) {
      const p = todo[cursor++];
      try {
        const head = await S.fetchHeadText(`${WC_ORIGIN}/zh-hant/wellcome/p/x/i/${encodeURIComponent(p.sku)}.html`, 24000);
        const m = OG_IMAGE.exec(head);
        if (m && m[1]) { map[p.sku] = m[1]; hit++; } else { map[p.sku] = ''; miss++; }
      } catch (e) {
        // 4xx = 件貨落咗架，記低當冇圖；超時 / 斷線就唔記低，等下次再試
        if (e.status >= 400 && e.status < 500) { map[p.sku] = ''; miss++; } else fail++;
      }
      done++;
      if (done % 100 === 0) {
        writeJsonAtomic(WC_IMG_FILE, map);      // 行到一半畀人 Ctrl+C 都唔會白行
        log(`  補圖 ${done}/${todo.length}（有圖 ${hit}、冇圖 ${miss}、失敗 ${fail}）`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  writeJsonAtomic(WC_IMG_FILE, map);
  log(`補圖完成：有圖 ${hit}、冇圖 ${miss}、失敗 ${fail}，用咗 ${Math.round((Date.now() - started) / 1000)} 秒`);
  return map;
}

/* ---------------- 3. 出快照 ---------------- */

/** 單價入面 kind 前端唔用，剩返 {value, per, text}；value 唔使咁多個位，慳啲字數 */
function slimUnitPrice(u) {
  if (!u || !isFinite(u.value)) return null;
  return { value: Math.round(u.value * 1e4) / 1e4, per: u.per, text: u.text };
}

/** 規格前端淨係睇 kind / base（raw 冇人用），唔要就唔要 */
const slimSize = (s) => (s && s.kind && isFinite(s.base) ? { kind: s.kind, base: s.base } : null);

/**
 * 砌成同 /api/search 一模一樣嘅欄位，令前端零轉換。
 * 唔要 rel / lowest / isLowest / enriched / _name / _cat / _hay 呢啲內部嘢。
 */
function shape(p, { store, image, catId, topId, catIds, topIds }) {
  const meta = S.STORES[store];
  const out = {
    id: p.id || `${store}:${p.sku}`,
    store,
    sku: String(p.sku),
    name: p.name,
    price: p.price,
    wasPrice: p.wasPrice || null,
    discountPct: p.discountPct || null,
    url: p.url,
    image: image || null,
    inStock: p.inStock === undefined ? null : p.inStock,
    promos: (p.promos || []).slice(0, 3),
    size: slimSize(p.size),
    sizeText: p.sizeText || '',
    unitPrice: slimUnitPrice(p.unitPrice),
    storeName: meta.name,
    storeColour: meta.colour,
    catId: String(catId || ''),
  };
  // 惠康 catId 而家記葉分類，所以要多一個 topId 講返佢屬邊個頂層 ——
  // 前端「分類」版面同寵物判斷都係認住嗰 22 個頂層嘅。
  if (topId) out.topId = String(topId);
  /* 一件貨可以同時屬幾個分類。catId/topId 係「主分類」（向後相容），
     catIds/topIds 收晒佢所有身份 —— 分類瀏覽夾中任何一個就要出佢。
     淨得一個身份就唔使寫入去，慳返啲檔案大細。 */
  if (catIds && catIds.length > 1) out.catIds = catIds.map(String);
  if (topIds && topIds.length > 1) out.topIds = topIds.map(String);
  // brand / origin 唔喺合約條列入面，但 /api/search 有、前端又真係用得着
  // （brand 落搜尋分數、origin 落詳情頁），所以有先加，冇就唔加。
  if (p.brand) out.brand = p.brand;
  if (p.origin) out.origin = p.origin;
  return out;
}

/** 由分類樹砌一個「分類中文名 → id」表，畀舊索引（未有 catId 嗰啲）補飛 */
function catIdByName(tree) {
  const m = new Map();
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (!m.has(n.name)) m.set(n.name, String(n.id));
      walk(n.children);
    }
  }(tree));
  return m;
}

async function buildSnapshot() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  /* --- 惠康 --- */
  const wcIdx = await readJsonSafe(WC_FILE, { items: [] });
  const imgs = (await readJsonSafe(WC_IMG_FILE, {})) || {};
  const wcItems = (wcIdx.items || [])
    .filter((p) => p && p.sku && p.price > 0)
    .map((p) => shape(p, { store: 'wellcome', image: imgs[p.sku] || p.image,
      catId: p.catId, topId: p.topId, catIds: p.catIds, topIds: p.topIds }));

  /* --- 百佳（讀 rebuild-index.js 整嗰份，唔會寫佢） --- */
  const pnsIdx = await readJsonSafe(PNS_FILE, { items: [] });

  /* --- 分類 --- */
  const prevMeta = await readJsonSafe(path.join(OUT_DIR, 'meta.json'), null);
  let pnsTree;
  try {
    pnsTree = await S.parknshop.categoryTree();
    log(`百佳分類樹：${pnsTree.length} 個大類`);
  } catch (e) {
    // sitemap 打唔到就用返上次快照嗰份，總好過出個冇分類嘅 meta
    pnsTree = (prevMeta && prevMeta.categories && prevMeta.categories.parknshop) || [];
    console.error(`[warn] 攞唔到百佳分類樹（${e.message}），用返上次嗰份（${pnsTree.length} 個大類）`);
  }
  const byName = catIdByName(pnsTree);

  /* 惠康：導航照舊用嗰 22 個頂層（名同 icon 都係我哋自己揀嘅），
     但每個掛返佢啲子分類落去 —— 靜態版要靠呢個先知邊啲葉分類屬邊個頂層，
     撳「個人護理」先出得返而家記住葉 catId 嗰批貨。 */
  let wcTree = [];
  try {
    wcTree = await S.wellcome.categoryTree();
  } catch (e) {
    wcTree = (prevMeta && prevMeta.categories && prevMeta.categories.wellcome) || [];
    console.error(`[warn] 攞唔到惠康分類樹（${e.message}），用返上次嗰份`);
  }
  const wcKids = new Map(wcTree.map((t) => [String(t.id), t.children || []]));
  const wcCats = S.wellcome.CATEGORIES.map((c) => ({ ...c, children: wcKids.get(String(c.id)) || [] }));
  log(`惠康分類樹：${wcCats.length} 個頂層、${S.wellcome.leafCategories(wcTree).length} 個葉分類`);

  const pnsItems = (pnsIdx.items || [])
    .filter((p) => p && p.sku && p.price > 0)
    .map((p) => {
      const trail = p.categoryPath || [];
      // 舊索引未有 catId，用最尾嗰層分類名撈返個 id，撈唔到就空白（搜尋照用，淨係分類瀏覽揀唔到佢）
      const catId = p.catId || byName.get(trail[trail.length - 1]) || '';
      const o = shape(p, { store: 'parknshop', image: p.image, catId });
      o.categoryPath = trail;
      return o;
    });

  /* 內容冇變就唔好郁 builtAt。
   * 唔係嘅話每次排程行完 meta.json 都會唔同 → git 永遠見到有改動 →
   * 每 6 個鐘 commit + push 一份成 MB 嘅 blob，個 repo 幾個月就發水。
   * builtAt 亦都因此變成「啲價最後一次真係變過嘅時間」，比「幾時行過」有用。 */
  const dataHash = crypto.createHash('sha1')
    .update(JSON.stringify(wcItems)).update(JSON.stringify(pnsItems))
    .update(JSON.stringify(pnsTree)).update(JSON.stringify(wcCats))
    .digest('hex');
  const unchanged = prevMeta && prevMeta.dataHash === dataHash;
  if (unchanged) log('同上次快照一模一樣，builtAt 保持唔變（唔會製造無謂 commit）');

  const meta = {
    builtAt: unchanged ? prevMeta.builtAt : Date.now(),
    dataHash,
    counts: { wellcome: wcItems.length, parknshop: pnsItems.length },
    categories: { wellcome: wcCats, parknshop: pnsTree },
  };

  const files = [
    ['meta.json', meta],
    ['wellcome.json', { store: 'wellcome', items: wcItems }],
    ['parknshop.json', { store: 'parknshop', items: pnsItems }],
  ];

  console.log('');
  log('快照檔案大細：');
  let totalRaw = 0, totalGz = 0, pnsRaw = 0;
  for (const [name, obj] of files) {
    const buf = writeJsonAtomic(path.join(OUT_DIR, name), obj);
    const gz = zlib.gzipSync(buf, { level: 9 }).length;
    totalRaw += buf.length; totalGz += gz;
    if (name === 'parknshop.json') pnsRaw = buf.length;
    console.log(`  ${name.padEnd(15)} ${mb(buf.length).padStart(7)} MB   gzip 之後 ${mb(gz).padStart(7)} MB`);
  }
  console.log(`  ${'合共'.padEnd(14)} ${mb(totalRaw).padStart(7)} MB   gzip 之後 ${mb(totalGz).padStart(7)} MB`);

  const warnMb = optNum('warn-mb', 12);      // 界線幾多 MB 叫一聲（試機想睇到段警告可以校細佢）
  if (pnsRaw > warnMb * 1048576) {
    console.log('');
    console.log(`⚠️  parknshop.json 原始 ${mb(pnsRaw)} MB，過咗 ${warnMb}MB 界線。`);
    console.log('   要收細嘅話可以剪走 categoryPath 或者縮短欄位名 —— 但兩樣都要同時改');
    console.log('   public/app.js 嘅靜態模式先讀得返，所以唔好靜靜雞剪，傾過先算。');
  }

  log(`快照出好：惠康 ${wcItems.length} 件（有圖 ${wcItems.filter((p) => p.image).length} 件）、百佳 ${pnsItems.length} 件`);
  return { meta, wcItems, pnsItems };
}

/* ---------------- 埋尾：CLI ---------------- */

async function main() {
  const pages = optNum('pages', 40);
  const catLimit = optNum('cats', 0);
  const budget = optNum('images', Number(process.env.IMAGE_BUDGET) || 800);

  await seedFromPublished();          // CI 度冇 data/，由上一份快照還原，唔好整散啲貨

  if (hasFlag('skip-wellcome')) log('跳過惠康爬蟲（--skip-wellcome）');
  else await crawlWellcome({ pages, catLimit });

  // 爬完先補：呢啲貨爬蟲本身見唔到，要靠 extra-skus.json 逐個開商品頁攞
  if (hasFlag('skip-extras')) log('跳過補藏起嘅貨（--skip-extras）');
  else await mergeExtras();

  // 百佳整份目錄要爬 ~37 分鐘，唔使每次都行；排程一日行一次就夠
  if (hasFlag('refresh-pns')) {
    log('順便重爬百佳目錄（--refresh-pns）…');
    const pns = require('./lib-index.js');
    pns.load();
    await pns.build({ pages: 999, onTick: () => {} });
    log(`百佳目錄更新完：${pns.status().count} 件`);
  }

  if (hasFlag('skip-images')) log('跳過補圖（--skip-images）');
  else await fillImages({ budget, retry: hasFlag('retry-images') });

  await buildSnapshot();
}

if (require.main === module) {
  main().then(() => log('全部搞掂 ✅')).catch((e) => {
    console.error('[fatal]', e);
    process.exit(1);
  });
}

module.exports = { crawlWellcome, mergeExtras, fillImages, buildSnapshot };
