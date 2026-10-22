#!/usr/bin/env node
// Battle sheets from hand-drawn PMD-style key sprites (tools/hand-sprites/<roster id>.json).
// One drawing per facing is animated procedurally (breathing, walk bob, lunge, recoil, charge
// pulse, hurt knock-back and flash), so the form looks exactly as drawn in every direction.
//
//   node tools/build-hand-anim.js [--only id,id]                    write pokeAnim/<id>/ + manifest
//   node tools/build-hand-anim.js --only id --review <dir>          dry run: review images, no writes
//   node tools/build-hand-anim.js --only id --starter <dir> [--h N] ASCII starter grids from pokeSprite
//
// Called by tools/build-anim.js after the recoloured sheets (it replaces them for these ids).
//
// tools/hand-sprites/<id>.json:
//   { "colors": { "k": "000000", "a": "rrggbb", ... },     one char per colour; "." and " " are transparent
//     "shadowSize": 1,                                     optional (0 small … 2 large), default 1
//     "dirs":  { "S": [rows], "SW": [rows], "W": [rows], "NW": [rows], "N": [rows] },
//     "poses": { "attack": { "S": [rows], ... } } }         optional: drawn on the hit frames of Attack/Shoot/SpAttack
// Each drawing is a list of equal-length strings, one per pixel row; the bottom row stands on the
// ground. A missing facing is mirrored from its pair (SE↔SW, E↔W, NE↔NW); S and N are required.
"use strict";

const fs = require("fs");
const path = require("path");
const { decodePng, rgbToOklab, oklabToRgb } = require("./pixelize");
const { decodeGif, encodePng, writeManifest, newImg } = require("./build-gif-anim");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "pokeAnim");
const HAND = path.join(__dirname, "hand-sprites");
const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
const PAIR = { SE: "SW", SW: "SE", E: "W", W: "E", NE: "NW", NW: "NE" };
// Screen-space facing of each row (y flattened: the field is seen at an angle), as build-gif-anim.js.
const FWD = DIRS.map((_, i) => { const a = Math.PI / 2 - i * Math.PI / 4; return { x: Math.cos(a), y: Math.sin(a) * 0.75 }; });

// Motion scripts. fwd = px along the facing, lift = px up, breath = upper body down 1px,
// flash = 0..1 toward white, pose = use poses.attack. Durations are 1/60 s ticks (PMD units).
const ANIMS = {
  Idle: { frames: [{}, { breath: 1 }, { breath: 1 }, {}], durations: [15, 15, 15, 15] },
  Walk: { frames: [{}, { lift: 1 }, {}, { lift: 1 }], durations: [8, 10, 8, 10] },
  Attack: {
    frames: [{ fwd: -1 }, { fwd: -2, breath: 1 }, { fwd: 0, lift: 1 }, { fwd: 4, lift: 2, pose: 1 }, { fwd: 8, lift: 1, pose: 1 },
      { fwd: 8, pose: 1 }, { fwd: 6, pose: 1 }, { fwd: 4 }, { fwd: 2 }, { fwd: 0 }],
    durations: [3, 3, 2, 2, 4, 2, 2, 3, 3, 3], rush: 2, hit: 4, ret: 7,
  },
  Shoot: {
    frames: [{ breath: 1 }, { fwd: -1, breath: 1 }, { fwd: 1, pose: 1, flash: 0.25 }, { fwd: 0, pose: 1 }, { fwd: -2, pose: 1 },
      { fwd: -1 }, { fwd: 0 }, {}],
    durations: [4, 6, 2, 2, 3, 3, 4, 4], hit: 2, ret: 5,
  },
  SpAttack: {
    frames: [{ breath: 1 }, { breath: 1, flash: 0.2 }, { lift: 1, flash: 0.4 }, { lift: 2, pose: 1, flash: 0.55 }, { lift: 2, pose: 1, flash: 0.3 },
      { lift: 1, pose: 1 }, { lift: 1 }, {}],
    durations: [4, 4, 4, 2, 3, 3, 4, 4], hit: 3, ret: 6,
  },
  Charge: {
    frames: [{}, { breath: 1, flash: 0.15 }, { breath: 1, flash: 0.3 }, { breath: 1, flash: 0.45 }, { breath: 1, flash: 0.3 },
      { lift: 1, flash: 0.5 }, { lift: 1, flash: 0.3 }, { flash: 0.15 }, {}, {}],
    durations: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], hit: 5, ret: 9,
  },
  Hurt: { frames: [{ fwd: -2, flash: 0.6 }, { fwd: -2 }], durations: [2, 8] },
};

const hexRgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace(/^#/, "").slice(i, i + 2), 16));
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const specOf = (id) => readJson(path.join(HAND, `${id}.json`));
const listIds = () => (fs.existsSync(HAND) ? fs.readdirSync(HAND).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : []);
const mirror = (rows) => rows.map((r) => [...r].reverse().join(""));

// { S: rows, SE: rows, ... } for all 8 facings (mirroring the missing ones).
function facings(set, fallback = null) {
  const out = {};
  for (const d of DIRS) {
    const rows = (set && set[d]) || (set && set[PAIR[d]] && mirror(set[PAIR[d]])) || (fallback && fallback[d]);
    if (!rows) throw new Error(`missing facing ${d} (and its mirror pair)`);
    out[d] = rows;
  }
  return out;
}

function validate(id, spec) {
  const errs = [];
  if (!spec.colors || !spec.dirs) errs.push("needs \"colors\" and \"dirs\"");
  for (const d of ["S", "N"]) if (!spec.dirs || !spec.dirs[d]) errs.push(`dirs.${d} is required`);
  const check = (where, rows) => {
    if (!Array.isArray(rows) || !rows.length) { errs.push(`${where}: empty`); return; }
    const w = rows[0].length;
    rows.forEach((r, i) => {
      if (r.length !== w) errs.push(`${where} row ${i}: length ${r.length}, expected ${w}`);
      for (const ch of r) if (ch !== "." && ch !== " " && !(spec.colors || {})[ch]) { errs.push(`${where} row ${i}: unknown colour char "${ch}"`); break; }
    });
  };
  for (const [d, rows] of Object.entries(spec.dirs || {})) check(`dirs.${d}`, rows);
  for (const [p, set] of Object.entries(spec.poses || {})) for (const [d, rows] of Object.entries(set)) check(`poses.${p}.${d}`, rows);
  if (errs.length) throw new Error(`${id}: ${errs.join("; ")}`);
}

// Renders one drawing at (x, y) = its top-left, with the motion's breathing and flash.
function stamp(img, rows, colors, x, y, m) {
  const h = rows.length, split = Math.round(h * 0.45);
  const px = (ch) => (ch === "." || ch === " " ? null : colors[ch]);
  const draw = (rx, ry, c) => {
    if (rx < 0 || ry < 0 || rx >= img.w || ry >= img.h) return;
    const f = m.flash || 0, o = (ry * img.w + rx) * 4;
    img.data[o] = Math.round(c[0] + (255 - c[0]) * f); img.data[o + 1] = Math.round(c[1] + (255 - c[1]) * f);
    img.data[o + 2] = Math.round(c[2] + (255 - c[2]) * f); img.data[o + 3] = 255;
  };
  // Lower body first, then the upper body (shifted down 1px when breathing) over it.
  for (let r = split; r < h; r++) [...rows[r]].forEach((ch, c) => { const v = px(ch); if (v) draw(x + c, y + r, v); });
  const b = m.breath ? 1 : 0;
  for (let r = 0; r < split; r++) [...rows[r]].forEach((ch, c) => { const v = px(ch); if (v) draw(x + c, y + r + b, v); });
}

// Builds all sheets for one spec → { anims: { name: { img, fw, fh, frames, durations, hit, rush, ret, anchorY } }, bodyH, bodyW }.
function render(id, spec) {
  validate(id, spec);
  const colors = Object.fromEntries(Object.entries(spec.colors).map(([k, v]) => [k, hexRgb(v)]));
  const base = facings(spec.dirs);
  const pose = spec.poses && spec.poses.attack ? facings(spec.poses.attack, base) : base;
  const all = [...Object.values(base), ...Object.values(pose)];
  const W = Math.max(...all.map((r) => r[0].length)), H = Math.max(...all.map((r) => r.length));
  // One frame size for every sheet (the game places all sheets by Idle's feet offset).
  let padX = 2, padY = 2;
  for (const a of Object.values(ANIMS)) for (const m of a.frames) {
    padX = Math.max(padX, Math.ceil(Math.abs(m.fwd || 0)) + 2);
    padY = Math.max(padY, Math.ceil(Math.abs((m.fwd || 0) * 0.75) + (m.lift || 0)) + 2);
  }
  const fw = (W + 2 * padX + 1) & ~1, fh = (H + 2 * padY + 1) & ~1, ground = fh - padY;
  const anims = {};
  for (const [name, a] of Object.entries(ANIMS)) {
    const img = newImg(fw * a.frames.length, fh * 8);
    a.frames.forEach((m, col) => DIRS.forEach((d, row) => {
      const rows = (m.pose ? pose : base)[d], w = rows[0].length, h = rows.length;
      const dx = Math.round(FWD[row].x * (m.fwd || 0)), dy = Math.round(FWD[row].y * (m.fwd || 0)) - (m.lift || 0);
      stamp(img, rows, colors, col * fw + Math.floor((fw - w) / 2) + dx, row * fh + ground - h + dy, m);
    }));
    anims[name] = { img, fw, fh, frames: a.frames.length, rows: 8, durations: a.durations, hit: a.hit ?? null, rush: a.rush ?? null, ret: a.ret ?? null, anchorY: ground };
  }
  return { anims, bodyH: base.S.length, bodyW: base.S[0].length };
}

// Writes pokeAnim/<id>/ and the manifest record for every hand sprite. Returns credit rows.
function build({ manifest, roster, only = null, log = console.log }) {
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  const done = [];
  for (const id of listIds()) {
    if (only && !only.includes(id)) continue;
    if (!byId[id]) { log(`  ${id}: unknown roster id, skipped`); continue; }
    const spec = specOf(id);
    let r;
    try { r = render(id, spec); } catch (e) { log(`  ${e.message} — skipped`); continue; }
    const outDir = path.join(OUT, id);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const rec = { src: `hand/${id}`, exact: true, source: "hand", shadowSize: spec.shadowSize ?? 1, bodyH: r.bodyH, bodyW: r.bodyW, anims: {} };
    for (const [name, a] of Object.entries(r.anims)) {
      const png = encodePng(a.img);
      fs.writeFileSync(path.join(outDir, `${name}.png`), png);
      const v = require("crypto").createHash("md5").update(png).digest("hex").slice(0, 8);
      const { img, ...meta } = a;
      rec.anims[name] = { file: `../pokeAnim/${id}/${name}.png?v=${v}`, ...meta };
    }
    manifest.pokemon[id] = rec;
    done.push({ id, name: byId[id].name });
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// Review / starter helpers.

const gifDirOf = (p) => path.join(ROOT, path.dirname(p.sprite.replace(/^\.\.\//, "")));
// The base species' PMD entry (same dex number, real PMD art) for size and style reference.
function pmdRef(manifest, p) {
  const dex = String(p.dex).padStart(4, "0");
  return Object.keys(manifest.pokemon).find((k) => k.startsWith(dex + "_") && !manifest.pokemon[k].source) || null;
}

function canvas(w, h) {
  const out = newImg(w, h);
  for (let i = 0; i < w * h; i++) { out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 190; out.data[i * 4 + 3] = 255; }
  return out;
}
function put(out, img, sx, sy, w, h, dx, dy, s) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (sx + x >= img.w || sy + y >= img.h) continue;
    const t = ((sy + y) * img.w + sx + x) * 4;
    if (!img.data[t + 3]) continue;
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
      const X = dx + x * s + xx, Y = dy + y * s + yy;
      if (X < 0 || Y < 0 || X >= out.w || Y >= out.h) continue;
      out.data.set([img.data[t], img.data[t + 1], img.data[t + 2], 255], (Y * out.w + X) * 4);
    }
  }
}

// <dir>/<id>.png (4x): row 1 Idle frame 0 in all 8 facings (S SE E NE N NW W SW);
// row 2 the base species' real PMD sprite (S, E) for size/style next to yours (S, E);
// row 3 Attack frames 0-9 facing S, then Hurt and Charge peaks.
// <dir>/<id>-gif.png (2x): the pokeSprite reference GIFs (front, front-reverse, back, back-reverse).
function review({ manifest, roster, only, dir, log = console.log }) {
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  fs.mkdirSync(dir, { recursive: true });
  for (const id of only) {
    const p = byId[id], spec = specOf(id);
    if (!p) { log(`${id}: unknown roster id`); continue; }
    const ref = pmdRef(manifest, p);
    if (spec) {
      let r;
      try { r = render(id, spec); } catch (e) { log(`ERROR ${e.message}`); continue; }
      const S = 4, I = r.anims.Idle, A = r.anims.Attack;
      const refRec = ref && manifest.pokemon[ref].anims.Idle;
      const refImg = refRec && decodePng(path.join(OUT, ref, "Idle.png"));
      const row2W = (refRec ? 2 * refRec.fw : 0) + 2 * I.fw;
      const W = Math.max(8 * I.fw, row2W, 12 * A.fw) * S + 16;
      const H = (I.fh * 2 + A.fh) * S + 32 + (refRec ? Math.max(0, refRec.fh - I.fh) * S : 0);
      const out = canvas(W, H);
      for (let row = 0; row < 8; row++) put(out, I.img, 0, row * I.fh, I.fw, I.fh, row * I.fw * S, 0, S);
      let x = 0, y2 = I.fh * S + 12;
      if (refRec) for (const row of [0, 2]) { put(out, refImg, 0, row * refRec.fh, refRec.fw, refRec.fh, x, y2, S); x += refRec.fw * S; }
      x += 24;
      for (const row of [0, 2]) { put(out, I.img, 0, row * I.fh, I.fw, I.fh, x, y2, S); x += I.fw * S; }
      const y3 = y2 + Math.max(I.fh, refRec ? refRec.fh : 0) * S + 12;
      for (let f = 0; f < A.frames; f++) put(out, A.img, f * A.fw, 0, A.fw, A.fh, f * A.fw * S, y3, S);
      put(out, r.anims.Hurt.img, 0, 0, A.fw, A.fh, A.frames * A.fw * S, y3, S);
      put(out, r.anims.Charge.img, 5 * A.fw, 0, A.fw, A.fh, (A.frames + 1) * A.fw * S, y3, S);
      fs.writeFileSync(path.join(dir, `${id}.png`), encodePng(out));
      log(`${id}: sprite ${r.bodyW}x${r.bodyH}px, frame ${I.fw}x${I.fh} → ${path.join(dir, id + ".png")}`);
    } else log(`${id}: no tools/hand-sprites/${id}.json yet`);
    if (ref) log(`  reference PMD sprite: ${ref} (body ${manifest.pokemon[ref].bodyW}x${manifest.pokemon[ref].bodyH}px)`);
    const gd = gifDirOf(p);
    const gifs = ["front.gif", "front-reverse.gif", "back.gif", "back-reverse.gif"].filter((f) => fs.existsSync(path.join(gd, f))).map((f) => decodeGif(path.join(gd, f)));
    const out = canvas(gifs.reduce((s, g) => s + g.W * 2 + 8, 8), Math.max(8, ...gifs.map((g) => g.H * 2)));
    let gx = 0;
    for (const g of gifs) { put(out, { w: g.W, h: g.H, data: g.frames[0].data }, 0, 0, g.W, g.H, gx, 0, 2); gx += g.W * 2 + 8; }
    fs.writeFileSync(path.join(dir, `${id}-gif.png`), encodePng(out));
    log(`  reference GIFs → ${path.join(dir, id + "-gif.png")} (front, front-reverse, back, back-reverse)`);
  }
}

// Starter grids: the reference GIF's first frame, cropped, area-downscaled to height h and reduced
// to ~14 colours, as JSON-ready rows. A colour/detail guide only: redraw it chibi (big head) by hand.
function starter({ manifest, roster, only, dir, h = null, log = console.log }) {
  const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
  fs.mkdirSync(dir, { recursive: true });
  const CH = "abcdefghijmnopqrstuvwxyz";
  for (const id of only) {
    const p = byId[id];
    if (!p) { log(`${id}: unknown roster id`); continue; }
    const ref = pmdRef(manifest, p);
    const H = h || Math.round((ref ? manifest.pokemon[ref].bodyH : 32) * 1.2);
    const res = {};
    const pts = [];
    const crops = {};
    for (const f of ["front.gif", "back.gif"]) {
      const file = path.join(gifDirOf(p), f);
      if (!fs.existsSync(file)) continue;
      const g = decodeGif(file), d = g.frames[0].data;
      let x0 = g.W, y0 = g.H, x1 = -1, y1 = -1;
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (d[(y * g.W + x) * 4 + 3] > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const s = (y1 - y0 + 1) / H, w = Math.max(1, Math.round((x1 - x0 + 1) / s));
      const cells = [];
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < w; cx++) {
        let n = 0, a = 0, acc = [0, 0, 0];
        for (let y = Math.floor(y0 + cy * s); y < Math.floor(y0 + (cy + 1) * s) || y === Math.floor(y0 + cy * s); y++)
          for (let x = Math.floor(x0 + cx * s); x < Math.floor(x0 + (cx + 1) * s) || x === Math.floor(x0 + cx * s); x++) {
            n++;
            const t = (y * g.W + x) * 4;
            if (y >= g.H || x >= g.W || d[t + 3] < 128) continue;
            a++;
            const c = rgbToOklab(d[t], d[t + 1], d[t + 2]);
            acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
          }
        const on = a * 2 >= n;
        const c = on ? acc.map((v) => v / a) : null;
        cells.push(c);
        if (c) pts.push(c);
      }
      crops[f] = { w, cells };
    }
    // Simple k-means palette (14 colours) shared by both views.
    const k = Math.min(14, pts.length);
    let cent = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / k)) === 0).slice(0, k);
    for (let it = 0; it < 12; it++) {
      const acc = cent.map(() => [0, 0, 0, 0]);
      for (const q of pts) { let bi = 0, bd = Infinity; cent.forEach((c, j) => { const dd = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); const a = acc[bi]; a[0] += q[0]; a[1] += q[1]; a[2] += q[2]; a[3]++; }
      cent = cent.map((c, j) => (acc[j][3] ? [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]] : c));
    }
    const near = (q) => { let bi = 0, bd = Infinity; cent.forEach((c, j) => { const dd = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); return bi; };
    const colors = { k: "000000" };
    cent.forEach((c, j) => { colors[CH[j]] = oklabToRgb(c).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); });
    for (const [f, { w, cells }] of Object.entries(crops)) {
      const rows = [];
      for (let y = 0; y < H; y++) rows.push(cells.slice(y * w, (y + 1) * w).map((c) => (c ? CH[near(c)] : ".")).join(""));
      res[f === "front.gif" ? "front_faces_SW" : "back_faces_NE"] = rows;
    }
    const file = path.join(dir, `${id}-starter.json`);
    fs.writeFileSync(file, JSON.stringify({ _note: "Downscaled pokeSprite views (front.gif faces down-left = SW, back.gif faces up-right = NE). Colour/detail guide only: redraw chibi with black outlines.", height: H, colors, ...res }, null, 1) + "\n");
    log(`${id}: starter (height ${H}px) → ${file}`);
  }
}

function creditLines(list) {
  if (!list.length) return [];
  const lines = ["", "## Hand-drawn sheets", "",
    "Drawn for this project in PMD style from the pokeSprite reference art and animated procedurally by",
    "tools/build-hand-anim.js (not SpriteCollab art). Pokémon © Nintendo / Creatures / GAME FREAK.", "",
    "| Roster id | Pokémon |", "|---|---|"];
  for (const c of list) lines.push(`| ${c.id} | ${c.name} |`);
  return lines;
}

module.exports = { build, render, review, starter, creditLines, listIds };

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const only = arg("--only") ? arg("--only").split(",") : null;
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon;
  if (arg("--review") || arg("--starter")) {
    if (!only) { console.error("--review / --starter need --only"); process.exit(1); }
    if (arg("--starter")) starter({ manifest, roster, only, dir: path.resolve(arg("--starter")), h: arg("--h") ? Number(arg("--h")) : null });
    if (arg("--review")) review({ manifest, roster, only, dir: path.resolve(arg("--review")) });
    process.exit(0);
  }
  const done = build({ manifest, roster, only });
  writeManifest(manifest);
  console.log(`hand-drawn: ${done.length} entries`);
}
