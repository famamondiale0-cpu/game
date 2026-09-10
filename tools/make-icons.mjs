/**
 * make-icons.mjs - Genera le icone PNG dell'app senza dipendenze esterne.
 * Disegna su un buffer RGBA e lo codifica in PNG (IHDR/IDAT/IEND + CRC32).
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync, crc32 as zlibCrc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(ROOT, 'assets');

// --- CRC32 (usa quello di zlib se disponibile) ---
let crcTable = null;
function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // scanline con filtro 0 in testa a ogni riga
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Mini raster ---
class Canvas {
  constructor(size) { this.s = size; this.buf = Buffer.alloc(size * size * 4, 0); }
  px(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.s || y >= this.s) return;
    const i = (y * this.s + x) * 4;
    if (a === 255) { this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = 255; return; }
    const t = a / 255, inv = 1 - t;
    this.buf[i] = r * t + this.buf[i] * inv;
    this.buf[i + 1] = g * t + this.buf[i + 1] * inv;
    this.buf[i + 2] = b * t + this.buf[i + 2] * inv;
    this.buf[i + 3] = Math.max(this.buf[i + 3], a);
  }
  rect(x, y, w, h, c, radius = 0) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (radius > 0) {
          const dx = Math.min(i, w - 1 - i), dy = Math.min(j, h - 1 - j);
          if (dx < radius && dy < radius) {
            const d = Math.hypot(radius - dx, radius - dy);
            if (d > radius) continue;
          }
        }
        this.px(x + i, y + j, c);
      }
    }
  }
  vgrad(x, y, w, h, top, bot, radius = 0) {
    for (let j = 0; j < h; j++) {
      const t = j / Math.max(1, h - 1);
      const c = [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t, 255];
      for (let i = 0; i < w; i++) {
        if (radius > 0) {
          const dx = Math.min(i, w - 1 - i), dy = Math.min(j, h - 1 - j);
          if (dx < radius && dy < radius && Math.hypot(radius - dx, radius - dy) > radius) continue;
        }
        this.px(x + i, y + j, c);
      }
    }
  }
  circle(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) this.px(x, y, [c[0], c[1], c[2], d > r - 1 ? 150 : 255]);
      }
    }
  }
}

/** Disegna l'icona: skyline stilizzato di Zenith Block. */
function drawIcon(size, { maskable = false } = {}) {
  const c = new Canvas(size);
  const u = size / 512;                       // unita di disegno
  const pad = maskable ? size * 0.16 : 0;     // zona sicura per le icone maskable
  const radius = maskable ? 0 : Math.round(96 * u);

  // sfondo
  c.vgrad(0, 0, size, size, [18, 18, 18], [11, 16, 38], radius);

  // luna
  c.circle(size - pad - 62 * u, pad + 66 * u, 30 * u, [237, 239, 247]);

  const blocks = [
    { x: 150, y: 150, c: [62, 123, 250] },    // residenziale
    { x: 266, y: 150, c: [63, 191, 111] },    // parco
    { x: 150, y: 266, c: [245, 196, 43] },    // commerciale
    { x: 266, y: 266, c: [138, 122, 99] }     // industriale
  ];
  const inner = size - pad * 2;
  const map = (v) => pad + (v / 512) * inner;
  const sz = (v) => (v / 512) * inner;

  for (const b of blocks) {
    c.rect(Math.round(map(b.x)), Math.round(map(b.y)), Math.round(sz(96)), Math.round(sz(96)),
           [b.c[0], b.c[1], b.c[2], 255], Math.round(sz(14)));
    // finestre accese
    c.rect(Math.round(map(b.x + 22)), Math.round(map(b.y + 22)), Math.round(sz(20)), Math.round(sz(20)), [255, 243, 196, 220]);
    c.rect(Math.round(map(b.x + 54)), Math.round(map(b.y + 54)), Math.round(sz(20)), Math.round(sz(20)), [255, 243, 196, 180]);
  }

  // fondamenta: barra con sfumatura ciano -> viola
  const bx = Math.round(map(150)), by = Math.round(map(382));
  const bw = Math.round(sz(212)), bh = Math.round(sz(52));
  for (let i = 0; i < bw; i++) {
    const t = i / Math.max(1, bw - 1);
    const col = [79 + (124 - 79) * t, 195 + (77 - 195) * t, 247 + (255 - 247) * t, 255];
    c.rect(bx + i, by, 1, bh, col);
  }
  return c.buf;
}

mkdirSync(OUT, { recursive: true });
const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-256.png', size: 256 },
  { file: 'icon-384.png', size: 384 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 }
];

for (const t of targets) {
  const rgba = drawIcon(t.size, { maskable: t.maskable });
  const png = encodePNG(t.size, t.size, rgba);
  writeFileSync(join(OUT, t.file), png);
  console.log('  ' + t.file.padEnd(26) + t.size + 'x' + t.size + '  ' + (png.length / 1024).toFixed(1) + ' KB');
}
console.log('Icone generate in assets/');
