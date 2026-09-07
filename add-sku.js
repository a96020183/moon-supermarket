'use strict';
/* 加返一件惠康「爬唔到」嘅貨
 *
 * 惠康暫時缺貨嘅貨品唔會出現喺分類列表，連佢自己個搜尋都搵唔到，
 * 所以爬蟲點爬都爬唔到。呢個 script 就係人手補飛嘅入口：
 *
 *   node add-sku.js 101385212
 *   node add-sku.js "https://www.wellcome.com.hk/zh-hant/p/糧之髓.../i/101385212.html"
 *   node add-sku.js 101385212 113472784        （一次過幾件）
 *   node add-sku.js --build 101385212          （加完順手出返份快照）
 *
 * 佢會：驗證商品頁真係開到 → 寫入 extra-skus.json → （可選）行 build-snapshot 出快照。
 * 分類唔使你填，build 嗰陣自己由商品頁讀返。
 */

const fs = require('fs');
const path = require('path');
const S = require('./lib-stores.js');

const FILE = path.join(__dirname, 'extra-skus.json');

const argv = process.argv.slice(2);
const doBuild = argv.includes('--build');
const args = argv.filter((a) => !a.startsWith('--'));

/** 由網址或者裸 sku 抽個 sku 出嚟 */
function toSku(input) {
  const s = String(input).trim();
  const m = /\/i\/(\d+)\.html/.exec(s) || /^(\d{6,})$/.exec(s);
  return m ? m[1] : null;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  if (!args.length) {
    console.log('用法：node add-sku.js <網址或sku> [更多…] [--build]');
    console.log('例：  node add-sku.js 101385212 --build');
    process.exit(1);
  }

  const skus = [];
  for (const a of args) {
    const sku = toSku(a);
    if (!sku) { console.error(`❌ 睇唔明「${a}」—— 要個商品頁網址，或者純數字 sku`); process.exit(1); }
    skus.push(sku);
  }

  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  doc.wellcome = doc.wellcome || [];
  const have = new Set(doc.wellcome.map((e) => String(e.sku)));

  let added = 0;
  for (const sku of skus) {
    if (have.has(sku)) { console.log(`↷ ${sku} 已經喺名單度，唔使再加`); continue; }

    // 加之前一定要開得到商品頁 —— 唔好將一個打錯嘅 sku 永久留喺名單度
    let d;
    try {
      d = await S.wellcome.detail(sku);
    } catch (e) {
      console.error(`❌ ${sku} 開唔到商品頁（${e.message}）—— 冇加`);
      continue;
    }
    if (!d.name || !(d.price > 0)) {
      console.error(`❌ ${sku} 開到頁但攞唔到名／價 —— 冇加`);
      continue;
    }

    doc.wellcome.push({
      sku,
      note: `${d.name} — ${today()} 人手補加${d.inStock === false ? '；當時暫時缺貨' : ''}`,
    });
    have.add(sku);
    added++;
    console.log(`✅ ${sku} ${d.name} $${d.price}${d.inStock === false ? '（暫時缺貨）' : ''}`
      + `${d.categoryName ? ' — ' + d.categoryName : ''}`);
  }

  if (!added) { console.log('冇加到嘢。'); return; }

  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  console.log(`\n寫咗入 extra-skus.json（名單而家 ${doc.wellcome.length} 件）`);

  if (doBuild) {
    console.log('\n出緊快照…\n');
    const b = require('./build-snapshot.js');
    await b.mergeExtras();
    await b.buildSnapshot();
  } else {
    console.log('跟住行呢句出返份快照：');
    console.log('  node build-snapshot.js --skip-wellcome --skip-images');
  }
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
