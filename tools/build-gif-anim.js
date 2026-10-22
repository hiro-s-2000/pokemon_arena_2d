#!/usr/bin/env node
// Builds pokeAnim sheets for roster entries that have no PMD SpriteCollab art (most Mega and
// Gigantamax forms, some Gen 5+ species), from the animated pokeSprite GIFs the game already ships.
//
// Every decoded GIF frame is first redrawn as PMD-style pixel art by tools/pixelize.js (PMD body
// height, one shared ~12-colour palette, black 1px outline; see that file), so the sheets match the
// SpriteCollab art around them. Beyond that the art is never warped: Idle is the GIF's own animation
// (frames, timing; or just its effect-free frames, see gif-anim-overrides/zz-calm-idle.json), and every action
// (Walk, Attack, Strike, Shoot, SpAttack, Charge, Hurt, Faint) is a sequence of curated GIF frames
// moved rigidly (whole-pixel lunges, recoils, hops, sinks) plus white flashes. The sheets use the
// exact PMD layout (8 rows S, SE, E, NE, N, NW, W, SW; fixed fw×fh; frames left→right, centred on a
// shared point) so the renderer can't tell them apart; their manifest entries carry
// "source": "gif-pixel" and the conversion parameters under "pixel".
//
//   node tools/build-gif-anim.js                  regenerate every GIF-derived entry in pokeAnim/
//   node tools/build-gif-anim.js --only <id>[,<id>…]   regenerate just those roster ids
//   node tools/build-gif-anim.js --review <dir>   also write curator contact sheets (<dir>/<id>.png)
//   node tools/build-gif-anim.js --pixel-review <dir>   also write pixel-art review sheets (<dir>/<id>.png)
//
// tools/build-anim.js calls build() after its PMD pass, so a plain `node tools/build-anim.js` keeps
// these entries. Per-id tuning lives in tools/gif-anim-overrides/*.json (schema in its README.md).
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Pixelize = require("./pixelize");
const PixelPaint = require("./pixel-paint"); // hand-painted frames (tools/pixel-paint/<id>/), see its README

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "pokeAnim");
const OVERRIDE_DIR = path.join(__dirname, "gif-anim-overrides");
const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
// Which GIF each sheet row comes from. front.gif faces left-down, front-reverse.gif right-down,
// back.gif looks up-right (away), back-reverse.gif up-left (verified on the contact sheets).
const ROW_GIF = { S: "front", SE: "frontR", E: "frontR", NE: "back", N: "backR", NW: "backR", W: "front", SW: "front" };
const GIF_FILES = { front: "front.gif", frontR: "front-reverse.gif", back: "back.gif", backR: "back-reverse.gif" };
// Screen-space unit vector each row faces (y down). Vertical motion is flattened a little,
// as the field is seen at an angle.
const FWD = DIRS.map((d, i) => {
  const a = Math.PI / 2 - i * Math.PI / 4;
  return { x: Math.cos(a), y: Math.sin(a) * 0.75 };
});
const MAX_SHEET_W = 16000; // stay well inside browser image / canvas limits

// ---------------------------------------------------------------------------------------------
// GIF decoding (same algorithm as game/js/sprites.js) → full-canvas RGBA frames with delays (1/100 s).

function lzw(minCode, data, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let bits = 0, acc = 0, pos = 0, op = 0, old = -1, first = 0;
  while (op < pixelCount) {
    while (bits < size && pos < data.length) { acc |= data[pos++] << bits; bits += 8; }
    if (bits < size) break;
    let code = acc & mask;
    acc >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { out[op++] = suffix[code]; old = first = code; continue; }
    const inCode = code;
    let sp = 0;
    if (code >= next) { stack[sp++] = first; code = old; }
    while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
    first = suffix[code];
    stack[sp++] = first;
    while (sp && op < pixelCount) out[op++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = old; suffix[next] = first; next++;
      if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; }
    }
    old = inCode;
  }
  return out;
}

function decodeGif(file) {
  const b = fs.readFileSync(file);
  if (b.toString("latin1", 0, 3) !== "GIF") throw new Error(`not a gif: ${file}`);
  const W = b.readUInt16LE(6), H = b.readUInt16LE(8);
  let p = 13, gct = null;
  if (b[10] & 0x80) { const n = 3 * (1 << ((b[10] & 7) + 1)); gct = b.subarray(p, p + n); p += n; }
  const frames = [];
  let canvas = new Uint8Array(W * H * 4);
  let gce = { delay: 10, trans: -1, disposal: 0 };
  while (p < b.length) {
    const block = b[p++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = b[p++];
      if (label === 0xf9) {
        const flags = b[p + 1];
        gce = { disposal: (flags >> 2) & 7, delay: b[p + 2] | (b[p + 3] << 8), trans: flags & 1 ? b[p + 4] : -1 };
      }
      while (b[p]) p += b[p] + 1;
      p++;
      continue;
    }
    if (block !== 0x2c) break;
    const fx = b.readUInt16LE(p), fy = b.readUInt16LE(p + 2), fw = b.readUInt16LE(p + 4), fh = b.readUInt16LE(p + 6);
    const flags = b[p + 8];
    p += 9;
    let ct = gct;
    if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); ct = b.subarray(p, p + n); p += n; }
    const interlaced = flags & 0x40;
    const minCode = b[p++];
    const chunks = [];
    while (b[p]) { chunks.push(b.subarray(p + 1, p + 1 + b[p])); p += b[p] + 1; }
    p++;
    const idx = lzw(minCode, Buffer.concat(chunks), fw * fh);
    const restore = gce.disposal === 3 ? canvas.slice() : null;
    const rows = interlaced ? interlaceRows(fh) : null;
    for (let y = 0; y < fh; y++) {
      const dy = fy + (rows ? rows[y] : y);
      if (dy >= H) continue;
      for (let x = 0; x < fw; x++) {
        const ci = idx[y * fw + x];
        if (ci === gce.trans || !ct || fx + x >= W) continue;
        const di = (dy * W + fx + x) * 4;
        canvas[di] = ct[ci * 3]; canvas[di + 1] = ct[ci * 3 + 1]; canvas[di + 2] = ct[ci * 3 + 2]; canvas[di + 3] = 255;
      }
    }
    frames.push({ data: canvas.slice(), delay: Math.max(2, gce.delay || 10) });
    if (gce.disposal === 2) {
      for (let y = fy; y < Math.min(H, fy + fh); y++) canvas.fill(0, (y * W + fx) * 4, (y * W + Math.min(W, fx + fw)) * 4);
    } else if (restore) canvas = restore;
    gce = { delay: 10, trans: -1, disposal: 0 };
  }
  return { W, H, frames };
}

function interlaceRows(h) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

function mirrorGif(g) {
  return {
    W: g.W, H: g.H,
    frames: g.frames.map((f) => {
      const d = new Uint8Array(f.data.length);
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const s = (y * g.W + x) * 4, t = (y * g.W + g.W - 1 - x) * 4;
        d[t] = f.data[s]; d[t + 1] = f.data[s + 1]; d[t + 2] = f.data[s + 2]; d[t + 3] = f.data[s + 3];
      }
      return { data: d, delay: f.delay };
    }),
  };
}

// Opaque bounding box of one frame, or null when empty.
function bbox(data, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] < 16) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------------------------
// PNG encoding: palette + tRNS when the image has ≤256 colours (lossless), RGBA otherwise.

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(img) {
  const { w, h, data } = img;
  const colors = new Map();
  for (let i = 0; i < w * h && colors.size <= 256; i++) {
    const k = data[i * 4 + 3] ? (data[i * 4] << 16 | data[i * 4 + 1] << 8 | data[i * 4 + 2]) * 2 + 1 : 0;
    if (!colors.has(k)) colors.set(k, colors.size);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  let raw, extra = [];
  if (colors.size <= 256) {
    // Transparent first so tRNS stays one byte long.
    const keys = [...colors.keys()].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
    keys.forEach((k, i) => colors.set(k, i));
    ihdr[9] = 3;
    const plte = Buffer.alloc(keys.length * 3);
    keys.forEach((k, i) => { const c = k >>> 1; plte[i * 3] = (c >> 16) & 255; plte[i * 3 + 1] = (c >> 8) & 255; plte[i * 3 + 2] = c & 255; });
    extra = [chunk("PLTE", plte)];
    if (keys[0] === 0) extra.push(chunk("tRNS", Buffer.from([0])));
    raw = Buffer.alloc((w + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const k = data[i + 3] ? (data[i] << 16 | data[i + 1] << 8 | data[i + 2]) * 2 + 1 : 0;
        raw[y * (w + 1) + 1 + x] = colors.get(k);
      }
    }
  } else {
    ihdr[9] = 6;
    const stride = w * 4;
    raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
      // Sub filter: cheap and good for sprite rows.
      raw[y * (stride + 1)] = 1;
      for (let i = 0; i < stride; i++) {
        const v = data[y * stride + i], a = i >= 4 ? data[y * stride + i - 4] : 0;
        raw[y * (stride + 1) + 1 + i] = (v - a) & 255;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), ...extra,
    chunk("IDAT", zlib.deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const newImg = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });

// Copies a w×h block of src at (sx, sy) to dst at (dx, dy). clipY: dst rows ≥ clipY are skipped
// (sinking into the ground); flash lightens toward white (0..1).
function blit(dst, src, sx, sy, w, h, dx, dy, { clipY = Infinity, flash = 0, sw = src.w } = {}) {
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.h || ty >= clipY) continue;
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.w) continue;
      const s = ((sy + y) * sw + sx + x) * 4;
      if (src.data[s + 3] < 16) continue;
      const t = (ty * dst.w + tx) * 4;
      for (let c = 0; c < 3; c++) dst.data[t + c] = flash ? Math.round(src.data[s + c] + (255 - src.data[s + c]) * flash) : src.data[s + c];
      dst.data[t + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Overrides.

function loadOverrides() {
  const out = {};
  if (!fs.existsSync(OVERRIDE_DIR)) return out;
  for (const f of fs.readdirSync(OVERRIDE_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const o = JSON.parse(fs.readFileSync(path.join(OVERRIDE_DIR, f), "utf8"));
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith("_")) continue;
      // Later files refine earlier ones; per-anim blocks merge too.
      const prev = out[k] || {};
      out[k] = { ...prev, ...v, anims: { ...(prev.anims || {}), ...(v.anims || {}) } };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One roster entry.

// Decodes the entry's GIFs (only the ones that exist; mirrors are made after pixelizing).
function loadGifs(p) {
  const dir = path.join(ROOT, path.dirname(p.sprite.replace(/^\.\.\//, "")));
  const g = {};
  for (const [k, f] of Object.entries(GIF_FILES)) if (fs.existsSync(path.join(dir, f))) g[k] = decodeGif(path.join(dir, f));
  return g.front ? { dir, g } : null;
}

// Fills in the missing directions by mirroring and lays the four GIFs out on a shared "core"
// canvas: each GIF's union bbox is cut out, centred horizontally and stood on the same feet line
// (the core's bottom edge).
function layoutSource(dir, g) {
  g = { ...g };
  g.frontR = g.frontR || mirrorGif(g.front);
  g.back = g.back || (g.backR ? mirrorGif(g.backR) : g.frontR);
  g.backR = g.backR || mirrorGif(g.back);
  const src = { dir, gifs: {} };
  let CW = 0, CH = 0;
  for (const [k, gif] of Object.entries(g)) {
    let u = null;
    const boxes = gif.frames.map((f) => bbox(f.data, gif.W, gif.H));
    for (const b of boxes) if (b) u = u ? { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) } : { ...b };
    u = u || { x0: 0, y0: 0, x1: 0, y1: 0 };
    const w = u.x1 - u.x0 + 1, h = u.y1 - u.y0 + 1;
    CW = Math.max(CW, w); CH = Math.max(CH, h);
    let t = 0;
    const starts = gif.frames.map((f) => { const s = t; t += f.delay; return s; });
    src.gifs[k] = { gif, u, w, h, boxes, starts, total: t };
  }
  CW += CW & 1; CH += CH & 1;
  src.CW = CW; src.CH = CH;
  for (const s of Object.values(src.gifs)) { s.ox = (CW - s.w) >> 1; s.oy = CH - s.h; }
  return src;
}

// Frame of a row's GIF that matches front.gif frame fi: same position in the loop, by time.
function rowFrame(src, row, fi) {
  const F = src.gifs.front, s = src.gifs[ROW_GIF[DIRS[row]]];
  if (s === F) return fi;
  const fiw = ((fi % F.gif.frames.length) + F.gif.frames.length) % F.gif.frames.length;
  const mid = (F.starts[fiw] + F.gif.frames[fiw].delay / 2) / F.total * s.total;
  let k = 0;
  while (k + 1 < s.starts.length && s.starts[k + 1] <= mid) k++;
  return k;
}

// Per-frame poses of front.gif inside the idle range: rest (first), crouch (head lowest),
// reach (tallest / widest), plus a "mid" pose between rest and reach.
function analyse(src, range) {
  const F = src.gifs.front;
  const idx = [];
  for (let i = range[0]; i <= range[1]; i++) idx.push(i);
  const top = (i) => (F.boxes[i] ? F.boxes[i].y0 : 1e9);
  const wid = (i) => (F.boxes[i] ? F.boxes[i].x1 - F.boxes[i].x0 : 0);
  const rest = range[0];
  let crouch = rest, reach = rest;
  for (const i of idx) {
    if (top(i) > top(crouch) || (top(i) === top(crouch) && wid(i) < wid(crouch))) crouch = i;
    if (top(i) < top(reach) || (top(i) === top(reach) && wid(i) > wid(reach))) reach = i;
  }
  if (crouch === reach) {
    // Static-looking loop: fall back to evenly spaced frames so moves still differ.
    const n = idx.length;
    crouch = idx[Math.floor(n / 3)]; reach = idx[Math.floor(2 * n / 3)];
  }
  const mid = Math.round((idx.indexOf(reach) + idx.indexOf(crouch)) / 2) + range[0];
  return { rest, crouch, reach, mid };
}

// Action recipes. Each step: [frame pose or index, ticks, motion]. Motion keys (all optional):
// f = forward along the facing (× lunge px), b = screen-up px (× lunge px), j = screen-x jitter
// px, s = sideways (perpendicular, × lunge px), sink = fraction of body height sunk into the
// ground, flash = 0..1 toward white. hit/rush/ret are step indices.
function recipes(L) {
  return {
    Walk: null, // built separately from the idle loop
    Attack: {
      steps: [["rest", 3, {}], ["crouch", 4, { f: -0.15 }], ["crouch", 3, { f: -0.2 }], ["reach", 2, { f: 0.5 }],
        ["reach", 5, { f: 1 }], ["reach", 3, { f: 0.9 }], ["mid", 3, { f: 0.5 }], ["rest", 3, { f: 0.15 }], ["rest", 2, {}]],
      rush: 3, hit: 4, ret: 6,
    },
    Strike: {
      steps: [["crouch", 6, { f: -0.3 }], ["crouch", 3, { f: -0.35, j: 1 }], ["reach", 1, { f: 0.6 }], ["reach", 1, { f: 1.3 }],
        ["reach", 2, { f: 1.45, s: 0.12, flash: 0.4 }], ["reach", 6, { f: 1.45, s: 0.12 }], ["mid", 2, { f: 1.4, s: 0.05 }],
        ["mid", 2, { f: 0.9 }], ["rest", 2, { f: 0.4 }], ["rest", 2, {}]],
      rush: 2, hit: 4, ret: 7,
    },
    Shoot: {
      steps: [["crouch", 4, { f: 0.05 }], ["reach", 3, { f: 0.1 }], ["reach", 2, { f: -0.25, flash: 0.3 }], ["reach", 5, { f: -0.32 }],
        ["mid", 3, { f: -0.2 }], ["rest", 3, { f: -0.08 }], ["rest", 2, {}]],
      hit: 2, ret: 4,
    },
    SpAttack: {
      steps: [["crouch", 5, { b: -0.08 }], ["reach", 3, { b: 0.25 }], ["reach", 3, { b: 0.45 }], ["reach", 3, { b: 0.55, flash: 0.4 }],
        ["reach", 5, { b: 0.6 }], ["reach", 5, { b: 0.55 }], ["mid", 3, { b: 0.35 }], ["rest", 3, { b: 0.12 }], ["rest", 2, {}]],
      hit: 3, ret: 6,
    },
    Charge: {
      steps: [["crouch", 2, { j: -1, b: -0.05 }], ["crouch", 2, { j: 1, b: -0.05 }], ["crouch", 2, { j: -1, b: -0.08 }], ["crouch", 2, { j: 1, b: -0.08, flash: 0.25 }],
        ["crouch", 2, { j: -1, b: -0.1 }], ["crouch", 2, { j: 1, b: -0.1, flash: 0.35 }], ["crouch", 2, { j: -2, b: -0.1 }], ["crouch", 2, { j: 2, b: -0.1, flash: 0.25 }],
        ["mid", 3, { b: -0.04 }], ["rest", 3, {}]],
      hit: 5, ret: 8,
    },
    // No flash on Hurt / Faint: the battle already flashes the body white on every hit.
    Hurt: {
      steps: [["crouch", 3, { f: -0.25 }], ["crouch", 6, { f: -0.32 }], ["mid", 4, { f: -0.15 }]],
      hit: 0,
    },
    Faint: {
      steps: [["crouch", 4, { f: -0.25 }], ["crouch", 4, { f: -0.35, b: 0.12 }], ["crouch", 6, { f: -0.4 }],
        ["crouch", 4, { f: -0.4, sink: 0.08 }], ["crouch", 4, { f: -0.4, sink: 0.16 }], ["crouch", 4, { f: -0.4, sink: 0.24 }],
        ["crouch", 30, { f: -0.4, sink: 0.3 }]],
      hit: 0,
    },
  };
}

const SHORTHAND = { idleFrames: "Idle", walkFrames: "Walk", attackFrames: "Attack", strikeFrames: "Strike", shootFrames: "Shoot",
  spAttackFrames: "SpAttack", chargeFrames: "Charge", hurtFrames: "Hurt", faintFrames: "Faint" };

// Resolved per-anim settings for an id: { frames?: [...], hit?, ticks?, lunge? } per anim.
function animOverrides(o) {
  const out = {};
  for (const [k, name] of Object.entries(SHORTHAND)) if (o[k]) (out[name] = out[name] || {}).frames = o[k];
  if (o.hitFrame != null) (out.Attack = out.Attack || {}).hit = o.hitFrame;
  for (const [name, a] of Object.entries(o.anims || {})) out[name] = { ...(out[name] || {}), ...a };
  return out;
}

// Ticks (1/60 s) per frame from GIF delays (1/100 s), rounding the running total so long
// loops keep their real length.
function toTicks(delays) {
  const out = [];
  let acc = 0, prev = 0;
  for (const d of delays) {
    acc += d;
    const end = Math.max(prev + 1, Math.round(acc * 0.6));
    out.push(end - prev);
    prev = end;
  }
  return out;
}

function buildEntry(p, o, ctx) {
  const raw = loadGifs(p);
  if (!raw) return null;
  const nF = raw.g.front.frames.length;
  const ao = animOverrides(o);
  const clampF = (i) => Math.max(0, Math.min(nF - 1, i));
  // Idle frames: an explicit list (idleFrames / anims.Idle.frames, e.g. only the effect-free frames
  // of a GIF that has move effects drawn into its loop) or the continuous idleRange.
  const idleList = (ao.Idle && ao.Idle.frames) ? ao.Idle.frames.map(clampF) : null;
  const range = idleList ? [Math.min(...idleList), Math.max(...idleList)]
    : o.idleRange ? [Math.max(0, o.idleRange[0]), Math.min(nF - 1, o.idleRange[1])] : [0, nF - 1];
  const idleIds = idleList || Array.from({ length: range[1] - range[0] + 1 }, (_, k) => range[0] + k);

  // PMD-style conversion of every frame of every GIF, scaled so the idle body is PMD-sized.
  const idleBox = (gif) => {
    let h = 0, w = 0;
    for (const i of idleIds) {
      const b = bbox(gif.frames[i].data, gif.W, gif.H);
      if (b) { h = Math.max(h, b.y1 - b.y0 + 1); w = Math.max(w, b.x1 - b.x0 + 1); }
    }
    return { h, w };
  };
  const srcH = idleBox(raw.g.front).h || raw.g.front.H;
  const target = Pixelize.targetHeight(p, ctx.roster, ctx.manifest, { heightOf: ctx.heightOf, pixelHeight: o.pixelHeight });
  // An outside outline adds a pixel above and below the body.
  const ringH = (o.outlineOutside ?? Pixelize.DEFAULTS.outlineOutside) && (o.outline ?? Pixelize.DEFAULTS.outline) !== "none" ? 2 : 0;
  const scale = Math.min(1, (target.h - ringH) / srcH);
  const pfId = o.paletteFrom === undefined ? target.base : o.paletteFrom;
  const popt = {
    colors: o.colors, alphaThreshold: o.alphaThreshold, outline: o.outline, outlineInner: o.outlineInner, outlineOutside: o.outlineOutside,
    innerLines: o.innerLines, lineWeight: o.lineWeight, keepDetail: o.keepDetail,
    speckSize: o.speckSize, speckContrast: o.speckContrast, darkLift: o.darkLift,
    paletteFrom: pfId ? Pixelize.pmdColours(pfId, ROOT) : null,
  };
  for (const k of Object.keys(popt)) if (popt[k] == null) delete popt[k];
  const px = Pixelize.pixelizeGifs(raw.g, scale, popt);
  // Hand-painted grids replace converted frames (exact pixels). ctx.paint: undefined = use
  // tools/pixel-paint/<id>/ if present, { mode: "derive", derive } = mirrors only (export), false = off.
  const paint = ctx.paint === false ? { painted: false } : PixelPaint.apply(p.id, px.gifs, ctx.paint || {});
  const src = layoutSource(raw.dir, px.gifs);
  const F = src.gifs.front;
  const poses = { ...analyse(src, range), ...(paint.poses || {}), ...(o.poses || {}) };

  // Body box of the S row over the idle frames (after conversion) → bodyH / bodyW, and the lunge
  // length in PMD pixels.
  let bodyH = 0, bodyW = 0;
  for (const i of idleIds) {
    const b = F.boxes[i];
    if (!b) continue;
    bodyH = Math.max(bodyH, b.y1 - b.y0 + 1); bodyW = Math.max(bodyW, b.x1 - b.x0 + 1);
  }
  const L = o.lungePx || Math.round(Math.min(14, Math.max(3, bodyH * 0.24)));
  const hop = o.hopPx || (bodyH >= 40 ? 2 : 1);
  const D = Pixelize.DEFAULTS;
  const pixel = {
    height: target.h, how: target.how, scale: +scale.toFixed(4), srcBodyH: srcH,
    colors: popt.colors ?? D.colors, alphaThreshold: popt.alphaThreshold ?? D.alphaThreshold,
    outline: popt.outline ?? D.outline, outlineOutside: popt.outlineOutside ?? D.outlineOutside, outlineInner: popt.outlineInner ?? D.outlineInner,
    innerLines: popt.innerLines ?? D.innerLines, lineWeight: popt.lineWeight ?? D.lineWeight, keepDetail: popt.keepDetail ?? D.keepDetail,
    speckSize: popt.speckSize ?? D.speckSize, speckContrast: popt.speckContrast ?? D.speckContrast, darkLift: popt.darkLift ?? D.darkLift,
    paletteFrom: popt.paletteFrom ? pfId : null, palette: px.palette.length, outlineShades: px.outlines.length,
  };
  if (paint.painted) { pixel.painted = true; pixel.paintedFrames = paint.frames; pixel.palette = paint.paletteSize; }

  // A frame = { pose: [gif frame index per row], rows: [{dx, dy, sink, flash}] , ticks }.
  const frames = {};
  const pose = (v) => (typeof v === "number" ? Math.max(0, Math.min(nF - 1, v)) : poses[v] ?? poses.rest);

  // Idle: the GIF loop as-is (or the listed frames, with their own GIF delays unless ticks are given).
  {
    const t = ao.Idle && ao.Idle.ticks;
    const ticks = t ? idleIds.map((_, k) => (Array.isArray(t) ? t[k % t.length] : t)) : toTicks(idleIds.map((i) => F.gif.frames[i].delay));
    frames.Idle = idleIds.map((fi, k) => ({ fi, ticks: ticks[k], motion: {} }));
  }
  // Walk: ~8 frames spread over the loop with a small step hop.
  {
    const w = ao.Walk || {};
    let ids = w.frames;
    if (!ids) {
      const n = Math.min(8, idleIds.length);
      ids = [];
      for (let k = 0; k < n; k++) ids.push(idleIds[Math.floor(k * idleIds.length / n)]);
    }
    const hops = [0, -hop / 2, -hop, -hop / 2, 0, -hop / 2, -hop, -hop / 2];
    const t = w.ticks || 5;
    frames.Walk = ids.map((fi, k) => ({ fi: pose(fi), ticks: Array.isArray(t) ? t[k % t.length] : t, motion: { px: { b: -Math.round(hops[k % 8]) } } }));
  }
  const rec = recipes(L);
  const meta = {};
  for (const [name, r] of Object.entries(rec)) {
    if (!r) continue;
    const a = ao[name] || {};
    const lunge = (a.lunge || L);
    frames[name] = r.steps.map(([ps, ticks, m], k) => ({
      fi: pose(a.frames ? a.frames[k % a.frames.length] : ps),
      ticks: a.ticks ? (Array.isArray(a.ticks) ? a.ticks[k % a.ticks.length] : a.ticks) : ticks,
      motion: { ...m, L: lunge },
    }));
    meta[name] = { hit: a.hit ?? r.hit, rush: r.rush ?? null, ret: r.ret ?? null };
  }
  return { src, frames, meta, poses, range, idleIds, bodyH, bodyW, L, raw, px, pixel, target, paint };
}

// Screen offset of one frame on one row.
function offset(m, row, bodyH) {
  if (m.px) return { dx: 0, dy: -(m.px.b || 0), sink: 0 };
  const L = m.L || 0, d = FWD[row];
  const side = { x: -d.y / 0.75, y: d.x * 0.75 };
  const dx = Math.round((m.f || 0) * L * d.x + (m.s || 0) * L * side.x + (m.j || 0));
  const dy = Math.round((m.f || 0) * L * d.y + (m.s || 0) * L * side.y - (m.b || 0) * L);
  return { dx, dy, sink: Math.round((m.sink || 0) * bodyH) };
}

// Renders one anim to a sheet. All sheets of an entry share the core canvas centred in the frame,
// so the feet sit at the same offset from the frame centre in every sheet (the renderer reads it
// from Idle only).
function renderSheet(entry, name) {
  const { src } = entry;
  const list = entry.frames[name];
  let padX = 1, padY = 1;
  const offs = list.map((fr) => DIRS.map((_, row) => offset(fr.motion, row, entry.bodyH)));
  for (const r of offs) for (const o of r) { padX = Math.max(padX, Math.abs(o.dx) + 1); padY = Math.max(padY, Math.abs(o.dy) + 1); }
  const fw = src.CW + 2 * padX, fh = src.CH + 2 * padY;

  // Drop consecutive frames that render identically on every row (merging their ticks).
  // (Painted frames carry a pid: frames routed to the same painted key frame count as identical.)
  const keyOf = (k) => JSON.stringify([DIRS.map((_, row) => {
    const gi = rowFrame(src, row, list[k].fi), f = src.gifs[ROW_GIF[DIRS[row]]].gif.frames[gi];
    return f.pid ?? gi;
  }), offs[k], list[k].motion.flash || 0]);
  const merged = [];
  for (let k = 0; k < list.length; k++) {
    const key = keyOf(k);
    const last = merged[merged.length - 1];
    if (last && last.key === key && name !== "Faint") { last.ticks += list[k].ticks; last.span.push(k); continue; }
    merged.push({ key, k, ticks: list[k].ticks, span: [k] });
  }
  // Step indices (hit/rush/ret) → merged frame indices.
  const remap = (i) => (i == null ? null : merged.findIndex((m) => m.span.includes(i)));

  const img = newImg(fw * merged.length, fh * 8);
  merged.forEach((m, col) => {
    for (let row = 0; row < 8; row++) {
      const s = src.gifs[ROW_GIF[DIRS[row]]];
      const gi = rowFrame(src, row, list[m.k].fi);
      const o = offs[m.k][row];
      const x = col * fw + padX + s.ox + o.dx, y = row * fh + padY + s.oy + o.dy + o.sink;
      const ground = row * fh + padY + src.CH + o.dy;
      blit(img, { w: s.gif.W, h: s.gif.H, data: s.gif.frames[gi].data }, s.u.x0, s.u.y0, s.w, s.h, x, y,
        { clipY: o.sink ? ground : Infinity, flash: list[m.k].motion.flash || 0 });
    }
  });
  const meta = entry.meta[name] || {};
  return {
    img, fw, fh, frames: merged.length, durations: merged.map((m) => m.ticks),
    hit: remap(meta.hit), rush: remap(meta.rush), ret: remap(meta.ret),
    anchorY: padY + src.CH, cols: merged.map((m) => list[m.k].fi),
  };
}

// Long idle loops (some Gen 5 GIFs have 160+ frames) are thinned to fit MAX_SHEET_W by merging
// neighbouring frames pairwise; the motion keeps its real speed.
function thinIdle(entry) {
  const fw = entry.src.CW + 2;
  while (entry.frames.Idle.length * fw > MAX_SHEET_W) {
    const out = [];
    const l = entry.frames.Idle;
    for (let k = 0; k < l.length; k += 2) out.push({ ...l[k], ticks: l[k].ticks + (l[k + 1] ? l[k + 1].ticks : 0) });
    entry.frames.Idle = out;
  }
}

// ---------------------------------------------------------------------------------------------
// Curator contact sheet: every front.gif frame, numbered (rest / crouch / reach / mid poses marked
// in colour; idle frames on a grey ground), then the S row of each generated anim. Scaled ×2.

const FONT = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
  5: "111100111001111", 6: "111100111101111", 7: "111001010010010", 8: "111101111101111", 9: "111101111001111",
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "011100101101011", H: "101101111101101", I: "111010010010111", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100", R: "110101110101101",
  S: "011100010001110", T: "111010010010010", U: "101101101101111", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111", V: "101101101101010", J: "001001001101010", Q: "010101101110011", ":": "000010000010000", " ": "000000000000000", "-": "000000111000000", "/": "001001010100100",
};
function text(img, x, y, str, rgb) {
  for (const ch of String(str).toUpperCase()) {
    const g = FONT[ch] || FONT[" "];
    for (let i = 0; i < 15; i++) if (g[i] === "1") {
      const px = x + (i % 3), py = y + Math.floor(i / 3);
      if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
      const t = (py * img.w + px) * 4;
      img.data[t] = rgb[0]; img.data[t + 1] = rgb[1]; img.data[t + 2] = rgb[2]; img.data[t + 3] = 255;
    }
    x += 4;
  }
}
function fill(img, x, y, w, h, rgb) {
  for (let yy = Math.max(0, y); yy < Math.min(img.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(img.w, x + w); xx++) {
    const t = (yy * img.w + xx) * 4;
    img.data[t] = rgb[0]; img.data[t + 1] = rgb[1]; img.data[t + 2] = rgb[2]; img.data[t + 3] = 255;
  }
}
function scale2(img) {
  const out = newImg(img.w * 2, img.h * 2);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const s = ((y >> 1) * img.w + (x >> 1)) * 4, t = (y * out.w + x) * 4;
    out.data[t] = img.data[s]; out.data[t + 1] = img.data[s + 1]; out.data[t + 2] = img.data[s + 2]; out.data[t + 3] = img.data[s + 3];
  }
  return out;
}

function writeReview(dir, id, entry, sheets) {
  const { src, poses } = entry;
  const F = src.gifs.front;
  const PER = 16, cw = src.CW + 4, chh = src.CH + 10;
  const nF = F.gif.frames.length;
  const W = Math.max(PER * cw, 8 * (src.CW + 2), 440) + 8;
  const anims = Object.keys(sheets).filter((n) => n !== "Idle");
  // Layout pass (dry) then draw pass.
  const lay = (img) => {
    let y = 2;
    const put = (fn) => { if (img) fn(); };
    put(() => text(img, 2, y, `${id}  FRONT.GIF ${nF} FRAMES  IDLE ${sheets.Idle.frames} FR  CORE ${src.CW}X${src.CH}  LUNGE ${entry.L}PX`, [255, 255, 255]));
    y += 7;
    put(() => {
      let x = 2;
      for (const [k, c] of [["REST", [120, 230, 120]], ["MID", [240, 220, 90]], ["CROUCH", [110, 170, 255]], ["REACH", [255, 110, 110]]]) {
        text(img, x, y, `${k} ${poses[k.toLowerCase()]}`, c); x += 4 * (k.length + 6);
      }
    });
    y += 8;
    const mark = {};
    for (const [k, c] of [["rest", [120, 230, 120]], ["mid", [240, 220, 90]], ["crouch", [110, 170, 255]], ["reach", [255, 110, 110]]]) mark[poses[k]] = mark[poses[k]] || c;
    for (let i = 0; i < nF; i++) {
      const x = 4 + (i % PER) * cw, yy = y + Math.floor(i / PER) * chh;
      put(() => {
        const inRange = entry.idleIds.includes(i);
        fill(img, x, yy, src.CW, src.CH, inRange ? [86, 92, 106] : [70, 50, 50]);
        blit(img, { w: F.gif.W, h: F.gif.H, data: F.gif.frames[i].data }, F.u.x0, F.u.y0, F.w, F.h, x + F.ox, yy + F.oy);
        text(img, x, yy + src.CH + 2, i, mark[i] || [200, 200, 200]);
      });
    }
    y += Math.ceil(nF / PER) * chh + 2;
    // Facing check: Idle frame 0 on all 8 rows.
    const I = sheets.Idle;
    put(() => text(img, 2, y, "ROWS: IDLE FRAME 0 IN S SE E NE N NW W SW ORDER", [255, 230, 160]));
    y += 7;
    for (let r = 0; r < 8; r++) put(() => {
      const x = 4 + r * (I.fw + 2);
      fill(img, x, y, I.fw, I.fh, [86, 92, 106]);
      blit(img, I.img, 0, r * I.fh, I.fw, I.fh, x, y);
      text(img, x + 1, y + I.fh + 1, DIRS[r], [200, 200, 200]);
    });
    y += I.fh + 8;
    for (const n of anims) {
      const s = sheets[n];
      put(() => text(img, 2, y, `${n} HIT ${s.hit ?? "-"}  GIF FR ${s.cols.join(" ")}  TICKS ${s.durations.join(" ")}`.slice(0, Math.floor(W / 4) - 1), [255, 230, 160]));
      y += 7;
      const per = Math.max(1, Math.floor((W - 8) / s.fw));
      for (let k = 0; k < s.frames; k++) {
        const x = 4 + (k % per) * s.fw, yy = y + Math.floor(k / per) * (s.fh + 1);
        put(() => {
          fill(img, x, yy, s.fw - 1, s.fh, k === s.hit ? [120, 70, 70] : [86, 92, 106]);
          blit(img, s.img, k * s.fw, 0, s.fw - 1, s.fh, x, yy, { sw: s.img.w });
        });
      }
      y += Math.ceil(s.frames / per) * (s.fh + 1) + 2;
    }
    return y;
  };
  const img = newImg(W, lay(null));
  fill(img, 0, 0, img.w, img.h, [52, 56, 66]);
  lay(img);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.png`), encodePng(scale2(img)));
}

// Pixel-art review sheet (curators): base species PMD Idle S frame (if any), converted Idle frame 0
// facing S / E / N, the original front.gif frame 0 at ×2 and the palette (body colours, then
// outline shades), then the S row of every anim. Pixel art at ×4 nearest.

function blitScaled(dst, src, sx, sy, w, h, dx, dy, k, sw = src.w) {
  for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
    const tx = dx + x, ty = dy + y;
    if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) continue;
    const s = ((sy + Math.floor(y / k)) * sw + sx + Math.floor(x / k)) * 4;
    if (src.data[s + 3] < 16) continue;
    const t = (ty * dst.w + tx) * 4;
    dst.data[t] = src.data[s]; dst.data[t + 1] = src.data[s + 1]; dst.data[t + 2] = src.data[s + 2]; dst.data[t + 3] = 255;
  }
}
function bigText(img, x, y, str, rgb) {
  const t = newImg(4 * String(str).length + 1, 6);
  text(t, 0, 0, str, rgb);
  blitScaled(img, t, 0, 0, t.w, t.h, x, y, 2);
}

function writePixelReview(dir, p, entry, sheets) {
  const K = 4, W = 1600, BG = [52, 56, 66], CELL = [86, 92, 106];
  const I = sheets.Idle;
  const items = [];
  const baseId = entry.target.base;
  const man = entry.manifestRef;
  if (baseId && man && man.pokemon[baseId] && fs.existsSync(path.join(OUT, baseId, "Idle.png"))) {
    const a = man.pokemon[baseId].anims.Idle;
    items.push({ label: `PMD ${baseId.replace(/^\d+_/, "")}`, img: Pixelize.decodePng(path.join(OUT, baseId, "Idle.png")), sx: 0, sy: 0, w: a.fw, h: a.fh, k: K });
  }
  for (const [lab, row] of [["IDLE S", 0], ["IDLE E", 2], ["IDLE N", 4]]) items.push({ label: lab, img: I.img, sx: 0, sy: row * I.fh, w: I.fw, h: I.fh, k: K });
  const F0 = entry.raw.g.front;
  items.push({ label: "GIF FRAME 0 X2", img: { w: F0.W, h: F0.H, data: F0.frames[0].data }, sx: 0, sy: 0, w: F0.W, h: F0.H, k: 2 });
  const sw = 14;
  const pal = [...entry.px.palette, null, ...entry.px.outlines];
  const lay = (img) => {
    let x = 8, y = 8, rowH = 0;
    const pi = entry.pixel;
    if (img) bigText(img, 8, y, `${p.id}  H ${pi.height} (${pi.how})  SCALE ${pi.scale}  BODY ${entry.bodyH}X${entry.bodyW}  COLORS ${pi.palette}+${pi.outlineShades}  LUNGE ${entry.L}`.replace(/[()_.]/g, " "), [255, 255, 255]);
    y += 20;
    for (const it of items) {
      const w = it.w * it.k, h = it.h * it.k;
      if (img) { fill(img, x, y + 14, w, h, CELL); blitScaled(img, it.img, it.sx, it.sy, it.w, it.h, x, y + 14, it.k); bigText(img, x, y, it.label.replace(/[_]/g, " "), [255, 230, 160]); }
      x += Math.max(w, it.label.length * 8) + 12; rowH = Math.max(rowH, h + 14);
    }
    if (img) {
      bigText(img, x, y, "PALETTE", [255, 230, 160]);
      pal.forEach((c, i) => { if (c) fill(img, x + (i % 6) * (sw + 2), y + 14 + Math.floor(i / 6) * (sw + 2), sw, sw, c); });
    }
    rowH = Math.max(rowH, 14 + Math.ceil(pal.length / 6) * (sw + 2));
    y += rowH + 12;
    for (const n of ANIM_ORDER) {
      const s = sheets[n];
      if (img) bigText(img, 8, y, `${n} HIT ${s.hit ?? "-"} ${s.fw}X${s.fh}`, [255, 230, 160]);
      y += 16;
      const per = Math.max(1, Math.floor((W - 16) / (s.fw * K + 4)));
      const shown = n === "Idle" ? Math.min(s.frames, per * 2) : s.frames;
      for (let k = 0; k < shown; k++) {
        const xx = 8 + (k % per) * (s.fw * K + 4), yy = y + Math.floor(k / per) * (s.fh * K + 4);
        if (img) { fill(img, xx, yy, s.fw * K, s.fh * K, k === s.hit ? [120, 70, 70] : CELL); blitScaled(img, s.img, k * s.fw, 0, s.fw, s.fh, xx, yy, K); }
      }
      y += Math.ceil(shown / per) * (s.fh * K + 4) + 8;
    }
    return y;
  };
  const img = newImg(W, lay(null));
  fill(img, 0, 0, img.w, img.h, BG);
  lay(img);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${p.id}.png`), encodePng(img));
}

// ---------------------------------------------------------------------------------------------

// Manifest entries this tool owns ("gif" = older unconverted builds, "gif-pixel" = PMD-style).
const isGifSource = (rec) => rec && (rec.source === "gif" || rec.source === "gif-pixel");

// Real height in metres from pokeData (for the PMD body-height regression).
function heightOf(p) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, p.dataPath.replace(/^\.\.\//, "")), "utf8"));
    return (d.height && d.height.meters) || 1;
  } catch (e) { return 1; }
}

const ANIM_ORDER = ["Idle", "Walk", "Attack", "Shoot", "SpAttack", "Charge", "Strike", "Hurt", "Faint"];

// Adds GIF-derived entries to `manifest` for every roster id without one (or just `only`).
// Writes the sheets to pokeAnim/<id>/. Returns [{ id, name, sprite }] for the credits.
function build({ manifest, roster, only = null, review = null, pixelReview = null, log = console.log } = {}) {
  const overrides = loadOverrides();
  const ctx = { roster, manifest, heightOf };
  const done = [];
  let bytes = 0;
  for (const p of roster) {
    if (only && !only.includes(p.id)) continue;
    const cur = manifest.pokemon[p.id];
    if (cur && !isGifSource(cur)) continue;
    const o = overrides[p.id] || {};
    const outDir = path.join(OUT, p.id);
    if (o.skip) { delete manifest.pokemon[p.id]; fs.rmSync(outDir, { recursive: true, force: true }); continue; }
    const entry = buildEntry(p, o, ctx);
    if (entry) entry.manifestRef = manifest;
    if (!entry) { log(`  ${p.id}: no front.gif, skipped`); continue; }
    thinIdle(entry);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const rec = { src: path.relative(ROOT, entry.src.dir), exact: true, source: "gif-pixel", shadowSize: 1, bodyH: entry.bodyH, bodyW: entry.bodyW, pixel: entry.pixel, anims: {} };
    const sheets = {};
    for (const name of ANIM_ORDER) {
      const s = renderSheet(entry, name);
      sheets[name] = s;
      const png = encodePng(s.img);
      bytes += png.length;
      fs.writeFileSync(path.join(outDir, `${name}.png`), png);
      rec.anims[name] = {
        file: `../pokeAnim/${p.id}/${name}.png`,
        fw: s.fw, fh: s.fh, frames: s.frames, rows: 8, durations: s.durations,
        hit: s.hit, rush: s.rush, ret: s.ret, anchorY: s.anchorY,
      };
    }
    // PMD shadow sizes by body width (PMD art of this width uses 1 below ~28px, 2 above).
    rec.shadowSize = entry.bodyW > 28 ? 2 : 1;
    manifest.pokemon[p.id] = rec;
    if (review) writeReview(review, p.id, entry, sheets);
    if (pixelReview) writePixelReview(pixelReview, p, entry, sheets);
    done.push({ id: p.id, name: p.name, sprite: rec.src });
  }
  log(`GIF-derived pokeAnim entries: ${done.length} (${(bytes / 1048576).toFixed(1)} MB of sheets)`);
  return done;
}

// Credits rows for GIF-derived entries (appended to pokeAnim/CREDITS.md by build-anim.js).
function creditLines(list) {
  if (!list.length) return [];
  const lines = [
    "",
    "## Sheets built from pokeSprite GIFs",
    "",
    "These entries (`\"source\": \"gif-pixel\"` in the manifest) have no SpriteCollab art. Their sheets were",
    "generated by `tools/build-gif-anim.js` from the animated battle GIFs already in `pokeSprite/`:",
    "every frame automatically converted to PMD-style pixel art by `tools/pixelize.js` (downscaled to",
    "PMD body size, reduced to a small palette, black outline; proportions unchanged, never warped),",
    "then re-timed and moved rigidly. They are not part of SpriteCollab and not covered by its licence.",
    "Pokémon © Nintendo / Creatures / GAME FREAK.",
    "",
    "| Roster id | Pokémon | Source GIFs |",
    "|---|---|---|",
  ];
  for (const c of list) lines.push(`| ${c.id} | ${c.name} | ${c.sprite}/ |`);
  return lines;
}

function writeManifest(manifest) {
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT, "manifest.js"),
    "// Generated by ../tools/build-anim.js. Do not edit by hand.\n" +
    `window.POKE_ANIM = ${JSON.stringify(manifest)};\n`);
}

module.exports = {
  build, creditLines, writeManifest, decodeGif, isGifSource,
  // internals for tools/pixel-paint.js (export / preview dry runs; nothing is written)
  buildEntry, thinIdle, renderSheet, rowFrame, loadOverrides, heightOf, loadGifs, encodePng, newImg, fill, text, blitScaled, bigText,
  ANIM_ORDER, DIRS, ROW_GIF, ROOT, OUT,
};

// Standalone: update the GIF-derived entries of an existing pokeAnim/ in place.
if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const only = arg("--only") ? arg("--only").split(",") : null;
  const review = arg("--review") ? path.resolve(arg("--review")) : null;
  const pixelReview = arg("--pixel-review") ? path.resolve(arg("--pixel-review")) : null;
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon;
  if (only) for (const id of only) if (!roster.some((p) => p.id === id)) { console.error(`unknown roster id: ${id}`); process.exit(1); }
  const done = build({ manifest, roster, only, review, pixelReview });
  writeManifest(manifest);
  // Rewrite the GIF section of CREDITS.md.
  const cfile = path.join(OUT, "CREDITS.md");
  if (fs.existsSync(cfile)) {
    const head = fs.readFileSync(cfile, "utf8").split("\n## Sheets built from pokeSprite GIFs")[0].replace(/\n+$/, "\n");
    const all = roster.filter((p) => isGifSource(manifest.pokemon[p.id]))
      .map((p) => ({ id: p.id, name: p.name, sprite: manifest.pokemon[p.id].src }));
    fs.writeFileSync(cfile, head + creditLines(all).join("\n") + "\n");
  }
  void done;
}
