// PMD-style pixel-art conversion for tools/build-gif-anim.js.
//
// pokeSprite GIFs are 2-3x denser than PMD SpriteCollab art, with many colours and thin outlines.
// pixelizeGifs() turns every decoded frame of an entry's GIFs into PMD-density art before any action
// is composed, with one shared palette so nothing flickers between frames, directions or anims:
//
//   1. area (box) downscale in linear light to the PMD body height; alpha = coverage of each target
//      pixel, kept at >= alphaThreshold, or at a lower coverage when the pixel is the ridge of a thin
//      feature (horn, tail tip, antenna) that would otherwise vanish
//   2. palette: weighted k-means in OKLab over every kept pixel of every frame of every GIF
//      (colors, default 12), optionally snapped toward a PMD sheet's colours (paletteFrom)
//   3. snap with no dithering; drop orphan pixels, fill 1px holes, absorb low-contrast specks
//      (high-contrast specks such as eyes stay)
//   4. 1px PMD outline: every silhouette-edge pixel becomes the dark shade of the colour inside it
//      (or near-black); optional inner contour where colour regions meet strongly
//
// targetHeight() picks the PMD-equivalent body height (see its comment). No npm dependencies.
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DEFAULTS = {
  colors: 12,             // palette size before outline shades
  alphaThreshold: 0.45,   // coverage needed for a pixel to be opaque
  thinThreshold: 0.2,     // lower coverage still kept on the ridge of a thin feature
  outline: "black",       // "black" (PMD's pure black) | "dark" (dark shade of the enclosed colour) | "none"
  innerLines: 0.34,       // a pixel whose area is at least this much source stroke becomes a line (0 = off)
  outlineOutside: true,   // ring the silhouette from outside (keeps thin parts' colour) instead of darkening its edge pixels
  outlineInner: false,    // also draw dark lines where strongly different colour regions meet
  keepDetail: 3,
  speckSize: 3,           // clusters up to this size whose colour is close (speckContrast, OKLab) to
  speckContrast: 0.16,    // their surroundings are merged into them (texture / shading noise)
  darkLift: 0.32,         // palette colours darker than this (OKLab L) covering ≥ darkLiftShare of the art are lifted to it
  darkLiftShare: 0.05,
  lineWeight: 0.6,        // weight of the source's thin dark strokes when picking a pixel's colour          // high-contrast clusters up to this size (eyes, gems) survive cleanup and outline
  paletteRadius: 0.075,   // paletteFrom: OKLab distance within which a colour snaps to the PMD colour
};

// ---------------------------------------------------------------------------------------------
// Colour spaces.

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const toSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};
function linToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
const rgbToOklab = (r, g, b) => linToOklab(LIN[r], LIN[g], LIN[b]);
const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

// ---------------------------------------------------------------------------------------------
// PNG decoding (8-bit RGBA / RGB / palette / grey, non-interlaced) → { w, h, data: RGBA }.

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; }
    else if (type === "PLTE") plte = d;
    else if (type === "tRNS") trns = d;
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (ch * depth) >> 3), stride = (w * ch * depth + 7) >> 3;
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = (y * w + x) * 4;
    if (ctype === 3) {
      const bit = x * depth, i = (px[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      data[t] = plte[i * 3]; data[t + 1] = plte[i * 3 + 1]; data[t + 2] = plte[i * 3 + 2]; data[t + 3] = trns && i < trns.length ? trns[i] : 255;
    } else if (depth === 8) {
      const s = y * stride + x * ch;
      if (ch >= 3) { data[t] = px[s]; data[t + 1] = px[s + 1]; data[t + 2] = px[s + 2]; data[t + 3] = ch === 4 ? px[s + 3] : 255; }
      else { data[t] = data[t + 1] = data[t + 2] = px[s]; data[t + 3] = ch === 2 ? px[s + 1] : 255; }
    } else throw new Error(`unsupported PNG (depth ${depth}, type ${ctype}): ${file}`);
  }
  return { w, h, data };
}

// ---------------------------------------------------------------------------------------------
// Target body height.

// Drawn body height in the game (mirrors profileOf() in game/js/data.js).
function profileH(p, base) {
  if (p.category === "gigantamax" && base) return Math.min(150, Math.max(110, profileH(base) * 1.5));
  return Math.min(112, Math.max(30, 58 * Math.pow(p.heightM || 1, 0.3)));
}

// PMD-equivalent body height of roster entry p, so its art pixels come out the same size on screen
// as PMD art:
//  - a form whose base species has exact PMD art (mega, gmax, regional, …): the base's PMD bodyH ×
//    (this form's drawn height / the base's drawn height), i.e. the base species' pixel density
//  - otherwise a log-log regression of PMD bodyH on real height over every exact PMD entry
// Returns { h, how, base }.
function targetHeight(p, roster, manifest, { heightOf, pixelHeight } = {}) {
  const hm = (q) => { if (q.heightM == null) q.heightM = heightOf(q); return q.heightM; };
  hm(p);
  const isPmd = (q) => { const e = manifest.pokemon[q.id]; return e && e.exact && !String(e.source || "").startsWith("gif"); };
  const plain = roster.filter((q) => q.dex === p.dex && q.id !== p.id && !/^(mega|gigantamax)$/.test(q.category) && isPmd(q));
  const prefix = plain.filter((q) => p.slug.startsWith(q.slug + "-")).sort((a, b) => b.slug.length - a.slug.length);
  const base = prefix[0] || plain[0] || null;
  if (pixelHeight) return { h: pixelHeight, how: "override", base: base && base.id };
  if (base) {
    hm(base);
    const h = manifest.pokemon[base.id].bodyH * profileH(p, base) / profileH(base);
    return { h: Math.round(Math.min(72, Math.max(12, h))), how: `base ${base.id}`, base: base.id };
  }
  // No PMD base: regress on the ordinary form's height (a Gigantamax's 20m+ is not a drawing
  // size) and grow by the same drawn-height ratio as the game does.
  const fit = regression(roster, manifest, hm, isPmd);
  const others = roster.filter((q) => q.dex === p.dex && q.id !== p.id && !/^(mega|gigantamax)$/.test(q.category));
  const root = /^(mega|gigantamax)$/.test(p.category) ? (others.filter((q) => p.slug.startsWith(q.slug + "-")).sort((a, b) => b.slug.length - a.slug.length)[0] || others[0]) : null;
  const ref = root || p;
  const h = Math.exp(fit.a + fit.b * Math.log(Math.max(0.1, hm(ref)))) * (root ? profileH(p, root) / profileH(root) : 1);
  return { h: Math.round(Math.min(64, Math.max(14, h))), how: root ? `height of ${root.id} ${root.heightM}m` : `height ${p.heightM}m`, base: null };
}

let FIT = null;
function regression(roster, manifest, hm, isPmd) {
  if (FIT) return FIT;
  const xs = [], ys = [];
  for (const q of roster) {
    if (!isPmd(q) || /^(mega|gigantamax)$/.test(q.category)) continue;
    const h = hm(q), b = manifest.pokemon[q.id].bodyH;
    if (h > 0 && b > 0) { xs.push(Math.log(h)); ys.push(Math.log(b)); }
  }
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx;
  FIT = { a: my - b * mx, b, n };
  return FIT;
}

// ---------------------------------------------------------------------------------------------
// Downscale.

// Overlap weights of target cells [i, i+1) mapped to source [o + i*inv, o + (i+1)*inv).
function axisWeights(n, o, inv, srcN) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = o + i * inv, b = a + inv, list = [];
    for (let j = Math.max(0, Math.floor(a)); j < Math.min(srcN, Math.ceil(b)); j++) {
      const w = Math.min(b, j + 1) - Math.max(a, j);
      if (w > 1e-6) list.push(j, w);
    }
    out.push(list);
  }
  return out;
}

// One GIF → { W, H, frames: [{ cov: Float32Array, idx: Int16Array, delay }] } at scale s.
// Each target pixel takes the palette colour that covers most of its source area (a weighted
// mode, so flat regions stay flat instead of averaging into mud); the source's own thin dark
// strokes count for `lineWeight` of their area so they only win where they are dense. The grid is
// anchored at the GIF's feet line and horizontal centre so static parts line up between frames.
function downscale(gif, s, indexOf, labOf, n, lineWeight) {
  let x0 = gif.W, y0 = gif.H, x1 = -1, y1 = -1;
  for (const f of gif.frames) for (let y = 0; y < gif.H; y++) for (let x = 0; x < gif.W; x++) {
    if (f.data[(y * gif.W + x) * 4 + 3] < 16) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
  const inv = 1 / s;
  const W = 2 * Math.ceil((x1 - x0 + 1) * s / 2) + 4, H = Math.ceil((y1 - y0 + 1) * s) + 3;
  const cx = (x0 + x1 + 1) / 2, feet = y1 + 1;
  const wx = axisWeights(W, cx - (W / 2) * inv, inv, gif.W), wy = axisWeights(H, feet - (H - 1) * inv, inv, gif.H);
  const area = inv * inv, SW = gif.W, SH = gif.H;
  const sIdx = new Int16Array(SW * SH), sL = new Float32Array(SW * SH), sw = new Float32Array(SW * SH), st = new Uint8Array(SW * SH);
  const acc = new Float64Array(n);
  const frames = gif.frames.map((f) => {
    // Source pixels → palette index, lightness, and stroke weight.
    for (let i = 0; i < SW * SH; i++) {
      if (f.data[i * 4 + 3] < 16) { sIdx[i] = -1; continue; }
      const key = (f.data[i * 4] << 16) | (f.data[i * 4 + 1] << 8) | f.data[i * 4 + 2];
      sIdx[i] = indexOf(key); sL[i] = labOf(key)[0];
    }
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      if (sIdx[i] < 0) continue;
      let m = 0, c = 0;
      for (const [dx, dy] of N8) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= SW || yy >= SH || sIdx[yy * SW + xx] < 0) continue;
        m += sL[yy * SW + xx]; c++;
      }
      st[i] = c && sL[i] < m / c - 0.12 ? 1 : 0;
      sw[i] = st[i] ? lineWeight : 1;
    }
    const cov = new Float32Array(W * H), idx = new Int16Array(W * H).fill(-1), line = new Uint8Array(W * H);
    for (let Y = 0; Y < H; Y++) {
      const ly = wy[Y];
      for (let X = 0; X < W; X++) {
        const lx = wx[X];
        let A = 0, S = 0;
        acc.fill(0);
        for (let p = 0; p < ly.length; p += 2) {
          const row = ly[p] * SW;
          for (let q = 0; q < lx.length; q += 2) {
            const i = row + lx[q];
            if (sIdx[i] < 0) continue;
            const w = ly[p + 1] * lx[q + 1];
            A += w; acc[sIdx[i]] += w * sw[i];
            if (st[i]) S += w;
          }
        }
        const k = Y * W + X;
        cov[k] = A / area;
        line[k] = A > 0 ? Math.round(255 * S / A) : 0;
        if (A > 0) { let bj = 0; for (let j = 1; j < n; j++) if (acc[j] > acc[bj]) bj = j; idx[k] = bj; }
      }
    }
    return { cov, idx, line, delay: f.delay };
  });
  return { W, H, frames };
}

// Opaque mask from coverage: threshold, plus ridge pixels of thin features.
function maskOf(cov, W, H, thr, low) {
  const m = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) if (cov[k] >= thr) m[k] = 1;
  const c = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cov[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = cov[y * W + x];
    if (m[y * W + x] || v < low) continue;
    // Local maximum across one axis = the ridge of a feature thinner than a target pixel.
    if ((v >= c(x - 1, y) && v >= c(x + 1, y)) || (v >= c(x, y - 1) && v >= c(x, y + 1))) m[y * W + x] = 2;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Palette.

// Weighted k-means in OKLab on a binned histogram. Deterministic: greedy weighted farthest-point
// seeding (count^0.35 × distance², so small but distinct colours such as eyes get a centre).
function kmeans(points, k) {
  if (points.length <= k) return points.map((p) => p.c.slice());
  const centers = [points.reduce((a, b) => (b.w > a.w ? b : a)).c.slice()];
  const dmin = points.map((p) => dist2(p.c, centers[0]));
  while (centers.length < k) {
    let best = -1, bi = 0;
    points.forEach((p, i) => { const v = Math.pow(p.w, 0.35) * dmin[i]; if (v > best) { best = v; bi = i; } });
    if (best <= 1e-6) break;
    centers.push(points[bi].c.slice());
    points.forEach((p, i) => { dmin[i] = Math.min(dmin[i], dist2(p.c, centers[centers.length - 1])); });
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < 24; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      let bd = Infinity, bj = 0;
      for (let j = 0; j < centers.length; j++) { const d = dist2(p.c, centers[j]); if (d < bd) { bd = d; bj = j; } }
      assign[i] = bj;
      const a = acc[bj]; a[0] += p.c[0] * p.w; a[1] += p.c[1] * p.w; a[2] += p.c[2] * p.w; a[3] += p.w;
    });
    let moved = 0;
    acc.forEach((a, j) => {
      if (!a[3]) return;
      const c = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      moved = Math.max(moved, dist2(c, centers[j]));
      centers[j] = c;
    });
    if (moved < 1e-7) break;
  }
  return centers;
}

// Colours of a PMD sheet (pokeAnim/<id>/Idle.png) with pixel counts, for paletteFrom.
function pmdColours(id, root) {
  const file = path.join(root, "pokeAnim", id, "Idle.png");
  if (!fs.existsSync(file)) return null;
  const img = decodePng(file);
  const m = new Map();
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.data[i * 4 + 3] < 128) continue;
    const key = (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2];
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].filter(([, n]) => n >= 4).map(([key]) => rgbToOklab(key >> 16, (key >> 8) & 255, key & 255));
}

// Dark outline shade of a colour: PMD outlines are a much darker, slightly desaturated version of
// the colour they enclose (near-black on dark bodies).
function shadeOf(c, mode) {
  if (mode === "black") return [0, 0, 0];
  const L = Math.min(0.3, Math.max(0.15, c[0] * 0.38));
  return [L, c[1] * 0.6, c[2] * 0.6];
}

// ---------------------------------------------------------------------------------------------
// Main entry.

// gifs: { key: { W, H, frames: [{ data: RGBA, delay }] } } (all GIFs of one entry). Returns the
// converted GIFs in the same shape (alpha 0/255) plus { palette, outlines } as [r, g, b] lists.
function pixelizeGifs(gifs, s, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const keys = Object.keys(gifs);

  // Palette from the source colours of every frame of every GIF (pure colours, not blends).
  const hist = new Map();
  for (const k of keys) for (const f of gifs[k].frames) for (let i = 0; i < f.data.length; i += 4) {
    if (f.data[i + 3] < 16) continue;
    const key = (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2];
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const labs = new Map();
  for (const key of hist.keys()) labs.set(key, rgbToOklab(key >> 16, (key >> 8) & 255, key & 255));
  const bins = new Map();
  for (const [key, w] of hist) {
    const c = labs.get(key), bk = `${Math.round(c[0] * 60)},${Math.round(c[1] * 60)},${Math.round(c[2] * 60)}`;
    const b = bins.get(bk);
    if (b) { b.w += w; b.s[0] += c[0] * w; b.s[1] += c[1] * w; b.s[2] += c[2] * w; } else bins.set(bk, { w, s: [c[0] * w, c[1] * w, c[2] * w] });
  }
  const points = [...bins.values()].map((b) => ({ w: b.w, c: [b.s[0] / b.w, b.s[1] / b.w, b.s[2] / b.w] }));
  let pal = kmeans(points, o.colors);
  if (o.paletteFrom && o.paletteFrom.length) {
    // Snap palette colours that are already close to one of the PMD sheet's colours onto it.
    pal = pal.map((c) => {
      let bd = Infinity, best = null;
      for (const q of o.paletteFrom) { const d = dist2(c, q); if (d < bd) { bd = d; best = q; } }
      return best && Math.sqrt(bd) < o.paletteRadius ? best.slice() : c;
    });
  }
  // Large near-black areas (dark bodies) are lifted to a dark grey so the black outline and inner
  // lines still read against them, as PMD does (e.g. Mega Charizard X's body is 63-79 grey).
  {
    const share = pal.map(() => 0);
    let tot = 0;
    for (const p of points) {
      let bd = Infinity, bj = 0;
      pal.forEach((c, j) => { const d = dist2(p.c, c); if (d < bd) { bd = d; bj = j; } });
      share[bj] += p.w; tot += p.w;
    }
    pal = pal.map((c, j) => (share[j] / tot >= o.darkLiftShare && c[0] < o.darkLift ? [o.darkLift, c[1], c[2]] : c));
  }
  // Merge duplicates, sort by lightness.
  pal = pal.filter((c, i) => pal.findIndex((q) => dist2(q, c) < 1e-6) === i).sort((a, b) => a[0] - b[0]);
  const n = pal.length;
  const nearest = new Map();
  const indexOf = (key) => {
    let v = nearest.get(key);
    if (v === undefined) {
      const c = labs.get(key);
      let bd = Infinity;
      for (let j = 0; j < n; j++) { const d = dist2(c, pal[j]); if (d < bd) { bd = d; v = j; } }
      nearest.set(key, v);
    }
    return v;
  };
  const shades = pal.map((c) => shadeOf(c, o.outline));
  const all = pal.concat(shades); // indices n.. are outline shades
  const rgb = all.map(oklabToRgb);
  const contrast = (i, j) => Math.sqrt(dist2(all[i], all[j]));

  const out = {};
  for (const k of keys) {
    const g = downscale(gifs[k], s, indexOf, (key) => labs.get(key), n, o.lineWeight), W = g.W, H = g.H;
    out[k] = {
      W, H,
      frames: g.frames.map((f) => {
        const mask = maskOf(f.cov, W, H, o.alphaThreshold, o.thinThreshold);
        const idx = f.idx;
        for (let i = 0; i < W * H; i++) if (!mask[i]) idx[i] = -1;
        // Pixels mostly covered by the source's own dark strokes become inner lines (outline shade).
        if (o.innerLines && o.outline !== "none") {
          const thr = Math.round(255 * o.innerLines);
          for (let i = 0; i < W * H; i++) if (idx[i] >= 0 && f.line[i] >= thr) idx[i] += n;
          strayLines(idx, W, H, n, f.line);
        }
        cleanup(idx, W, H, contrast, o);
        if (o.outline !== "none") outline(idx, W, H, n, contrast, o);
        const data = new Uint8Array(W * H * 4);
        for (let i = 0; i < W * H; i++) {
          if (idx[i] < 0) continue;
          const c = rgb[idx[i]];
          data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255;
        }
        return { data, delay: f.delay };
      }),
    };
  }
  const used = new Set();
  for (const g of Object.values(out)) for (const f of g.frames) for (let i = 0; i < f.data.length; i += 4) if (f.data[i + 3]) used.add((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]);
  const keyOf = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
  return {
    gifs: out,
    palette: rgb.slice(0, n).filter((c) => used.has(keyOf(c))),
    outlines: [...new Set(rgb.slice(n).filter((c) => used.has(keyOf(c))).map(keyOf))].map((v) => [v >> 16, (v >> 8) & 255, v & 255]),
  };
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Size of the same-index 4-connected cluster at i, stopping once it exceeds `cap`.
function clusterSize(idx, W, H, i, cap) {
  const v = idx[i], seen = new Set([i]), stack = [i];
  while (stack.length && seen.size <= cap) {
    const j = stack.pop(), x = j % W, y = (j - x) / W;
    for (const [dx, dy] of N4) {
      const xx = x + dx, yy = y + dy, t = yy * W + xx;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || seen.has(t) || idx[t] !== v) continue;
      seen.add(t); stack.push(t);
    }
  }
  return seen.size;
}

// Most common opaque index among the 8 neighbours (ties → lower contrast to `self`).
function neighbourMode(idx, W, H, x, y, contrast, self, skip = null) {
  const cnt = new Map();
  for (const [dx, dy] of N8) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const v = idx[yy * W + xx];
    if (v < 0 || (skip && skip(yy * W + xx))) continue;
    cnt.set(v, (cnt.get(v) || 0) + 1);
  }
  let best = -1, bn = 0;
  for (const [v, c] of cnt) if (c > bn || (c === bn && self >= 0 && contrast(v, self) < contrast(best, self))) { best = v; bn = c; }
  return { v: best, n: bn };
}

function cleanup(idx, W, H, contrast, o) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : idx[y * W + x]);
  // Orphan opaque pixels (no opaque 8-neighbour) and 1px holes (all 4 neighbours opaque).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (idx[i] >= 0) {
      if (N8.every(([dx, dy]) => at(x + dx, y + dy) < 0)) idx[i] = -1;
    } else if (N4.every(([dx, dy]) => at(x + dx, y + dy) >= 0)) {
      idx[i] = neighbourMode(idx, W, H, x, y, contrast, -1).v;
    }
  }
  // Specks: a cluster of up to speckSize px whose colour is close to its surroundings joins them (shading noise);
  // a high-contrast one (eye, highlight, gem) stays.
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, v = idx[i];
      if (v < 0 || clusterSize(idx, W, H, i, o.speckSize) > o.speckSize) continue;
      const m = neighbourMode(idx, W, H, x, y, contrast, v, (t) => idx[t] === v);
      if (m.v >= 0 && m.n >= 3 && contrast(v, m.v) < o.speckContrast) idx[i] = m.v;
    }
  }
}

// Inner-line pixels with no other line pixel around them are noise, unless the source was mostly
// stroke there (pupils, small dark marks).
function strayLines(idx, W, H, n, line) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (idx[i] < n || line[i] >= 150) continue;
    let near = false;
    for (const [dx, dy] of N8) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && idx[yy * W + xx] >= n) { near = true; break; }
    }
    if (!near) idx[i] -= n;
  }
}

// Silhouette outline (and optional inner contour) in the outline shades (index + n).
function outline(idx, W, H, n, contrast, o) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : idx[y * W + x]);
  const edge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (idx[y * W + x] >= 0 && N4.some(([dx, dy]) => at(x + dx, y + dy) < 0)) edge[y * W + x] = 1;
  }
  // Small high-contrast clusters (eyes) are not eaten by the outline.
  const detail = (x, y) => {
    const i = y * W + x, v = idx[i];
    if (clusterSize(idx, W, H, i, o.keepDetail) > o.keepDetail) return false;
    const m = neighbourMode(idx, W, H, x, y, contrast, v, (t) => idx[t] === v);
    return m.v >= 0 && contrast(v, m.v) > 0.25 && N4.filter(([dx, dy]) => at(x + dx, y + dy) >= 0).length >= 3;
  };
  const set = [];
  for (let y = 0; y < H && !o.outlineOutside; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!edge[i] || detail(x, y)) continue;
    // Shade of the colour just inside the edge.
    const m = neighbourMode(idx, W, H, x, y, contrast, idx[i], (t) => edge[t]);
    const v = m.v >= 0 ? m.v : idx[i];
    set.push([i, v >= n ? v : v + n]);
  }
  if (o.outlineInner) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, v = idx[i];
      if (v < 0 || v >= n || edge[i]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const u = at(x + dx, y + dy);
        if (u < 0 || u >= n) continue;
        // The darker side of a strong colour boundary gets the line.
        if (contrast(u, v) > 0.28 && v < u && clusterSize(idx, W, H, i, o.keepDetail) > o.keepDetail) { set.push([i, v + n]); break; }
      }
    }
  }
  for (const [i, v] of set) idx[i] = v;
  if (!o.outlineOutside) return;
  // Outside: a ring around the silhouette, in the shade of the colour it touches, so thin limbs,
  // tails and eyes near the edge keep their colour.
  const ring = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (idx[y * W + x] >= 0 || !N4.some(([dx, dy]) => at(x + dx, y + dy) >= 0)) continue;
    const m = neighbourMode(idx, W, H, x, y, contrast, -1);
    ring.push([y * W + x, m.v >= n ? m.v : m.v + n]);
  }
  for (const [i, v] of ring) idx[i] = v;
}

module.exports = { pixelizeGifs, targetHeight, pmdColours, decodePng, DEFAULTS, rgbToOklab, oklabToRgb };
