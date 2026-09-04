'use strict';
/* 由商品名解析重量 / 容量 / 件數，計每 100 克・每 100 毫升・每件單價 */

// 單位 → [種類, 換算成基本單位(克 / 毫升 / 件)的倍數]
const UNIT_MAP = new Map([
  ['KG', ['weight', 1000]], ['KGS', ['weight', 1000]], ['公斤', ['weight', 1000]], ['千克', ['weight', 1000]],
  ['G', ['weight', 1]], ['GM', ['weight', 1]], ['GMS', ['weight', 1]], ['GR', ['weight', 1]],
  ['GRAM', ['weight', 1]], ['GRAMS', ['weight', 1]], ['克', ['weight', 1]], ['公克', ['weight', 1]],
  ['斤', ['weight', 604.8]], ['兩', ['weight', 37.8]],
  ['LB', ['weight', 453.59]], ['LBS', ['weight', 453.59]], ['OZ', ['weight', 28.35]],
  ['L', ['volume', 1000]], ['LT', ['volume', 1000]], ['LTR', ['volume', 1000]], ['LTRS', ['volume', 1000]],
  ['LTS', ['volume', 1000]], ['升', ['volume', 1000]], ['公升', ['volume', 1000]],
  ['ML', ['volume', 1]], ['MLS', ['volume', 1]], ['CC', ['volume', 1]], ['毫升', ['volume', 1]],
  ['PC', ['count', 1]], ['PCS', ['count', 1]], ['PK', ['count', 1]], ['PKS', ['count', 1]],
  ['PKT', ['count', 1]], ['PKTS', ['count', 1]], ['EA', ['count', 1]], ['CT', ['count', 1]],
  ['ROLL', ['count', 1]], ['ROLLS', ['count', 1]], ['SHEET', ['count', 1]], ['SHEETS', ['count', 1]],
  ['件', ['count', 1]], ['個', ['count', 1]], ['包', ['count', 1]], ['排', ['count', 1]],
  ['片', ['count', 1]], ['粒', ['count', 1]], ['卷', ['count', 1]], ['條', ['count', 1]],
  ['支', ['count', 1]], ['盒', ['count', 1]], ['入', ['count', 1]], ['隻', ['count', 1]],
  ['對', ['count', 1]], ['張', ['count', 1]], ['底', ['count', 1]],
]);

// 長單位行先，避免 "GM" 被 "G" 食咗
const UNITS = [...UNIT_MAP.keys()].sort((a, b) => b.length - a.length).join('|');
const TAIL = '(?![A-Za-z0-9\\u4e00-\\u9fff])';           // 單位後面唔可以再接字
const NUM = '(\\d+(?:\\.\\d+)?)';

const RE_PACK_FIRST = new RegExp(`(\\d+)\\s*[Xx*×]\\s*${NUM}\\s*(${UNITS})${TAIL}`);   // 12 X 1LT
const RE_PACK_LAST = new RegExp(`${NUM}\\s*(${UNITS})\\s*[Xx*×]\\s*(\\d+)(?![\\d.])`); // 330ML X 6
const RE_PLAIN = new RegExp(`${NUM}\\s*(${UNITS})${TAIL}`, 'g');                        // 454GM

/**
 * 解析商品名內嘅規格
 * @returns {{raw:string, kind:'weight'|'volume'|'count', base:number, packs:number}|null}
 *          base = 總量（克 / 毫升 / 件）
 */
function parseSize(name) {
  if (!name) return null;
  const s = String(name).toUpperCase().replace(/[，、]/g, ' ').replace(/\s+/g, ' ').trim();

  let m = RE_PACK_FIRST.exec(s);
  if (m) {
    const u = UNIT_MAP.get(m[3]);
    if (u) return { raw: m[0].trim(), kind: u[0], base: Number(m[1]) * Number(m[2]) * u[1], packs: Number(m[1]) };
  }
  m = RE_PACK_LAST.exec(s);
  if (m) {
    const u = UNIT_MAP.get(m[2]);
    if (u) return { raw: m[0].trim(), kind: u[0], base: Number(m[1]) * Number(m[3]) * u[1], packs: Number(m[3]) };
  }
  // 掃晒所有 "數字+單位"，重量／容量優先於件數（比價先有意義）
  RE_PLAIN.lastIndex = 0;
  let wv = null, ct = null, mm;
  while ((mm = RE_PLAIN.exec(s)) !== null) {
    const u = UNIT_MAP.get(mm[2]);
    if (!u) continue;
    const hit = { raw: mm[0].trim(), kind: u[0], base: Number(mm[1]) * u[1], n: Number(mm[1]) };
    if (u[0] === 'count') ct = hit; else wv = hit;
  }
  // 「250毫升 6包」= 6 × 250毫升；件數當包裝數用（上限 60，避免 "130張" 之類誤乘）
  if (wv && ct && ct.n > 1 && ct.n <= 60) {
    return { raw: `${wv.raw} x ${ct.raw}`, kind: wv.kind, base: wv.base * ct.n, packs: ct.n };
  }
  if (wv) return { raw: wv.raw, kind: wv.kind, base: wv.base, packs: 1 };
  if (ct) return { raw: ct.raw, kind: ct.kind, base: ct.base, packs: 1 };
  return null;
}

/** 由價錢 + 規格算單價 */
function unitPrice(price, size) {
  if (!price || !size || !size.base || size.base <= 0) return null;
  if (size.kind === 'weight') {
    const v = (price / size.base) * 100;
    return { value: v, per: '100克', kind: 'weight', text: `$${fmt(v)} / 100克` };
  }
  if (size.kind === 'volume') {
    const v = (price / size.base) * 100;
    return { value: v, per: '100毫升', kind: 'volume', text: `$${fmt(v)} / 100毫升` };
  }
  const v = price / size.base;
  return { value: v, per: '件', kind: 'count', text: `$${fmt(v)} / 件` };
}

/** 規格顯示文字，例如 1LT → 1公升、454GM → 454克 */
function sizeLabel(size) {
  if (!size) return '';
  if (size.kind === 'weight') return size.base >= 1000 ? `${trim(size.base / 1000)}公斤` : `${trim(size.base)}克`;
  if (size.kind === 'volume') return size.base >= 1000 ? `${trim(size.base / 1000)}公升` : `${trim(size.base)}毫升`;
  return `${trim(size.base)}件`;
}

function trim(n) { return Number(n.toFixed(2)).toString(); }

function fmt(n) {
  if (!isFinite(n)) return '—';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

module.exports = { parseSize, unitPrice, sizeLabel, fmt };
