'use strict';
/* 補返百佳索引嘅 catId。
 *
 * 點解要有：靜態版（GitHub Pages）冇 server，分類瀏覽要靠每件貨自己記住
 * 佢屬於邊個分類 id。舊索引係喺加呢個欄位之前爬嘅，所以要補。
 * 做法：用 sitemap 個分類樹砌「分類名 → id」，再由每件貨嘅 categoryPath 尾巴查返。
 *
 * 用法：node fix-catid.js
 */

const fs = require('fs');
const path = require('path');
const S = require('./lib-stores.js');
const { norm } = require('./public/search-core.js');

const FILE = path.join(__dirname, 'data', 'pns-index.json');

(async () => {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const items = raw.items || [];
  console.log(`索引 ${items.length} 件，補緊 catId…`);

  const tree = await S.parknshop.categoryTree();
  const leaves = S.parknshop.leafCategories(tree);

  // 分類名 → id。細類行先（愈specific愈啱），中類做後備。
  const byName = new Map();
  for (const c of leaves) {
    const k = norm(c.name);
    if (k && !byName.has(k)) byName.set(k, c.id);
  }
  for (const g of tree) {
    for (const l2 of g.children) {
      const k = norm(l2.name);
      if (k && !byName.has(k)) byName.set(k, l2.id);
    }
  }
  console.log(`分類對照表 ${byName.size} 條`);

  let filled = 0, missed = 0;
  const missNames = new Map();
  for (const p of items) {
    if (p.catId) continue;
    const pathArr = p.categoryPath || [];
    let id = null;
    // 由最specific嗰層開始向上試
    for (let i = pathArr.length - 1; i >= 0 && !id; i--) {
      id = byName.get(norm(pathArr[i])) || null;
    }
    if (id) { p.catId = id; filled++; } else {
      missed++;
      const key = pathArr.join('/') || '(冇 categoryPath)';
      missNames.set(key, (missNames.get(key) || 0) + 1);
    }
  }

  console.log(`補到 ${filled} 件，仲有 ${missed} 件對唔到`);
  if (missed) {
    console.log('對唔到嘅分類（頭 10 個）:');
    [...missNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([k, n]) => console.log(`   ${String(n).padStart(5)} × ${k}`));
  }

  fs.writeFileSync(FILE, JSON.stringify({ builtAt: raw.builtAt, count: items.length, items }));
  console.log('寫返 data/pns-index.json ✓');
})();
