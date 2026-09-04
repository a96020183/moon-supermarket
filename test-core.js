'use strict';
/* search-core 單一真相來源 —— 回歸測試
 *
 * 行法：node test-core.js
 *
 * 覆蓋：
 *   1. 詞庫中英雙向（expandQuery / synonyms）＋ lib-dict 向後相容
 *   2. norm 全形轉半形、headName 去規格
 *   3. scoreItem 排序常識（全脂牛奶 > 牛奶朱古力；奶瓶刷 = 0 分）
 *   4. lib-index.load() 之後真係搵到嘢
 *   5. 同重構前嘅基準（_baseline.json）對頭 10 個 sku
 */

const fs = require('fs');
const path = require('path');
const core = require('./public/search-core.js');
const dict = require('./lib-dict.js');
const idx = require('./lib-index.js');

/* ---------------- 迷你測試架 ---------------- */
let pass = 0, fail = 0;
const fails = [];

function group(name) { console.log(`\n${name}`); }

function t(name, fn) {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}\n       ${e.message}`); }
}

function ok(v, msg) { if (!v) throw new Error(msg || '應該係 true，但係假'); }
function eq(actual, expect, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expect);
  if (a !== b) throw new Error(`${msg ? msg + '：' : ''}預期 ${b}，實際 ${a}`);
}
function has(arr, v, msg) {
  if (!arr.includes(v)) throw new Error(`${msg ? msg + '：' : ''}搵唔到「${v}」，實際係 [${arr.join(', ')}]`);
}
function hasNot(arr, v, msg) {
  if (arr.includes(v)) throw new Error(`${msg ? msg + '：' : ''}唔應該有「${v}」，實際係 [${arr.join(', ')}]`);
}
function gt(a, b, msg) { if (!(a > b)) throw new Error(`${msg ? msg + '：' : ''}${a} 應該大過 ${b}`); }

/** 照 lib-index.search 嘅做法，幫一件貨計分 */
function sc(name, cat, q) {
  const terms = [...new Set(core.synonyms(q).map(core.norm).filter(Boolean))];
  return core.scoreItem(core.norm(name), core.norm(cat || ''), terms, core.norm(q));
}

/* ---------------- 1. 詞庫 ---------------- */
group('1. 詞庫中英雙向');

t('expandQuery 英轉中：milk → 牛奶', () => {
  const r = core.expandQuery('milk');
  eq(r[0], 'milk', '第一個一定係使用者打嗰個');
  has(r, '牛奶');
});

t('expandQuery 中轉英：廁紙 → toilet paper', () => {
  const r = core.expandQuery('廁紙');
  eq(r[0], '廁紙');
  has(r, 'toilet paper');
});

t('expandQuery 預設最多 2 個，可以調', () => {
  eq(core.expandQuery('牛奶').length, 2);
  ok(core.expandQuery('牛奶', 4).length <= 4);
  gt(core.expandQuery('牛奶', 4).length, 2);
});

t('expandQuery 詞庫冇嘅字原封不動；空字串回空陣列', () => {
  eq(core.expandQuery('乜鬼嘢都唔係'), ['乜鬼嘢都唔係']);
  eq(core.expandQuery(''), []);
  eq(core.expandQuery(null), []);
});

t('synonyms 中英雙向：牛奶 ↔ milk', () => {
  const zh = core.synonyms('牛奶');
  has(zh, 'milk'); has(zh, '鮮奶'); has(zh, 'dairy');
  const en = core.synonyms('milk');
  has(en, '牛奶'); has(en, 'fresh milk');
});

t('synonyms 唔會攞單個中文字去比對（除非本身就打嗰個字）', () => {
  hasNot(core.synonyms('牛奶'), '奶', '「奶」會夾中奶瓶刷，唔可以攞出嚟');
  has(core.synonyms('奶'), '奶', '使用者自己打「奶」就照用');
  has(core.synonyms('奶'), '牛奶');
});

t('synonyms 大細楷唔拘：MILK / Toilet Paper', () => {
  has(core.synonyms('MILK'), '牛奶');
  has(core.synonyms('Toilet Paper'), '廁紙');
});

t('hasCJK 分得出中英', () => {
  ok(core.hasCJK('牛奶')); ok(core.hasCJK('milk 牛奶'));
  ok(!core.hasCJK('milk')); ok(!core.hasCJK(''));
});

t('POPULAR 係前端快捷鍵用嗰批', () => {
  ok(Array.isArray(core.POPULAR) && core.POPULAR.length > 0);
  has(core.POPULAR, '牛奶'); has(core.POPULAR, '廁紙');
});

group('1b. lib-dict 向後相容（server.js 照舊 require 得到）');

t('lib-dict 三個舊出口都仲喺度', () => {
  const { expandQuery, synonyms, POPULAR } = dict;   // server.js:18 就係咁攞
  eq(typeof expandQuery, 'function');
  eq(typeof synonyms, 'function');
  ok(Array.isArray(POPULAR));
});

t('lib-dict 冇自己另開一份詞庫，直接指去 search-core', () => {
  ok(dict.expandQuery === core.expandQuery, 'expandQuery 應該係同一個 function');
  ok(dict.synonyms === core.synonyms, 'synonyms 應該係同一個 function');
  ok(dict.POPULAR === core.POPULAR, 'POPULAR 應該係同一個 array');
  ok(dict.hasCJK === core.hasCJK);
  ok(dict.TERMS === core.RAW, 'TERMS 就係 RAW');
});

t('lib-dict.js 檔案入面冇殘留詞庫（唔會有第二份真相）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'lib-dict.js'), 'utf8');
  ok(!src.includes("['牛奶'"), 'lib-dict.js 唔應該仲有詞條');
  ok(src.includes('search-core'), 'lib-dict.js 應該 require search-core');
});

/* ---------------- 2. norm / headName ---------------- */
group('2. norm 全形、headName 去規格');

t('norm 全形轉半形 + 細楷', () => {
  eq(core.norm('ＭＩＬＫ'), 'milk');
  eq(core.norm('Ｃｏｋｅ　Ｚｅｒｏ'), 'coke zero');
  eq(core.norm('１２３'), '123');
});

t('norm 去標點、收乾多餘空白', () => {
  eq(core.norm('全脂牛奶（１公升）'), '全脂牛奶 1公升');
  eq(core.norm('A-B_C'), 'a b c');
  eq(core.norm('  牛奶   '), '牛奶');
  eq(core.norm(null), '');
});

t('norm 中文字唔會被拆散', () => {
  eq(core.norm('可口可樂'), '可口可樂');
});

t('headName 剝走尾巴嘅規格', () => {
  eq(core.headName('全脂牛奶 1l'), '全脂牛奶');
  eq(core.headName('維他檸檬茶 250ml'), '維他檸檬茶');
  eq(core.headName('雞蛋 12pcs'), '雞蛋');
});

t('headName 剝走括號備註', () => {
  eq(core.headName('高鈣牛奶(低脂) 946ml'), '高鈣牛奶');
  eq(core.headName('薯片【原味】'), '薯片');
});

t('headName 剝走純數字尾巴，但唔會蝕入個名', () => {
  eq(core.headName('牛奶 2'), '牛奶');
  eq(core.headName('牛奶'), '牛奶');
  eq(core.headName('7up'), '7up');
});

/* ---------------- 3. scoreItem ---------------- */
group('3. scoreItem 評分常識');

t('中心詞喺名尾贏：全脂牛奶 > 牛奶朱古力', () => {
  const a = sc('全脂牛奶', '', '牛奶');
  const b = sc('牛奶朱古力', '', '牛奶');
  gt(a, 0, '全脂牛奶 應該有分');
  gt(a, b, `全脂牛奶(${a}) 一定要高過 牛奶朱古力(${b})`);
});

t('奶瓶清潔刷 對「牛奶」要 0 分', () => {
  eq(sc('奶瓶清潔刷', '', '牛奶'), 0);
  eq(sc('BB 奶瓶刷', '嬰兒用品', '牛奶'), 0);
});

t('「蛋卷」唔會夾中「雞蛋」（詞庫唔會攞單字「蛋」出嚟）', () => {
  eq(sc('蛋卷', '', '雞蛋'), 0);
  eq(sc('皮蛋瘦肉粥', '', '雞蛋'), 0);
});

t('真係雞蛋贏「雞蛋饅頭」呢類', () => {
  const real = sc('新鮮雞蛋', '', '雞蛋');
  const fake = sc('雞蛋卷餅乾', '', '雞蛋');
  gt(fake, 0, '個名真係有「雞蛋」兩隻字，梗係有分');
  gt(real, fake, `新鮮雞蛋(${real}) 要高過 雞蛋卷餅乾(${fake})`);
});

t('分類對得上都有分（就算個名冇寫）', () => {
  const s = sc('雀巢三花淡奶', '食品及飲品 > 牛奶、乳酪', '牛奶');
  gt(s, 0, '分類寫住牛奶就算同一類貨');
});

t('名同分類都夾中，分數高過淨係夾中一樣', () => {
  const both = sc('鮮牛奶', '食品及飲品 > 牛奶、乳酪', '牛奶');
  const nameOnly = sc('鮮牛奶', '零食', '牛奶');
  const catOnly = sc('雀巢三花淡奶', '食品及飲品 > 牛奶、乳酪', '牛奶');
  gt(both, nameOnly);
  gt(nameOnly, catOnly);
});

t('個名就係嗰樣嘢，分數最高', () => {
  const exact = sc('牛奶', '', '牛奶');
  gt(exact, sc('全脂牛奶', '', '牛奶'));
});

t('「洗頭水」唔會夾中「水果」', () => {
  eq(sc('新鮮水果籃', '食品及飲品 > 生果', '洗頭水'), 0);
});

t('英文查詢一樣掂：milk 搵到 fresh milk', () => {
  gt(sc('Fresh Milk 1L', 'Dairy', 'milk'), 0);
  eq(sc('Milkshake Machine', '', 'milk') > 0, true, 'milk 係字首都會夾中（同重構前一樣）');
});

/* ---------------- 4. lib-index 實地搜尋 ---------------- */
group('4. lib-index 載入之後搵到嘢');

const loaded = idx.load();

t('load() 讀到現有索引檔', () => {
  ok(loaded, '讀唔到 data/pns-index.json —— 係咪未起過索引？');
  gt(idx.status().count, 100, '索引件數');
});

t('lib-index.norm 就係 search-core 嗰個（server.js 用緊 idx.norm）', () => {
  ok(idx.norm === core.norm);
});

function checkSearch(q, expectIn) {
  const r = idx.search(q, 10);
  gt(r.length, 0, `search('${q}') 搵唔到嘢`);
  ok(r.every((p) => p.rel > 0), '每件都要有 rel 分數');
  const rels = r.map((p) => p.rel);
  eq(rels.slice().sort((a, b) => b - a), rels, '要由高分排到低分');
  ok(r.every((p) => p.sku && p.name), '每件都要有 sku 同名');
  ok(r.every((p) => p._name === undefined && p._cat === undefined), '內部欄位唔可以漏出去');
  const hay = core.norm(`${r[0].name} ${r[0].brand || ''} ${(r[0].categoryPath || []).join(' ')}`);
  ok(expectIn.some((w) => hay.includes(w)), `頭一件「${r[0].name}」睇落唔似 ${q}`);
  return r;
}

t("search('牛奶') 有合理結果", () => { checkSearch('牛奶', ['奶', 'milk']); });
t("search('milk') 有合理結果", () => { checkSearch('milk', ['奶', 'milk']); });
t("search('廁紙') 有合理結果", () => { checkSearch('廁紙', ['紙', 'toilet', 'tissue']); });

t("search('牛奶') 同 search('milk') 搵到嘅係同一批貨", () => {
  // 兩者同一組同義詞，淨係「使用者打嗰個詞」嗰 10 分獎勵唔同，所以頭幾名會調位，
  // 但攤大到頭 30 件就應該大致重疊。
  const a = idx.search('牛奶', 30).map((p) => p.sku);
  const b = idx.search('milk', 30).map((p) => p.sku);
  const overlap = a.filter((s) => b.includes(s)).length;
  gt(overlap, 15, `頭 30 件淨係重疊 ${overlap} 件，中英應該搵到差唔多嘢`);
});

t('search 空字串／垃圾字回空陣列，唔會爆', () => {
  eq(idx.search(''), []);
  eq(idx.search(null), []);
  eq(idx.search('zzzqqqxxx').length, 0);
});

t('build() 會幫每件貨加 catId（淨係睇 code，唔會真係行）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'lib-index.js'), 'utf8');
  ok(/catId:\s*String\(c\.id\)/.test(src), 'build() 入面搵唔到 catId: String(c.id)');
});

t('lib-index.js 冇殘留自己嗰份 norm / headName / score', () => {
  const src = fs.readFileSync(path.join(__dirname, 'lib-index.js'), 'utf8');
  ok(!/function\s+norm\s*\(/.test(src), '仲有自己嘅 norm');
  ok(!/function\s+headName\s*\(/.test(src), '仲有自己嘅 headName');
  ok(!/function\s+score\s*\(/.test(src), '仲有自己嘅 score');
  ok(src.includes('scoreItem'), '應該行 search-core 嘅 scoreItem');
});

/* ---------------- 5. 同重構前對數 ---------------- */
group('5. 重構前後對數（_baseline.json）');

// 呢兩個查詢喺 search-core 度詞庫係刻意改咗嘅（汽水嗰行唔再認 coke/cola），
// 所以唔攞去做「一模一樣」嘅比較，另外開條 test 講清楚點解。
const DICT_CHANGED = ['coke'];

let base = null;
try { base = JSON.parse(fs.readFileSync(path.join(__dirname, '_baseline.json'), 'utf8')); } catch { /* 冇就算 */ }

t('_baseline.json 喺度', () => {
  ok(base, '搵唔到 _baseline.json —— 行 node _baseline-capture.js（要喺重構前抽）');
  gt(Object.keys(base.queries).length, 5, '基準查詢數');
});

if (base) {
  // (a) 離線重算：唔靠索引檔，直接攞基準入面記低嘅商品欄位再計一次分。
  //     爬蟲就算中途換咗 data/pns-index.json，呢條都照樣準。
  t('離線重算：基準每件貨嘅 rel 分數一模一樣', () => {
    let checked = 0;
    for (const [q, b] of Object.entries(base.queries)) {
      if (DICT_CHANGED.includes(q)) continue;
      const terms = [...new Set(core.synonyms(q).map(core.norm).filter(Boolean))];
      const qn = core.norm(q);
      for (const rec of b.top) {
        const nameNorm = core.norm(`${rec.name} ${rec.brand || ''}`);
        const catNorm = core.norm((rec.categoryPath || []).join(' '));
        // 一定要同 production 一模一樣咁 call —— 少傳一個參數，呢條安全網就係假嘅
        const headNorm = core.norm(rec.name);
        const now = core.scoreItem(nameNorm, catNorm, terms, qn, headNorm,
          { catId: rec.catId || '', head: core.headName(headNorm) });
        if (now !== rec.rel) {
          throw new Error(`「${q}」→ ${rec.sku}（${rec.name}）重構前 ${rec.rel} 分，而家 ${now} 分`);
        }
        checked++;
      }
    }
    gt(checked, 50, '對過嘅件數');
    console.log(`       （離線對咗 ${checked} 件貨嘅分數）`);
  });

  // (b) 實地重跑：索引檔冇被爬蟲換過先做，換咗就唔夾硬比（會講明跳過）。
  const st = idx.status();
  const sameData = loaded && st.count === base.fingerprint.count && st.builtAt === base.fingerprint.builtAt;

  if (sameData) {
    for (const [q, b] of Object.entries(base.queries)) {
      if (DICT_CHANGED.includes(q)) continue;
      t(`search('${q}') 頭 10 個 sku 同重構前一致`, () => {
        const now = idx.search(q, 10);
        eq(now.map((p) => p.sku), b.top.map((x) => x.sku), 'sku 次序');
        eq(now.map((p) => p.rel), b.top.map((x) => x.rel), 'rel 分數');
      });
    }
  } else {
    console.log('  ⚠️  索引檔被重建過（爬蟲行完），跳過實地逐個 sku 對數；');
    console.log(`      基準 ${base.fingerprint.count} 件 / 而家 ${st.count} 件。上面嗰條離線重算已經覆蓋咗評分邏輯。`);
  }

  // (c) 唯一一個刻意唔同嘅地方，寫低佢
  t("詞庫刻意改動：'coke' 唔再拖埋汽水／soda 出嚟", () => {
    const syn = core.synonyms('coke');
    has(syn, '可樂'); has(syn, 'coca cola');
    hasNot(syn, 'soda', '舊 lib-dict 喺汽水嗰行放咗 coke/cola，累到 coke 搵到牌子叫 MY SODA 嘅沐浴露');
    hasNot(syn, '汽水');
    if (loaded) {
      const names = idx.search('coke', 20).map((p) => p.name);
      ok(!names.some((n) => n.includes('沐浴露')), `coke 唔應該再搵到沐浴露，而家有：${names.filter((n) => n.includes('沐浴露')).join(', ')}`);
    }
  });
}

/* ---------------- §6 行為契約 ----------------
 * 呢啲係實際踩過先修好嘅嘢。凍結佢哋嘅「行為」而唔係「分數」，
 * 咁將來調評分都唔會靜靜哋整返壞。
 */
console.log('\n§6 行為契約（實際踩過嘅坑）');

function scoreOf(name, { cat = '', catId = '', brand = '', q } = {}) {
  const terms = [...new Set(core.synonyms(q).map(core.norm).filter(Boolean))];
  const nameNorm = core.norm(`${name} ${brand}`);
  const headNorm = core.norm(name);
  return core.scoreItem(nameNorm, core.norm(cat), terms, core.norm(q), headNorm,
    { catId, head: core.headName(headNorm) });
}

t('中心詞喺名尾：「全脂牛奶」要贏「牛奶朱古力」', () => {
  const a = scoreOf('全脂牛奶', { q: '牛奶' });
  const b = scoreOf('牛奶朱古力', { q: '牛奶' });
  gt(a, b, `全脂牛奶 ${a} 分 vs 牛奶朱古力 ${b} 分`);
});

t('品牌唔可以污染中心詞判斷（「全脂牛奶」＋品牌照樣要贏）', () => {
  const a = scoreOf('全脂牛奶', { brand: '屈臣氏', q: '牛奶' });
  const b = scoreOf('牛奶朱古力', { q: '牛奶' });
  gt(a, b, `連品牌 ${a} 分 vs 牛奶朱古力 ${b} 分 —— 一齊 norm 落去就會認唔到中心詞`);
});

t('「牛奶」唔應該夾到「奶瓶清潔刷」（單字別名唔攞嚟比對）', () => {
  const s = scoreOf('奶瓶清潔刷套裝', { q: '牛奶' });
  ok(s === 0, `應該 0 分，而家 ${s} 分`);
});

t('寵物糧輕微壓低：買餸搵「三文魚」，新鮮嗰件要贏貓罐頭', () => {
  const fresh = scoreOf('三文魚柳', { catId: '100015', q: '三文魚' });
  const pet = scoreOf('貓濕糧 三文魚', { catId: '08020100', q: '三文魚' });
  gt(fresh, pet, `新鮮 ${fresh} 分 vs 寵物 ${pet} 分`);
  ok(pet > 0, '寵物貨唔可以變 0 分 —— 佢有貓有狗，唔可以收埋');
});

t('搵寵物嘢就唔扣分：「貓糧」照樣搵到貓糧', () => {
  const s = scoreOf('吞拿魚貓糧', { catId: '08020100', q: '貓糧' });
  gt(s, 60, `貓糧分數 ${s}`);
});

t('開咗 includePets 就完全唔扣分', () => {
  const terms = [...new Set(core.synonyms('三文魚').map(core.norm))];
  const n = core.norm('貓濕糧 三文魚');
  const off = core.scoreItem(n, '', terms, core.norm('三文魚'), n, { catId: '08020100' });
  const on = core.scoreItem(n, '', terms, core.norm('三文魚'), n, { catId: '08020100', includePets: true });
  gt(on, off, `includePets 開 ${on} 分 / 唔開 ${off} 分`);
});

t('預先算好嘅 head 同即場算要一模一樣', () => {
  const name = 'Meadows 常溫全脂奶 1LT';
  const terms = [...new Set(core.synonyms('牛奶').map(core.norm))];
  const n = core.norm(name);
  const live = core.scoreItem(n, '', terms, core.norm('牛奶'), n);
  const pre = core.scoreItem(n, '', terms, core.norm('牛奶'), n, { head: core.headName(n) });
  ok(live === pre, `即場 ${live} 分 vs 預算 ${pre} 分 —— 唔一致即係快取咗錯嘢`);
});

t('惠康係主場：分類清單第一個係惠康，而且 22 個分類齊', () => {
  const S = require('./lib-stores.js');
  eq(S.wellcome.CATEGORIES.length, 22, '惠康分類數');
  ok(S.wellcome.CATEGORIES.every((c) => c.id && c.name && c.icon), '每個分類要有 id / 名 / icon');
});

/* ---------------- 總結 ---------------- */
console.log(`\n${'─'.repeat(48)}`);
if (fail === 0) {
  console.log(`✅ 全綠：${pass} 條測試全部過`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} 條唔過（${pass} 條過）：`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
