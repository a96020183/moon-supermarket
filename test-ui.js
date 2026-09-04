/* 介面測試 —— 開個臨時靜態 server，用 Chrome headless 真係喺度撳。
 *
 * 點解要開真瀏覽器：「撳唔到」呢類 bug，用 node 跑唔出嚟。
 * 蓋住個掣嘅 toast、細過手指嘅點擊區、委派 handler 靜靜哋 return —— 全部都要
 * 喺真嘅版面度用 elementFromPoint 揀返最上面嗰件嘢，再喺佢身上派事件先撞得到。
 *
 * 跑法：  node test-ui.js
 * 只行靜態模式（public/data/ 嗰份快照），唔使開主 server、唔會打上游超市。
 *
 * 揾唔到 Chrome 就設環境變數 CHROME 指去 chrome.exe。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DRIVER = path.join(ROOT, 'test-ui-driver.html');
const DRIVER_URL = '/__uitest.html';          // 淨係喺測試 server 度存在，唔會派上 GitHub Pages
const PORT = Number(process.env.UI_TEST_PORT || 8803);
const CASES = process.argv.slice(2).length ? process.argv.slice(2) : ['fav', 'stale', 'chips'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const c of CHROME_CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* 算 */ } }
  return null;
}

/** 只餵 public/，/api/* 一律 404 —— 扮足 GitHub Pages 嗰個環境 */
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === DRIVER_URL) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(DRIVER));
        return;
      }
      if (p.startsWith('/api/')) { res.writeHead(404); res.end('冇 api'); return; }
      if (p === '/') p = '/index.html';
      const file = path.join(PUBLIC, p);
      if (!path.resolve(file).startsWith(path.resolve(PUBLIC))) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      });
    });
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

function runCase(chrome, name, shotDir) {
  return new Promise((resolve) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hkpb-ui-'));
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--user-data-dir=' + profile,
      '--virtual-time-budget=45000',
      '--window-size=430,900',
      '--screenshot=' + path.join(shotDir, name + '.png'),
      '--dump-dom',
      `http://127.0.0.1:${PORT}${DRIVER_URL}?case=${name}`,
    ];
    const ch = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let dom = '';
    ch.stdout.on('data', (d) => { dom += d; });
    ch.on('close', () => {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 算 */ }
      const m = dom.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
      const text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '';
      resolve(text);
    });
  });
}

(async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('搵唔到 Chrome。設個 CHROME 環境變數指去 chrome.exe 再試。');
    process.exit(2);
  }
  if (!fs.existsSync(path.join(PUBLIC, 'data', 'meta.json'))) {
    console.error('public/data/ 冇快照，行 build-snapshot.js 先。');
    process.exit(2);
  }

  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkpb-shot-'));
  const srv = await startServer();
  console.log(`介面測試 · 靜態模式 http://127.0.0.1:${PORT}  相片擺喺 ${shotDir}\n`);

  let pass = 0, fail = 0;
  for (const name of CASES) {
    console.log(`── 個案 ${name} ──`);
    const text = await runCase(chrome, name, shotDir);
    if (!text.trim()) { console.log('  (攞唔到結果，Chrome 冇出聲)'); fail++; continue; }
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith('PASS ')) pass++;
      if (l.startsWith('FAIL ')) fail++;
      console.log('  ' + l);
    }
    if (!text.includes('DONE')) { console.log('  (行唔完，當佢衰咗)'); fail++; }
    console.log('');
  }

  srv.close();
  console.log(`──────────\n${pass} 條過，${fail} 條唔過`);
  process.exit(fail ? 1 : 0);
})();
