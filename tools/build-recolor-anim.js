#!/usr/bin/env node
// Recoloured PMD sheets for roster forms that have no PMD art of their own (most Megas and
// Gigantamax forms). The base form's PMD sheets are copied pixel for pixel and only their colours
// change, so the art keeps PMD quality (big head, small body, full 8-direction animation); the
// silhouette stays the base form's.
//
//   node tools/build-recolor-anim.js [--only id,id]
//   node tools/build-recolor-anim.js --only id,id --review <dir>   (dry run: nothing in pokeAnim/ is written)
//
// Per-id hand tuning: tools/recolor-maps/<id>.json { "map": { "<base hex>": "<new hex>" } } overrides
// the automatic colour of those base PMD colours (hex rrggbb, as listed by --review).
//
// Per-id parts: tools/recolor-parts/<id>.json adds the form's own features (cannons, wings, manes…)
// as small pixel drawings pinned to the base sprite's PMD offset points (head / centre / hands, from
// SpriteCollab's *-Offsets.png), so they follow every frame of every animation. It can also name a
// different "base" (any PMD roster id, e.g. a pre-evolution for species without PMD art). Format:
//   { "base": "0513_pansear",              optional; overrides recolor-overrides.json
//     "grow": 6,                            optional; pads every frame by N px on all sides (room for parts)
//     "colors": { "a": "rrggbb", ... },      one char per colour; "." and " " are transparent
//     "parts": [ { "name": "cannon", "anchor": "head" | "center" | "handL" | "handR",
//                  "layer": "front" | "back",   back = only where the body is transparent
//                  "anims": ["Idle", ...],      optional; default all
//                  "dirs": { "S": { "at": [dx, dy], "px": ["..aa..", ".abba."] }, "SE": …, "E": …, "NE": …, "N": … } } ],
//     "erase": [ same shape as a part; every non-transparent char clears the body pixel there ] }
// "at" is the px grid's top-left corner relative to the anchor point. Rows missing from "dirs"
// (SW, W, NW) are mirrored from SE, E, NE (grid flipped, dx mirrored, handL/handR swapped).
// Caveat: not every PMD sheet swaps its hand labels between E and W, so a mirrored hand part can
// land on the wrong hand; most parts files spell out SW/W/NW explicitly for that reason. Changing
// the swap rule would move those parts, so re-review every recolor-parts id after touching it.
//
// Called by tools/build-anim.js after the PMD sheets are copied and before the GIF fallback, so
// these ids never reach the GIF fallback. Standalone it updates an existing pokeAnim/ in place.
// The list is tools/recolor-overrides.json { "<roster id>": "<PMD roster id>" }. Hand-made sheets
// in tools/recolor-hand/<roster id>/ are used as they are instead of the automatic recolour.
//
// Colour transfer: the base form's and the target form's pokeSprite front.gif are each reduced to
// ~8 colour clusters in OKLab. Every base cluster is paired with the target cluster that is close
// in colour and covers a similar share of the body; every PMD colour then moves by the offset of
// the pair its nearest base cluster belongs to, which keeps PMD's own shading ramps. Near-black
// outline colours are left alone.
"use strict";

const fs = require("fs");
const path = require("path");
const { decodePng, rgbToOklab, oklabToRgb } = require("./pixelize");
const { decodeGif, encodePng, writeManifest } = require("./build-gif-anim");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "pokeAnim");
const LIST = path.join(__dirname, "recolor-overrides.json");
const HAND = path.join(__dirname, "recolor-hand");
const MAPS = path.join(__dirname, "recolor-maps");
const PARTS = path.join(__dirname, "recolor-parts");
const SPRITE_DIR = path.join(ROOT, ".cache", "SpriteCollab", "sprite");
const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
const MIRROR = { SW: "SE", W: "E", NW: "NE" };
const ANCHOR_RGB = { head: [0, 0, 0], center: [0, 255, 0], handL: [255, 0, 0], handR: [0, 0, 255] };
const K = 8;              // colour clusters per GIF
const SHARE_WEIGHT = 1.0; // cost of a body-share mismatch, in OKLab distance units
const OUTLINE_L = 0.22;   // PMD colours darker than this (and nearly grey) are outlines: unchanged

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const partsOf = (id) => readJson(path.join(PARTS, `${id}.json`));

// Roster id → base PMD roster id: recolor-overrides.json, plus every recolor-parts file with a "base".
function loadList() {
  const o = JSON.parse(fs.readFileSync(LIST, "utf8"));
  const list = Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
  if (fs.existsSync(PARTS)) for (const f of fs.readdirSync(PARTS).filter((f) => f.endsWith(".json"))) {
    const j = readJson(path.join(PARTS, f));
    if (j && j.base) list[f.slice(0, -5)] = j.base;
  }
  return list;
}

// ---------------------------------------------------------------------------------------------
// PMD offset points. pts[row][frame] = { head: [x, y], center, handL, handR } (frame-local).

function offsetsFile(src, name) {
  const dir = path.join(SPRITE_DIR, src);
  const xml = fs.existsSync(path.join(dir, "AnimData.xml")) ? fs.readFileSync(path.join(dir, "AnimData.xml"), "utf8") : "";
  let cur = name;
  for (let i = 0; i < 8; i++) {
    const m = xml.match(new RegExp(`<Name>${cur}</Name>([\\s\\S]*?)</Anim>`));
    const c = m && m[1].match(/<CopyOf>\s*([^<]*?)\s*<\/CopyOf>/);
    if (!c) break;
    cur = c[1];
  }
  const f = path.join(dir, `${cur}-Offsets.png`);
  return fs.existsSync(f) ? f : null;
}

function readOffsets(src, name, a) {
  const file = offsetsFile(src, name);
  const pts = [...Array(a.rows)].map(() => [...Array(a.frames)].map(() => ({})));
  if (file) {
    const img = decodePng(file);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const t = (y * img.w + x) * 4;
      if (!img.data[t + 3]) continue;
      const r = Math.floor(y / a.fh), f = Math.floor(x / a.fw);
      if (r >= a.rows || f >= a.frames) continue;
      for (const [k, c] of Object.entries(ANCHOR_RGB))
        if (img.data[t] === c[0] && img.data[t + 1] === c[1] && img.data[t + 2] === c[2]) pts[r][f][k] = [x - f * a.fw, y - r * a.fh];
    }
  }
  // Missing points (hidden behind another marker, or no offsets file): nearest frame of the row
  // that has it, then the row's centre, then the frame centre.
  for (const row of pts) for (const k of Object.keys(ANCHOR_RGB)) for (let f = 0; f < row.length; f++) {
    if (row[f][k]) continue;
    let best = null;
    for (let d = 1; d < row.length && !best; d++) best = (row[f - d] && row[f - d][k]) || (row[f + d] && row[f + d][k]) || null;
    row[f][k] = best || row[f].center || [a.fw >> 1, a.fh >> 1];
  }
  // Compute geometric outline anchors (top, headTop) from the base sheet's black (#000000) outline
  // pixels so crown/horn/canopy parts stay locked to the actual cranium/canopy across all poses.
  const animPath = file ? file.replace(/-Offsets\.png$/, "-Anim.png") : null;
  if (animPath && fs.existsSync(animPath)) {
    const sheet = decodePng(animPath);
    for (let r = 0; r < a.rows; r++) for (let f = 0; f < a.frames; f++) {
      let minY = a.fh, maxY = 0, minX = a.fw, maxX = 0, found = false;
      for (let y = 0; y < a.fh; y++) for (let x = 0; x < a.fw; x++) {
        const i = ((r * a.fh + y) * sheet.w + f * a.fw + x) * 4;
        if (sheet.data[i + 3] > 128 && sheet.data[i] === 0 && sheet.data[i + 1] === 0 && sheet.data[i + 2] === 0) {
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          found = true;
        }
      }
      const [hx, hy] = pts[r][f].head || pts[r][f].center;
      const isHeadFill = (x, y) => {
        if (x < 0 || y < 0 || x >= a.fw || y >= a.fh) return false;
        const i = ((r * a.fh + y) * sheet.w + f * a.fw + x) * 4;
        return sheet.data[i + 3] > 128 && sheet.data[i + 1] >= 120 && sheet.data[i] - sheet.data[i + 1] <= 20;
      };
      let sx = hx, sy = Math.max(0, hy - 3), bestD = 999;
      for (let dy = -6; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (isHeadFill(hx + dx, hy + dy) && dx * dx + dy * dy < bestD) {
          bestD = dx * dx + dy * dy; sx = hx + dx; sy = hy + dy;
        }
      }
      const q = [[sx, sy]], vis = new Set([sy * a.fw + sx]);
      let wMinY = sy;
      for (let k = 0; k < q.length; k++) {
        const [cx, cy] = q[k];
        if (cy < wMinY) wMinY = cy;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = cx + dx, ny = cy + dy, key = ny * a.fw + nx;
          if (!vis.has(key) && Math.abs(nx - hx) <= 9 && ny >= hy - 13 && ny <= hy + 2 && isHeadFill(nx, ny)) {
            vis.add(key); q.push([nx, ny]);
          }
        }
      }
      const topXs = q.filter(([, y]) => y <= wMinY + 3).map(([x]) => x);
      const htx = topXs.length ? Math.round(topXs.reduce((s, v) => s + v, 0) / topXs.length) : hx;
      const hMinY = topXs.length ? Math.max(0, wMinY - 1) : hy;
      pts[r][f].headTop = [htx, hMinY];
      pts[r][f].top = found ? [Math.round((minX + maxX) / 2), minY] : pts[r][f].center;
      pts[r][f].bottom = found ? [Math.round((minX + maxX) / 2), maxY] : pts[r][f].center;
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Parts.

const hexRgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace(/^#/, "").slice(i, i + 2), 16));

// Drawing of one part for a direction: { at, px } with mirroring for SW / W / NW.
function partDir(part, dir) {
  if (part.dirs[dir]) return { anchor: part.anchor, ...part.dirs[dir] };
  const src = MIRROR[dir] && part.dirs[MIRROR[dir]];
  if (!src) return null;
  const w = Math.max(...src.px.map((r) => r.length));
  const swapHands = !part.noSwapHands;
  const anchor = swapHands && part.anchor === "handL" ? "handR" : swapHands && part.anchor === "handR" ? "handL" : part.anchor;
  return { anchor, at: [-src.at[0] - w + 1, src.at[1]], px: src.px.map((r) => r.padEnd(w, ".").split("").reverse().join("")) };
}

// Pads every frame by g px on all sides.
function growSheet(img, a, g) {
  if (!g) return img;
  const fw = a.fw + 2 * g, fh = a.fh + 2 * g;
  const out = { w: fw * a.frames, h: fh * a.rows, data: new Uint8Array(fw * a.frames * fh * a.rows * 4) };
  for (let r = 0; r < a.rows; r++) for (let f = 0; f < a.frames; f++) for (let y = 0; y < a.fh; y++) {
    const s = ((r * a.fh + y) * img.w + f * a.fw) * 4, d = ((r * fh + y + g) * out.w + f * fw + g) * 4;
    out.data.set(img.data.subarray(s, s + a.fw * 4), d);
  }
  return out;
}

// Draws the parts onto a (grown) sheet in place. a = the base anim record (ungrown sizes).
function applyParts(img, spec, a, pts, name) {
  const g = spec.grow || 0, fw = a.fw + 2 * g, fh = a.fh + 2 * g;
  // Preserve un-outlined flying sweat/recoil droplets in Hurt so added crown/head parts don't cover them.
  const fx = [];
  if (name === "Hurt") {
    const N = img.w * img.h, vis = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (vis[i] || !img.data[i * 4 + 3]) continue;
      const comp = [i]; vis[i] = 1;
      let hasBlack = false;
      for (let q = 0; q < comp.length; q++) {
        const cur = comp[q], cx = cur % img.w, cy = Math.floor(cur / img.w);
        if (img.data[cur * 4] === 0 && img.data[cur * 4 + 1] === 0 && img.data[cur * 4 + 2] === 0) hasBlack = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= img.w || ny >= img.h) continue;
          const ni = ny * img.w + nx;
          if (!vis[ni] && img.data[ni * 4 + 3]) { vis[ni] = 1; comp.push(ni); }
        }
      }
      if (!hasBlack) for (const idx of comp) fx.push([idx * 4, img.data.slice(idx * 4, idx * 4 + 4)]);
    }
  }
  const colors = Object.fromEntries(Object.entries(spec.colors || {}).map(([k, v]) => [k, hexRgb(v)]));
  const layers = [...(spec.erase || []).map((p) => ({ ...p, erase: true })), ...(spec.parts || []).filter((p) => p.layer === "back"),
    ...(spec.parts || []).filter((p) => p.layer !== "back")];
  for (const part of layers) {
    if (part.anims && !part.anims.includes(name)) continue;
    for (let r = 0; r < a.rows; r++) {
      const d = partDir(part, a.rows === 1 ? "S" : DIRS[r]);
      if (!d) continue;
      for (let f = 0; f < a.frames; f++) {
        const [ax, ay] = pts[r][f][d.anchor] || pts[r][f].center;
        // Skip empty frames (some sheets pad rows with blanks).
        d.px.forEach((row, yy) => [...row].forEach((ch, xx) => {
          if (ch === "." || ch === " ") return;
          const x = ax + g + d.at[0] + xx, y = ay + g + d.at[1] + yy;
          if (x < 0 || y < 0 || x >= fw || y >= fh) return;
          const o = ((r * fh + y) * img.w + f * fw + x) * 4;
          if (part.erase) { img.data[o + 3] = 0; return; }
          if (part.layer === "back" && img.data[o + 3]) return;
          const c = colors[ch];
          if (!c) return;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }));
      }
    }
  }
  for (const [o, rgba] of fx) img.data.set(rgba, o);
  return img;
}

// The finished sheet for one anim of a target: recolour → grow → parts.
function makeSheet(baseId, baseRec, name, map, spec) {
  const a = baseRec.anims[name];
  let img = recolourSheet(path.join(OUT, baseId, `${name}.png`), map);
  if (!spec) return img;
  img = growSheet(img, a, spec.grow || 0);
  return applyParts(img, spec, a, readOffsets(baseRec.src, name, a), name);
}

// Weighted OKLab histogram of all opaque pixels of a GIF (RGB binned to 5 bits).
function gifHistogram(file) {
  const g = decodeGif(file);
  const bins = new Map();
  for (const f of g.frames) for (let i = 0; i < g.W * g.H; i++) {
    if (f.data[i * 4 + 3] < 128) continue;
    const k = ((f.data[i * 4] >> 3) << 10) | ((f.data[i * 4 + 1] >> 3) << 5) | (f.data[i * 4 + 2] >> 3);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  return [...bins].map(([k, w]) => ({ c: rgbToOklab(((k >> 10) << 3) | 4, (((k >> 5) & 31) << 3) | 4, ((k & 31) << 3) | 4), w }));
}

// Weighted k-means → [{ c, share }] (deterministic farthest-point seeding).
function clusters(points, k) {
  const total = points.reduce((s, p) => s + p.w, 0);
  const centers = [points.reduce((a, b) => (b.w > a.w ? b : a)).c.slice()];
  const dmin = points.map((p) => dist2(p.c, centers[0]));
  while (centers.length < Math.min(k, points.length)) {
    let best = -1, bi = 0;
    points.forEach((p, i) => { const v = Math.pow(p.w, 0.35) * dmin[i]; if (v > best) { best = v; bi = i; } });
    if (best <= 1e-6) break;
    centers.push(points[bi].c.slice());
    points.forEach((p, i) => { dmin[i] = Math.min(dmin[i], dist2(p.c, centers[centers.length - 1])); });
  }
  let acc;
  for (let it = 0; it < 24; it++) {
    acc = centers.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let bd = Infinity, bj = 0;
      centers.forEach((c, j) => { const d = dist2(p.c, c); if (d < bd) { bd = d; bj = j; } });
      const a = acc[bj]; a[0] += p.c[0] * p.w; a[1] += p.c[1] * p.w; a[2] += p.c[2] * p.w; a[3] += p.w;
    }
    acc.forEach((a, j) => { if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return centers.map((c, j) => ({ c, share: acc[j][3] / total })).filter((x) => x.share > 0);
}

// Base cluster → OKLab offset toward its paired target cluster.
function pairOffsets(base, target) {
  return base.map((b) => {
    let best = Infinity, t = target[0];
    for (const c of target) {
      const cost = Math.sqrt(dist2(b.c, c.c)) + SHARE_WEIGHT * Math.abs(b.share - c.share);
      if (cost < best) { best = cost; t = c; }
    }
    return { c: b.c, d: [t.c[0] - b.c[0], t.c[1] - b.c[1], t.c[2] - b.c[2]] };
  });
}

const hexOf = (r, g, b) => [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

function manualMap(id) {
  const f = path.join(MAPS, `${id}.json`);
  if (!fs.existsSync(f)) return {};
  const m = JSON.parse(fs.readFileSync(f, "utf8")).map || {};
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase().replace(/^#/, ""), v.toLowerCase().replace(/^#/, "")]));
}

function colourMap(pairs, manual = {}) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    if (cache.has(key)) return cache.get(key);
    const c = rgbToOklab(r, g, b);
    let out = [r, g, b];
    const hand = manual[hexOf(r, g, b)];
    if (hand) out = [0, 2, 4].map((i) => parseInt(hand.slice(i, i + 2), 16));
    else if (!(c[0] < OUTLINE_L && Math.hypot(c[1], c[2]) < 0.05)) {
      let bd = Infinity, p = pairs[0];
      for (const q of pairs) { const d = dist2(c, q.c); if (d < bd) { bd = d; p = q; } }
      out = oklabToRgb([Math.min(1, Math.max(0, c[0] + p.d[0])), c[1] + p.d[1], c[2] + p.d[2]])
        .map((v) => Math.max(0, Math.min(255, Math.round(v))));
    }
    cache.set(key, out);
    return out;
  };
}

function recolourSheet(file, map) {
  const img = decodePng(file);
  const d = img.data;
  for (let i = 0; i < img.w * img.h; i++) {
    if (!d[i * 4 + 3]) continue;
    const [r, g, b] = map(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
  }
  return img;
}

const gifOf = (p) => path.join(ROOT, p.sprite.replace(/^\.\.\//, ""));
const mapFor = (p, bp) => colourMap(pairOffsets(clusters(gifHistogram(gifOf(bp)), K), clusters(gifHistogram(gifOf(p)), K)), manualMap(p.id));

// Writes pokeAnim/<id>/ and the manifest record for every listed id. Returns credit rows.
function build({ manifest, roster, only = null, log = console.log }) {
  const list = loadList();
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  const done = [];
  for (const [id, baseId] of Object.entries(list)) {
    if (only && !only.includes(id)) continue;
    // Hand-drawn key sprites (tools/build-hand-anim.js) take over these ids.
    if (fs.existsSync(path.join(__dirname, "hand-sprites", `${id}.json`))) continue;
    const p = byId[id], bp = byId[baseId], baseRec = manifest.pokemon[baseId];
    if (!p || !bp) { log(`  ${id}: unknown roster id (${baseId}), skipped`); continue; }
    if (!baseRec || baseRec.source) { log(`  ${id}: base ${baseId} has no PMD sheets, skipped`); continue; }
    const outDir = path.join(OUT, id);
    const hand = path.join(HAND, id);
    const useHand = fs.existsSync(hand);
    let map = null;
    const spec = useHand ? null : partsOf(id);
    if (!useHand) {
      if (!fs.existsSync(gifOf(p)) || !fs.existsSync(gifOf(bp))) { log(`  ${id}: missing front.gif, skipped`); continue; }
      map = mapFor(p, bp);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const rec = JSON.parse(JSON.stringify(baseRec));
    rec.src = `recolor/${baseId}`;
    rec.source = useHand ? "recolor-hand" : spec ? "recolor-parts" : "recolor";
    for (const [name, a] of Object.entries(rec.anims)) {
      const dst = path.join(outDir, `${name}.png`);
      if (useHand && fs.existsSync(path.join(hand, `${name}.png`))) fs.copyFileSync(path.join(hand, `${name}.png`), dst);
      else if (useHand) { delete rec.anims[name]; continue; }
      else {
        fs.writeFileSync(dst, encodePng(makeSheet(baseId, baseRec, name, map, spec)));
        if (spec && spec.grow) { a.fw += 2 * spec.grow; a.fh += 2 * spec.grow; a.anchorY += spec.grow; }
      }
      // ?v= content hash: these paths used to hold the GIF-derived sheets, so browsers may have them cached.
      const v = require("crypto").createHash("md5").update(fs.readFileSync(dst)).digest("hex").slice(0, 8);
      a.file = `../pokeAnim/${id}/${name}.png?v=${v}`;
    }
    manifest.pokemon[id] = rec;
    done.push({ id, name: p.name, base: baseId, hand: useHand, parts: !!spec });
  }
  return done;
}

// Dry run for hand tuning (nothing in pokeAnim/ is written). <dir>/<id>.png, all at 3x:
//   row 1: Idle frame 0 in all 8 directions (S SE E NE N NW W SW), finished sheet
//   row 2: the same with the anchor points marked (head green, center magenta, handL red, handR blue)
//   row 3: Walk frame 1, Attack hit frame, Shoot hit frame, Hurt frame 0, Charge frame 4 (S and E rows)
//   <dir>/<id>-gif.png: the target form's front.gif and back.gif (pokeSprite, 2x), the reference
// Also prints Idle frame-0 anchor coordinates per direction and the palette (base hex → recoloured
// hex, pixel count) for tools/recolor-maps/<id>.json.
function review({ manifest, roster, only, dir, log = console.log }) {
  const { newImg } = require("./build-gif-anim");
  const list = loadList();
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  fs.mkdirSync(dir, { recursive: true });
  for (const id of only) {
    const baseId = list[id], p = byId[id], bp = byId[baseId], rec = baseId && manifest.pokemon[baseId];
    if (!rec || rec.source) { log(`${id}: no base in recolor-overrides.json / recolor-parts, or base ${baseId} has no PMD sheets`); continue; }
    const map = mapFor(p, bp), spec = partsOf(id), g = (spec && spec.grow) || 0;
    const S = 3, idle = rec.anims.Idle;
    const fwI = idle.fw + 2 * g, fhI = idle.fh + 2 * g;
    const gifDir = path.dirname(gifOf(p));
    const gifs = ["front.gif", "back.gif"].filter((f) => fs.existsSync(path.join(gifDir, f))).map((f) => decodeGif(path.join(gifDir, f)));
    const extra = ["Walk", "Attack", "Shoot", "Hurt", "Charge"].filter((n) => rec.anims[n]);
    const cellW = Math.max(fwI, ...extra.map((n) => rec.anims[n].fw + 2 * g)) * S;
    const leftW = Math.max(8 * fwI * S, extra.length * 2 * cellW) + 16;
    const row3H = Math.max(...extra.map((n) => rec.anims[n].fh + 2 * g)) * S;
    const W = leftW, H = fhI * S * 2 + row3H + 24;
    let out = newImg(W, H);
    for (let i = 0; i < out.w * out.h; i++) { out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 190; out.data[i * 4 + 3] = 255; }
    const dot = (X, Y, c) => { if (X >= 0 && Y >= 0 && X < out.w && Y < out.h) out.data.set([...c, 255], (Y * out.w + X) * 4); };
    const put = (img, sx, sy, w, h, dx, dy, s) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = ((sy + y) * img.w + sx + x) * 4;
        if (sx + x >= img.w || sy + y >= img.h || !img.data[t + 3]) continue;
        for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) dot(dx + x * s + xx, dy + y * s + yy, [img.data[t], img.data[t + 1], img.data[t + 2]]);
      }
    };
    const sheet = (n) => makeSheet(baseId, rec, n, map, spec);
    const idleImg = sheet("Idle"), idlePts = readOffsets(rec.src, "Idle", idle);
    const MARK = { head: [0, 230, 0], center: [255, 0, 255], handL: [255, 0, 0], handR: [0, 0, 255] };
    const rows = idle.rows === 1 ? [0] : [0, 1, 2, 3, 4, 5, 6, 7];
    log(`${id} (from ${baseId}${g ? `, grow ${g}` : ""}) → ${path.join(dir, id + ".png")} + ${id}-gif.png`);
    log("  Idle frame 0 anchors (frame-local, before grow) [x,y]:");
    rows.forEach((r, k) => {
      put(idleImg, 0, r * fhI, fwI, fhI, k * fwI * S, 0, S);
      put(idleImg, 0, r * fhI, fwI, fhI, k * fwI * S, fhI * S + 8, S);
      const pt = idlePts[r][0];
      for (const [name, c] of Object.entries(MARK)) {
        const [x, y] = pt[name];
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) dot(k * fwI * S + (x + g) * S + xx, fhI * S + 8 + (y + g) * S + yy, c);
      }
      log(`    ${DIRS[r].padEnd(2)} ` + Object.keys(MARK).map((n) => `${n} ${pt[n].join(",")}`).join("  "));
    });
    let x0 = 0;
    for (const n of extra) {
      const a = rec.anims[n], img = sheet(n), fw = a.fw + 2 * g, fh = a.fh + 2 * g;
      const fi = n === "Walk" ? 1 : n === "Hurt" ? 0 : n === "Charge" ? Math.min(4, a.frames - 1) : Math.min(a.hit ?? 0, a.frames - 1);
      for (const r of a.rows === 1 ? [0] : [0, 2]) { put(img, fi * fw, r * fh, fw, fh, x0, fhI * S * 2 + 16, S); x0 += cellW; }
    }
    fs.writeFileSync(path.join(dir, `${id}.png`), encodePng(out));
    out = newImg(gifs.reduce((s, q) => s + q.W * 2 + 8, 8), Math.max(8, ...gifs.map((q) => q.H * 2 + 8)));
    for (let i = 0; i < out.w * out.h; i++) { out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 190; out.data[i * 4 + 3] = 255; }
    let gx = 0;
    for (const q of gifs) { put({ w: q.W, h: q.H, data: q.frames[0].data }, 0, 0, q.W, q.H, gx, 0, 2); gx += q.W * 2 + 8; }
    fs.writeFileSync(path.join(dir, `${id}-gif.png`), encodePng(out));
    const baseIdle = decodePng(path.join(OUT, baseId, "Idle.png"));
    const counts = new Map();
    for (let i = 0; i < baseIdle.w * baseIdle.h; i++) {
      if (!baseIdle.data[i * 4 + 3]) continue;
      const k = hexOf(baseIdle.data[i * 4], baseIdle.data[i * 4 + 1], baseIdle.data[i * 4 + 2]);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    log(`  frame ${idle.fw}x${idle.fh}${g ? ` (grown ${fwI}x${fhI})` : ""}, feet at y=${idle.anchorY}. Palette (base → now):`);
    for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      const c = map(...[0, 2, 4].map((i) => parseInt(k.slice(i, i + 2), 16)));
      log(`  ${k} → ${hexOf(...c)}  ${n}px`);
    }
  }
}

function creditLines(list) {
  if (!list.length) return [];
  const lines = [
    "",
    "## Recoloured PMD sheets",
    "",
    "These forms have no PMD art of their own. Their sheets are the listed base form's SpriteCollab sheets",
    "(same artists and CC BY-NC 4.0 licence as above) with the colours changed to the form's colours",
    "by tools/build-recolor-anim.js, or recoloured by hand where marked.",
    "",
    "| Roster id | Pokémon | Recoloured from |",
    "|---|---|---|",
  ];
  for (const c of list) lines.push(`| ${c.id} | ${c.name} | ${c.base}${c.hand ? " (by hand)" : c.parts ? " (with hand-drawn parts)" : ""} |`);
  return lines;
}

module.exports = { build, review, creditLines, loadList, readOffsets, makeSheet, gifHistogram, clusters, pairOffsets, colourMap, recolourSheet, gifOf, K, growSheet, applyParts, manualMap, partsOf };

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const only = arg("--only") ? arg("--only").split(",") : null;
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon;
  if (arg("--review")) {
    if (!only) { console.error("--review needs --only"); process.exit(1); }
    review({ manifest, roster, only, dir: path.resolve(arg("--review")) });
    process.exit(0);
  }
  const done = build({ manifest, roster, only });
  writeManifest(manifest);
  console.log(`recoloured ${done.length} entries (${done.filter((d) => d.hand).length} by hand)`);
}
