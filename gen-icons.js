'use strict';
/* 整 PNG 圖示（iOS 加到主畫面唔食 SVG，一定要 PNG）。
   純 Node，用內置 zlib 自己砌 PNG，唔使裝任何嘢。 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                                   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/* ---------- 畫圖 ---------- */

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size / 512;                     // 由 512 設計稿放大縮細
  const AA = 2;                             // 每格取 2×2 樣本做柔邊

  const inRound = (x, y, x0, y0, x1, y1, r) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  // 籃身：上闊下窄嘅梯形（設計稿座標）
  const basket = (x, y) => {
    if (y < 216 || y > 448) return false;
    const t = (y - 216) / (448 - 216);
    const halfTop = 148, halfBot = 108;
    const half = halfTop + (halfBot - halfTop) * t;
    return Math.abs(x - 256) <= half;
  };

  const handle = (x, y) => {
    const dx = x - 256, dy = y - 190;
    if (dy > 26) return false;
    const d = Math.hypot(dx, dy * 1.15);
    return d > 56 && d < 82 && y < 218;
  };

  const heart = (x, y) => {
    const X = (x - 256) / 44, Y = (140 - y) / 44;
    const a = X * X + Y * Y - 1;
    return a * a * a - X * X * Y * Y * Y <= 0;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < AA; sy++) {
        for (let sx = 0; sx < AA; sx++) {
          const x = (px + (sx + 0.5) / AA) / S;
          const y = (py + (sy + 0.5) / AA) / S;
          let c = null;
          if (inRound(x, y, 0, 0, 512, 512, 112)) {
            c = mix([255, 231, 239], [240, 234, 254], (x + y) / 1024);        // 背景漸變
            if (basket(x, y)) c = mix([255, 155, 187], [232, 70, 124], (y - 216) / 232);
            if (basket(x, y)) {
              // 籃紋
              const vLine = [186, 256, 326].some((vx) => Math.abs(x - vx) < 6.5 && y > 264 && y < 388);
              const hLine = (Math.abs(y - 300) < 6.5 || Math.abs(y - 360) < 6.5);
              if (vLine || hLine) c = mix(c, [255, 255, 255], 0.5);
            }
            if (handle(x, y)) c = [232, 70, 124];
            if (heart(x, y)) c = [255, 255, 255];
          }
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = AA * AA;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      if (alpha > 0) {
        buf[i] = Math.round(r / (a / 255)); buf[i + 1] = Math.round(g / (a / 255)); buf[i + 2] = Math.round(b / (a / 255));
      }
      buf[i + 3] = Math.round(alpha);
    }
  }
  return png(size, size, buf);
}

const OUT = path.join(__dirname, 'public');
for (const size of [180, 192, 512]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(OUT, name), draw(size));
  console.log('寫好', name);
}
