'use strict';
/* 落地快取 + 每個網站嘅節流（做個乖客仔，唔好當人哋係爬蟲場） */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'data', 'cache');
fs.mkdirSync(DIR, { recursive: true });

const memo = new Map();      // key -> {exp, value}
const inflight = new Map();  // key -> Promise（同一時間同一個 key 只打一次）

const keyFile = (k) => path.join(DIR, crypto.createHash('sha1').update(k).digest('hex') + '.json');

function readDisk(key) {
  try {
    const raw = fs.readFileSync(keyFile(key), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.exp > Date.now()) return obj;
    return null;
  } catch { return null; }
}

function writeDisk(key, value, ttlMs) {
  try {
    fs.writeFileSync(keyFile(key), JSON.stringify({ key, exp: Date.now() + ttlMs, at: Date.now(), value }));
  } catch { /* 快取寫唔到唔算致命 */ }
}

/**
 * 攞快取，冇就行 fn() 攞新嘅
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<any>} fn
 * @param {{stale?:boolean}} opt  stale=true → 拎唔到新資料時照回舊資料
 */
async function cached(key, ttlMs, fn, opt = {}) {
  const m = memo.get(key);
  if (m && m.exp > Date.now()) return { value: m.value, from: 'memory', at: m.at };

  const d = readDisk(key);
  if (d) { memo.set(key, { exp: d.exp, value: d.value, at: d.at }); return { value: d.value, from: 'disk', at: d.at }; }

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await fn();
      memo.set(key, { exp: Date.now() + ttlMs, value, at: Date.now() });
      writeDisk(key, value, ttlMs);
      return { value, from: 'live', at: Date.now() };
    } catch (err) {
      if (opt.stale) {
        const old = readStale(key);
        if (old) return { value: old.value, from: 'stale', at: old.at, error: err.message };
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** 唔理過唔過期都讀返出嚟（上游死咗時做後備） */
function readStale(key) {
  try { return JSON.parse(fs.readFileSync(keyFile(key), 'utf8')); } catch { return null; }
}

function stats() {
  let files = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(DIR)) { files++; bytes += fs.statSync(path.join(DIR, f)).size; }
  } catch { /* ignore */ }
  return { files, bytes, memory: memo.size };
}

function clear() {
  memo.clear();
  try { for (const f of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, f)); } catch { /* ignore */ }
}

/* ---------- 節流：每個 host 之間最少隔一段時間 ---------- */
const queues = new Map();
function throttle(host, minGapMs) {
  const q = queues.get(host) || { last: 0, chain: Promise.resolve() };
  queues.set(host, q);
  q.chain = q.chain.then(async () => {
    const wait = q.last + minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    q.last = Date.now();
  });
  return q.chain;
}

module.exports = { cached, readStale, stats, clear, throttle, DIR };
