/* 重建百佳本地目錄。
 * 用法：node rebuild-index.js [每個分類最多幾多版]
 *   node rebuild-index.js        → 抓盡（行到每個分類見底）
 *   node rebuild-index.js 8      → 每個分類最多 8 版（快啲，覆蓋少啲）
 */
const idx = require('./lib-index.js');

const pages = Number(process.argv[2]) || 999;
idx.load();
console.log(`[index] 開始重建，每個分類最多 ${pages === 999 ? '抓盡' : pages + ' 版'}；由 ${idx.status().count} 件開始`);

let last = 0;
const started = Date.now();
idx.build({
  pages,
  onTick: (s) => {
    if (s.progress.done - last >= 5 || s.progress.done === s.progress.total) {
      last = s.progress.done;
      const mins = Math.round((Date.now() - started) / 60000);
      console.log(`[${s.progress.done}/${s.progress.total}] ${s.progress.current}  （行咗 ${mins} 分鐘）`);
    }
  },
}).then((s) => console.log('DONE', JSON.stringify(s)));
