#!/usr/bin/env node
// PMD-quality sheets for a form that SpriteCollab has no art for (most Megas): the base species'
// real SpriteCollab sheets (1x, from .cache/SpriteCollab/sprite/<dex>/) recoloured to the form's
// pokeSprite palette, with the form's own features drawn on as pixel parts pinned to the PMD
// offset points (tools/recolor-parts/<id>.json, same format as build-recolor-anim.js), then ×2
// into the current gen-folder pokeAnim layout. Full 8-direction PMD animation is kept.
//
//   node tools/build-mega-parts.js --id 0003_venusaur-mega --base 0003_venusaur --sc 0003            review only
//   node tools/build-mega-parts.js --id 0003_venusaur-mega --base 0003_venusaur --sc 0003 --install  write pokeAnim + manifest
//
// --sc is the SpriteCollab folder under .cache/SpriteCollab/sprite/ (download it from
// github.com/PMDCollab/SpriteCollab if missing). Review images go to 確認用画像/pmd_claude/<id>/.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Recolor = require("./build-recolor-anim");
const Gif = require("./build-gif-anim");
const { decodePng } = require("./pixelize");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "pokeAnim");
const SC = path.join(ROOT, ".cache", "SpriteCollab", "sprite");
const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
const ANIM_ORDER = ["Idle", "Walk", "Attack", "Shoot", "SpAttack", "Charge", "Strike", "Hurt", "Faint"];

function readAnimData(dir) {
  const xml = fs.readFileSync(path.join(dir, "AnimData.xml"), "utf8");
  const tag = (s, n) => { const m = s.match(new RegExp(`<${n}>\\s*([^<]*?)\\s*</${n}>`)); return m ? m[1] : null; };
  const num = (s, n) => { const v = tag(s, n); return v == null ? null : Number(v); };
  const anims = {};
  for (const m of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const s = m[1], name = tag(s, "Name");
    if (name) anims[name] = { copyOf: tag(s, "CopyOf"), fw: num(s, "FrameWidth"), fh: num(s, "FrameHeight"), rush: num(s, "RushFrame"), hit: num(s, "HitFrame"), ret: num(s, "ReturnFrame"), durations: [...s.matchAll(/<Duration>\s*(\d+)\s*<\/Duration>/g)].map((d) => Number(d[1])) };
  }
  return { shadowSize: num(xml, "ShadowSize") ?? 1, anims };
}

const FALLBACK_ANIMS = {
  SpAttack: ["SpAttack", "Hover", "Shoot"],
  Strike: ["Strike", "Punch", "Attack"],
};

function resolveAnim(dir, data, name) {
  const candidates = FALLBACK_ANIMS[name] || [name];
  for (const cand of candidates) {
    let cur = cand;
    for (let i = 0; i < 8 && data.anims[cur]; i++) {
      const a = data.anims[cur];
      if (a.copyOf) { cur = a.copyOf; continue; }
      const file = path.join(dir, `${cur}-Anim.png`);
      if (!a.fw || !a.fh || !a.durations.length || !fs.existsSync(file)) break;
      return { ...a, name: cur, file };
    }
  }
  return null;
}

function scaleN(img, n) {
  const out = Gif.newImg(img.w * n, img.h * n);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const s = (Math.floor(y / n) * img.w + Math.floor(x / n)) * 4, t = (y * out.w + x) * 4;
    out.data[t] = img.data[s]; out.data[t + 1] = img.data[s + 1]; out.data[t + 2] = img.data[s + 2]; out.data[t + 3] = img.data[s + 3];
  }
  return out;
}

function measure(img, fw, fh) {
  const frames = Math.floor(img.w / fw);
  let bodyH = 0, bodyW = 0, bottom = 0;
  for (let f = 0; f < frames; f++) {
    let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      if (img.data[((y) * img.w + f * fw + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) continue;
    bodyH = Math.max(bodyH, y1 - y0 + 1); bodyW = Math.max(bodyW, x1 - x0 + 1); bottom = Math.max(bottom, y1 + 1);
  }
  return { bodyH, bodyW, anchorY: bottom || fh };
}

function build({ id, baseId, sc, ...opts }) {
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon;
  const p = roster.find((q) => q.id === id), bp = roster.find((q) => q.id === baseId);
  if (!p || !bp) throw new Error(`unknown roster id ${!p ? id : baseId}`);
  const dir = path.join(SC, sc);
  if (!fs.existsSync(path.join(dir, "AnimData.xml"))) throw new Error(`no SpriteCollab folder ${dir}`);
  const data = readAnimData(dir);
  const map = Recolor.colourMap(Recolor.pairOffsets(Recolor.clusters(Recolor.gifHistogram(Recolor.gifOf(bp)), Recolor.K), Recolor.clusters(Recolor.gifHistogram(Recolor.gifOf(p)), Recolor.K)), Recolor.manualMap(id));
  const spec = Recolor.partsOf(id);
  const g = (spec && spec.grow) || 0;
  const src = path.dirname(p.sprite.replace(/^\.\.\/pokeSprite\//, ""));
  // Sheet scale: the base's pokeAnim sheets are an integer multiple of the SpriteCollab art (2x or 3x
  // depending on the species); the form uses the same so it is drawn at the base's size.
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const baseRec = manifest.pokemon[baseId], scIdle = resolveAnim(dir, data, "Idle");
  const n = opts.scale || 2;
  const sheets = {}, anims = {}, raw = {};
  for (const name of ANIM_ORDER) {
    const a = resolveAnim(dir, data, name);
    if (!a) continue;
    let img = Recolor.recolourSheet(a.file, map);
    const rows = Math.floor(img.h / a.fh), frames = Math.floor(img.w / a.fw);
    const rec = { fw: a.fw, fh: a.fh, rows, frames };
    if (spec) img = Recolor.applyParts(Recolor.growSheet(img, rec, g), spec, rec, Recolor.readOffsets(sc, a.name, rec), name);
    raw[name] = { img, fw: a.fw + 2 * g, fh: a.fh + 2 * g, rows, frames, pts: Recolor.readOffsets(sc, a.name, rec) };
    const big = scaleN(img, n);
    sheets[name] = big;
    const m = measure(big, (a.fw + 2 * g) * n, (a.fh + 2 * g) * n);
    anims[name] = { file: `../pokeAnim/${src}/${name}.png`, fw: (a.fw + 2 * g) * n, fh: (a.fh + 2 * g) * n, frames, rows, durations: a.durations, hit: a.hit, rush: a.rush, ret: a.ret, anchorY: m.anchorY };
  }
  if (!anims.Idle) throw new Error("base has no Idle");
  const mi = measure(sheets.Idle, anims.Idle.fw, anims.Idle.fh);
  const rec = { src, exact: true, source: "recolor-parts", base: baseId, sc, scale: n, shadowSize: data.shadowSize, bodyH: mi.bodyH, bodyW: mi.bodyW, anims };
  // Base palette (hex → recoloured hex, pixel count) for tools/recolor-maps/<id>.json, from the 1x Idle.
  const baseIdle = decodePng(scIdle.file), counts = new Map();
  for (let i = 0; i < baseIdle.w * baseIdle.h; i++) {
    if (!baseIdle.data[i * 4 + 3]) continue;
    const k = [0, 1, 2].map((c) => baseIdle.data[i * 4 + c].toString(16).padStart(2, "0")).join("");
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const palette = [...counts].sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, map(...[0, 2, 4].map((i) => parseInt(k.slice(i, i + 2), 16))).map((v) => v.toString(16).padStart(2, "0")).join(""), c]);
  return { p, src, rec, sheets, raw, g, n, palette };
}

// Review: Idle frame 0 in 8 facings (with anchor marks on a second row), then S + E rows of the
// main actions; the form's pokeSprite front/back on the right as the reference.
function review(r) {
  const S = 3, gap = 6;
  const idle = r.raw.Idle;
  const MARK = { head: [0, 230, 0], center: [255, 0, 255], handL: [255, 0, 0], handR: [0, 0, 255] };
  const acts = ["Walk", "Attack", "Shoot", "SpAttack", "Strike", "Charge", "Hurt"].filter((n) => r.raw[n]);
  const cellW = Math.max(idle.fw, ...acts.map((n) => r.raw[n].fw)) * S + gap, cellH = Math.max(idle.fh, ...acts.map((n) => r.raw[n].fh)) * S + gap;
  const gifDir = path.dirname(Recolor.gifOf(r.p));
  const refs = ["front.png", "back.png"].filter((f) => fs.existsSync(path.join(gifDir, f))).map((f) => decodePng(path.join(gifDir, f)));
  const W = Math.max(8 * (idle.fw * S + gap), acts.length * 2 * cellW) + gap + refs.reduce((s, q) => s + q.w * 2 + gap, gap);
  const H = 2 * (idle.fh * S + gap + 14) + cellH + 14 + gap;
  const out = Gif.newImg(W, H);
  Gif.fill(out, 0, 0, W, H, [190, 190, 190]);
  const dot = (X, Y, c) => { if (X >= 0 && Y >= 0 && X < out.w && Y < out.h) out.data.set([c[0], c[1], c[2], 255], (Y * out.w + X) * 4); };
  let y = gap;
  Gif.text(out, gap, y, `${r.p.id}  Idle 8 facings (S SE E NE N NW W SW)`, [0, 0, 0]); y += 14;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < idle.rows; k++) {
      Gif.blitScaled(out, idle.img, 0, k * idle.fh, idle.fw, idle.fh, gap + k * (idle.fw * S + gap), y, S);
      if (pass === 1) for (const [n, c] of Object.entries(MARK)) {
        const pt = idle.pts[k][0][n]; if (!pt) continue;
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) dot(gap + k * (idle.fw * S + gap) + (pt[0] + r.g) * S + xx, y + (pt[1] + r.g) * S + yy, c);
      }
    }
    y += idle.fh * S + gap + (pass === 0 ? 14 : 0);
    if (pass === 0) Gif.text(out, gap, y - 12, "anchors: head green, center magenta, handL red, handR blue", [0, 0, 0]);
  }
  Gif.text(out, gap, y, acts.map((n) => `${n}(S,E)`).join("  "), [0, 0, 0]); y += 14;
  let x = gap;
  for (const n of acts) {
    const a = r.raw[n], rec = r.rec.anims[n];
    const fi = n === "Walk" ? 1 : n === "Hurt" ? 0 : n === "Charge" ? Math.min(4, a.frames - 1) : Math.min(rec.hit ?? 0, a.frames - 1);
    for (const row of a.rows === 1 ? [0, 0] : [0, 2]) { Gif.blitScaled(out, a.img, fi * a.fw, row * a.fh, a.fw, a.fh, x, y, S); x += cellW; }
  }
  let rx = W - refs.reduce((s, q) => s + q.w * 2 + gap, 0);
  for (const q of refs) { Gif.blitScaled(out, q, 0, 0, q.w, q.h, rx, gap + 14, 2); rx += q.w * 2 + gap; }
  return out;
}

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const id = arg("--id"), baseId = arg("--base"), sc = arg("--sc");
  if (!id || !baseId || !sc) { console.error("usage: node tools/build-mega-parts.js --id <id> --base <base id> --sc <SpriteCollab folder> [--review dir] [--install]"); process.exit(1); }
  const r = build({ id, baseId, sc, scale: arg("--scale") ? +arg("--scale") : undefined });
  const dirOut = path.resolve(arg("--review") || path.join(ROOT, "..", "確認用画像", "pmd_claude", id));
  fs.mkdirSync(dirOut, { recursive: true });
  for (const [n, img] of Object.entries(r.sheets)) fs.writeFileSync(path.join(dirOut, `${n}.png`), Gif.encodePng(img));
  fs.writeFileSync(path.join(dirOut, "review.png"), Gif.encodePng(review(r)));
  fs.writeFileSync(path.join(dirOut, "manifest-fragment.json"), JSON.stringify(r.rec, null, 2) + "\n");
  console.log(`${id}: from ${baseId} (SpriteCollab ${sc}, x${r.n}) → ${Object.keys(r.sheets).join(", ")}; body ${r.rec.bodyW}x${r.rec.bodyH}; review ${dirOut}/review.png`);
  console.log("  Idle frame 0 anchors (1x, frame-local) per facing:");
  r.raw.Idle.pts.forEach((row, k) => console.log(`    ${DIRS[k].padEnd(2)} ` + ["head", "center", "handL", "handR"].map((a) => `${a} ${row[0][a].join(",")}`).join("  ")));
  console.log(`  Idle 1x frame ${r.raw.Idle.fw}x${r.raw.Idle.fh}. Base palette (hex → now, px): ` + r.palette.map(([a, b, c]) => `${a}→${b}:${c}`).join(" "));
  if (process.argv.includes("--install")) {
    const dest = path.join(OUT, r.src);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(dest)) if (f.endsWith(".png")) fs.unlinkSync(path.join(dest, f));
    for (const [n, img] of Object.entries(r.sheets)) {
      const png = Gif.encodePng(img);
      fs.writeFileSync(path.join(dest, `${n}.png`), png);
      r.rec.anims[n].file += `?v=${crypto.createHash("md5").update(png).digest("hex").slice(0, 8)}`;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
    manifest.pokemon[id] = r.rec;
    fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
    fs.writeFileSync(path.join(OUT, "manifest.js"), "// Generated for the gen-folder pokeAnim sheets. Do not edit by hand.\n" + `window.POKE_ANIM = ${JSON.stringify(manifest)};\n`);
    console.log(`installed → ${dest}`);
  }
}

module.exports = { build, review, readAnimData, resolveAnim };
