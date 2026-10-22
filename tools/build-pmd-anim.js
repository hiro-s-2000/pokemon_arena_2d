#!/usr/bin/env node
// Builds pokeAnim sheets for one roster entry from its pokeSprite GIFs, in the look and motion of
// Pokémon Mystery Dungeon: Red Rescue Team (GBA):
//
//   art    front.gif / back.gif frames → tools/pixelize.js (PMD density: the ROM's own body height
//          for this species, ≤15 colours, 1px black outline), then ×2 like every pokeAnim sheet
//   motion the ROM's "ax" animation tables (8 facings × steps of {ticks, flags, pose, dx, dy}),
//          read straight from the ROM: timing, lunges, recoils and hit frames are the game's own
//   poses  the ROM's pose ids are distinct drawings we do not have, so each step gets one of four
//          GIF-derived poses (rest / crouch / mid / reach, picked by the frame's bounding box) or a
//          1-2 row squash of the rest pose, chosen from the step's role in its slot
//
//   node tools/build-pmd-anim.js --id 0006_charizard                  review only (sheets + contact.png)
//   node tools/build-pmd-anim.js --id 0006_charizard-mega-x --ax 6    forms: the base species' ax
//   node tools/build-pmd-anim.js --id 0006_charizard --install        write pokeAnim/<src>/ + manifest
//
// Options: --ax N (ROM animation set; default = dex number), --height N (1x body height, default the
// ROM's), --colors N (default 12, PMD uses ≤15), --review <dir> (default 確認用画像/pmd-anim/<id>),
// --rom-ref <png> (sprite sheet extracted from the ROM, drawn on the contact sheet for comparison).
// Everything in tools/README-pmd-anim.md.
"use strict";

const fs = require("fs");
const path = require("path");
const Pixelize = require("./pixelize");
const Gif = require("./build-gif-anim");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "pokeAnim");
const ROM = path.join(ROOT, "..", "あまり触らない。", "rom_analytics", "rom", "Pocket Monsters - Fushigi no Dungeon Aka no Kyuujotai (Japan).gba");
const ROM_SHEETS = path.join(ROOT, "..", "あまり触らない。", "rom_analytics", "fushigi_dan_image", "sprites");
const VER = "20261023a";

const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
// Which pokeSprite GIF each facing row comes from (same as build-gif-anim.js, verified on the contact sheets).
const ROW_GIF = { S: "front", SE: "frontR", E: "frontR", NE: "back", N: "backR", NW: "backR", W: "front", SW: "front" };
// Arena sheet name → ROM animation slot (measured on ax001 / ax006 / ax025; slot 5 is the ROM's sleep).
const SLOTS = { Walk: 0, Attack: 1, Strike: 2, Shoot: 3, SpAttack: 4, Faint: 5, Hurt: 6, Idle: 7, Charge: 11 };
const ANIM_ORDER = ["Idle", "Walk", "Attack", "Shoot", "SpAttack", "Charge", "Strike", "Hurt", "Faint"];

// ---------------------------------------------------------------------------------------------
// ROM: the "ax" archive of one species (see README for the layout).

const PKSDIR = 0x514000, PKSDIR_ENTRIES = 0x514018, PKSDIR_COUNT = 497;
const MONSPARA = 0x0355140, MON_RECORD = 72;
const OBJ_SIZE = { "0,0": [8, 8], "0,1": [16, 16], "0,2": [32, 32], "0,3": [64, 64], "1,0": [16, 8], "1,1": [32, 8], "1,2": [32, 16], "1,3": [64, 32], "2,0": [8, 16], "2,1": [8, 32], "2,2": [16, 32], "2,3": [32, 64] };

function readRom(ax) {
  if (!fs.existsSync(ROM)) throw new Error(`ROM not found: ${ROM}`);
  const rom = fs.readFileSync(ROM);
  const u32 = (o) => rom.readUInt32LE(o), s32 = (o) => rom.readInt32LE(o), u16 = (o) => rom.readUInt16LE(o), s16 = (o) => rom.readInt16LE(o);
  const gba = (p) => (p >= 0x08000000 && p - 0x08000000 < rom.length ? p - 0x08000000 : null);
  if (rom.toString("latin1", PKSDIR, PKSDIR + 7) !== "pksdir0") throw new Error("pksdir0 magic missing: not the measured JP ROM");
  const name = `ax${String(ax).padStart(3, "0")}`;
  let file = null;
  for (let i = 0; i < PKSDIR_COUNT; i++) {
    const no = gba(u32(PKSDIR_ENTRIES + i * 8));
    if (no == null) continue;
    const end = rom.indexOf(0, no);
    if (rom.toString("latin1", no, Math.min(end, no + 16)) === name) { file = gba(u32(PKSDIR_ENTRIES + i * 8 + 4)); break; }
  }
  if (file == null) throw new Error(`${name} is not in the ROM's graphics directory`);
  if (rom.toString("latin1", file, file + 4) !== "SIRO") throw new Error(`${name} is not a SIRO container`);
  const content = gba(u32(file + 4));
  const poseTbl = gba(u32(content)), animTbl = gba(u32(content + 4)), animCount = u32(content + 8), sprTbl = gba(u32(content + 12)), positions = gba(u32(content + 16));
  const sprites = [];
  for (let i = 0; i < (content - sprTbl) / 4; i++) {
    const rec = gba(u32(sprTbl + i * 4));
    if (rec == null) { sprites.push(null); continue; }
    const gfx = gba(u32(rec)), bc = s32(rec + 4);
    sprites.push(gfx != null && bc > 0 && bc <= 2e6 ? { gfx, bc } : null);
  }
  const nposes = (positions - poseTbl) / 4;
  const readSeq = (off) => {
    const steps = [];
    for (let i = 0; i < 80; i++) {
      const o = off + i * 12, t = rom[o];
      if (t === 0) return steps;
      const pose = s16(o + 2), x = s16(o + 4), y = s16(o + 6);
      if (pose < 0 || pose >= nposes || Math.abs(x) > 80 || Math.abs(y) > 80) throw new Error(`sequence at ${o.toString(16)} is not an ax step`);
      steps.push({ t, flag: rom[o + 1], pose, x, y });
    }
    throw new Error("sequence without terminator");
  };
  const slots = [];
  for (let a = 0; a < animCount; a++) {
    const group = gba(u32(animTbl + a * 4));
    slots.push(DIRS.map((_, d) => readSeq(gba(u32(group + d * 4)))));
  }
  // Opaque height of pose 0 (the resting south idle) in GBA pixels, from its OAM parts.
  const canvas = 96, px = new Uint8Array(canvas * canvas);
  let po = gba(u32(poseTbl));
  for (let parts = 0; parts < 8; parts++, po += 10) {
    const sid = s16(po);
    if (sid < 0) break;
    const sp = sprites[sid];
    if (!sp) continue;
    const a0 = u16(po + 4), a1 = u16(po + 6), a2 = u16(po + 8);
    const [tw, th] = OBJ_SIZE[`${(a0 >> 14) & 3},${(a1 >> 14) & 3}`];
    const hflip = (a1 >> 12) & 1, vflip = (a1 >> 13) & 1, tile = a2 & 0x3ff;
    const x = ((a1 & 255) << 24) >> 24, y = ((a0 & 255) << 24) >> 24;
    const start = tile * 32 < sp.bc ? tile * 32 : 0, txn = tw / 8, tyn = th / 8;
    for (let ty = 0; ty < tyn; ty++) for (let tx = 0; tx < txn; tx++) {
      const toff = sp.gfx + start + (ty * txn + tx) * 32;
      if (toff + 32 > sp.gfx + sp.bc) continue;
      for (let r = 0; r < 8; r++) for (let bx = 0; bx < 4; bx++) {
        const b = rom[toff + r * 4 + bx];
        for (const [bit, nib] of [[0, b & 15], [1, b >> 4]]) {
          if (!nib) continue;
          const sx = tx * 8 + bx * 2 + bit, dx = hflip ? tw - 1 - sx : sx, dy = vflip ? th - 1 - (ty * 8 + r) : ty * 8 + r;
          const X = 48 + x + dx, Y = 48 + y + dy;
          if (X >= 0 && X < canvas && Y >= 0 && Y < canvas) px[Y * canvas + X] = 1;
        }
      }
    }
  }
  let top = -1, bot = -1;
  for (let y = 0; y < canvas; y++) for (let x = 0; x < canvas; x++) if (px[y * canvas + x]) { if (top < 0) top = y; bot = y; }
  return { ax, romBodyH: top < 0 ? 24 : bot - top + 1, animCount, poses: nposes, slots };
}

// ---------------------------------------------------------------------------------------------
// Art.

function mirror(g) {
  return { W: g.W, H: g.H, frames: g.frames.map((f) => {
    const d = new Uint8Array(f.data.length);
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      const s = (y * g.W + x) * 4, t = (y * g.W + g.W - 1 - x) * 4;
      d[t] = f.data[s]; d[t + 1] = f.data[s + 1]; d[t + 2] = f.data[s + 2]; d[t + 3] = f.data[s + 3];
    }
    return { data: d, delay: f.delay };
  }) };
}

function bbox(data, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] < 16) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// rest / crouch / reach / mid frame indices of a GIF by bounding box (as build-gif-anim.js analyse()).
function poseFrames(g) {
  const boxes = g.frames.map((f) => bbox(f.data, g.W, g.H));
  const top = (i) => (boxes[i] ? boxes[i].y0 : 1e9), wid = (i) => (boxes[i] ? boxes[i].w : 0);
  let crouch = 0, reach = 0;
  for (let i = 0; i < g.frames.length; i++) {
    if (top(i) > top(crouch) || (top(i) === top(crouch) && wid(i) < wid(crouch))) crouch = i;
    if (top(i) < top(reach) || (top(i) === top(reach) && wid(i) > wid(reach))) reach = i;
  }
  if (crouch === reach) { const n = g.frames.length; crouch = Math.floor(n / 3); reach = Math.floor((2 * n) / 3); }
  return { rest: 0, crouch, reach, mid: Math.round((reach + crouch) / 2), boxes };
}

// Deletes `drop` rows from the upper middle of a frame and lets the rest drop onto the feet line.
function squash(f, W, H, drop) {
  const b = bbox(f.data, W, H);
  if (!b || b.h < drop + 4 || drop <= 0) return f;
  const kill = new Set();
  for (let i = 0; i < drop; i++) { const y = b.y0 + Math.floor(b.h * (0.35 + 0.12 * i)); if (y > b.y0 && y < b.y1) kill.add(y); }
  const keep = []; for (let y = b.y0; y <= b.y1; y++) if (!kill.has(y)) keep.push(y);
  const d = new Uint8Array(f.data.length);
  for (let y = 0; y < b.y0; y++) d.set(f.data.subarray(y * W * 4, (y + 1) * W * 4), y * W * 4);
  const dest0 = b.y1 - keep.length + 1;
  keep.forEach((sy, i) => d.set(f.data.subarray(sy * W * 4, (sy + 1) * W * 4), (dest0 + i) * W * 4));
  return { data: d, delay: f.delay };
}

// ---------------------------------------------------------------------------------------------
// Step → pose role. The ROM's pose ids are unique drawings; we only know where a step sits in
// its slot: anticipation before the hit (crouch), the big lunge (reach), the way there (mid).

function roleOf(name, steps, i) {
  const s = steps[i];
  const mag = (q) => Math.abs(q.x) + Math.abs(q.y);
  const maxMag = Math.max(1, ...steps.map(mag));
  const hit = steps.findIndex((q) => q.flag === 2);
  const order = []; for (const q of steps) if (!order.includes(q.pose)) order.push(q.pose);
  const k = order.indexOf(s.pose);
  if (name === "Idle") return k % 2 ? "breath" : "rest";
  if (name === "Walk") return k % 2 ? "step" : "rest";
  if (name === "Faint") return k === 0 ? "crouch" : "down";
  if (name === "Hurt") return "crouch";
  if (hit >= 0 && i < hit) return s.y < 0 && mag(s) <= maxMag * 0.6 ? "crouch" : "mid";
  if (mag(s) >= maxMag * 0.6) return "reach";
  if (mag(s) > 0) return "mid";
  return k === 0 ? "rest" : "mid";
}

// ---------------------------------------------------------------------------------------------
// Build.

function roster() { return JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon; }

function build(opts) {
  const p = roster().find((q) => q.id === opts.id);
  if (!p) throw new Error(`unknown roster id ${opts.id}`);
  const src = path.dirname(p.sprite.replace(/^\.\.\/pokeSprite\//, ""));
  const dir = path.join(ROOT, "pokeSprite", src);
  const rom = readRom(opts.ax ?? p.dex);
  const raw = { front: Gif.decodeGif(path.join(dir, "front.gif")) };
  if (fs.existsSync(path.join(dir, "back.gif"))) raw.back = Gif.decodeGif(path.join(dir, "back.gif"));
  raw.frontR = mirror(raw.front);
  raw.back = raw.back || raw.frontR;
  raw.backR = mirror(raw.back);
  // Scale: the resting front frame's body becomes the ROM's body height (minus the 1px outline ring).
  const targetH = opts.height || rom.romBodyH;
  const srcH = (bbox(raw.front.frames[0].data, raw.front.W, raw.front.H) || { h: raw.front.H }).h;
  const scale = Math.min(1, (targetH - 2) / srcH);
  // Palette snap toward the base species' existing PMD sheet when there is one.
  let paletteFrom = null;
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const baseId = opts.paletteFrom || (p.category !== "gen" + p.generation ? `${String(p.dex).padStart(4, "0")}_${p.slug.split("-")[0]}` : null);
  if (baseId && manifest.pokemon[baseId] && !opts.noPalette) {
    const f = path.join(OUT, manifest.pokemon[baseId].src, "Idle.png");
    if (fs.existsSync(f)) {
      const img = Pixelize.decodePng(f), m = new Map();
      for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] >= 128) { const k = (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2]; m.set(k, (m.get(k) || 0) + 1); }
      paletteFrom = [...m.entries()].filter(([, n]) => n >= 4).map(([k]) => Pixelize.rgbToOklab(k >> 16, (k >> 8) & 255, k & 255));
    }
  }
  const popt = { colors: opts.colors || 12 };
  if (paletteFrom) popt.paletteFrom = paletteFrom;
  const px = Pixelize.pixelizeGifs(raw, scale, popt);
  const gifs = px.gifs;

  // Shared core canvas: every GIF's union bbox centred, feet on the bottom edge.
  let CW = 0, CH = 0;
  const core = {};
  for (const [k, g] of Object.entries(gifs)) {
    let u = null;
    for (const f of g.frames) { const b = bbox(f.data, g.W, g.H); if (b) u = u ? { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) } : { ...b }; }
    u = u || { x0: 0, y0: 0, x1: 0, y1: 0 };
    core[k] = { g, u, w: u.x1 - u.x0 + 1, h: u.y1 - u.y0 + 1, poses: poseFrames(g) };
    CW = Math.max(CW, core[k].w); CH = Math.max(CH, core[k].h);
  }
  const frameFor = (k, role) => {
    const c = core[k], g = c.g, P = c.poses;
    const base = g.frames[P.rest];
    switch (role) {
      case "rest": return base;
      case "breath": return squash(base, g.W, g.H, 1);
      case "step": return squash(base, g.W, g.H, 1);
      case "crouch": return P.crouch !== P.rest ? g.frames[P.crouch] : squash(base, g.W, g.H, 1);
      case "mid": return P.mid !== P.rest ? g.frames[P.mid] : base;
      case "reach": return P.reach !== P.rest ? g.frames[P.reach] : base;
      case "down": return squash(base, g.W, g.H, 2);
    }
    return base;
  };

  // Sheet geometry (2x): the core plus room for the largest ROM offset.
  let maxOff = 1;
  for (const name of ANIM_ORDER) for (const dirSteps of rom.slots[SLOTS[name]]) for (const s of dirSteps) maxOff = Math.max(maxOff, Math.abs(s.x), Math.abs(s.y));
  const pad = (maxOff + 1) * 2;
  const fw = CW * 2 + pad * 2, fh = CH * 2 + pad * 2, anchorY = pad + CH * 2;

  const sheets = {}, anims = {};
  for (const name of ANIM_ORDER) {
    const dirs = rom.slots[SLOTS[name]];
    const frames = dirs[0].length;
    if (dirs.some((d) => d.length !== frames)) throw new Error(`${name}: facings differ in step count`);
    const img = Gif.newImg(fw * frames, fh * 8);
    for (let row = 0; row < 8; row++) {
      const k = ROW_GIF[DIRS[row]], c = core[k];
      dirs[row].forEach((s, i) => {
        const f = frameFor(k, roleOf(name, dirs[row], i));
        // The frame's part of the core, scaled ×2, placed at the ROM offset (×2).
        const ox = Math.round((CW - c.w) / 2), oy = CH - c.h;
        const sx = i * fw + pad + (ox + s.x) * 2, sy = row * fh + pad + (oy + s.y) * 2;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
          const si = ((c.u.y0 + y) * c.g.W + c.u.x0 + x) * 4;
          if (!f.data[si + 3]) continue;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const X = sx + x * 2 + dx, Y = sy + y * 2 + dy;
            if (X < i * fw || X >= (i + 1) * fw || Y < row * fh || Y >= (row + 1) * fh) continue;
            const t = (Y * img.w + X) * 4;
            img.data[t] = f.data[si]; img.data[t + 1] = f.data[si + 1]; img.data[t + 2] = f.data[si + 2]; img.data[t + 3] = 255;
          }
        }
      });
    }
    const steps = dirs[0];
    let hit = steps.findIndex((s) => s.flag === 2); if (hit < 0) hit = steps.findIndex((s) => s.flag === 1); if (hit < 0) hit = null;
    sheets[name] = img;
    anims[name] = { file: `../pokeAnim/${src}/${name}.png?v=${VER}`, fw, fh, frames, rows: 8, durations: steps.map((s) => s.t), hit: ["Idle", "Walk", "Hurt", "Faint"].includes(name) ? null : hit, rush: null, ret: null, anchorY, romSlot: SLOTS[name] };
  }
  const idle = sheets.Idle, b0 = bbox(idle.data.subarray(0, 0) && cellData(idle, fw, fh, 0, 0), fw, fh);
  const rec = { src, exact: true, source: "pmd-rom", romAx: rom.ax, romBodyH: rom.romBodyH, shadowSize: 1, bodyH: b0 ? b0.h : fh, bodyW: b0 ? b0.w : fw, pixel: { height1x: targetH, scale: +scale.toFixed(4), colors: popt.colors, paletteFrom: paletteFrom ? baseId : null }, anims };
  rec.shadowSize = rec.bodyW > 28 ? 2 : 1;
  return { p, src, rom, rec, sheets, core, px, fw, fh, anchorY };
}

function cellData(img, fw, fh, col, row) {
  const d = new Uint8Array(fw * fh * 4);
  for (let y = 0; y < fh; y++) d.set(img.data.subarray(((row * fh + y) * img.w + col * fw) * 4, ((row * fh + y) * img.w + col * fw + fw) * 4), y * fw * 4);
  return d;
}

// ---------------------------------------------------------------------------------------------
// Review: facings, every anim's S row, the ROM's own sprite sheet cell when available.

function contact(r, romRef) {
  const K = 3, gap = 6;
  const rows = [];
  const cells = (name, dirsList, frameList) => dirsList.flatMap((row) => frameList.map((i) => ({ img: r.sheets[name], sx: i * r.fw, sy: row * r.fh })));
  rows.push({ label: "facings", items: cells("Idle", [0, 1, 2, 3, 4, 5, 6, 7], [0]) });
  for (const name of ANIM_ORDER) rows.push({ label: `${name} ticks ${r.rec.anims[name].durations.join(",")}`, items: cells(name, [0], [...Array(r.rec.anims[name].frames).keys()]) });
  const w = Math.max(...rows.map((x) => x.items.length)) * (r.fw * K + gap) + gap + (romRef ? romRef.w * 2 * K + gap : 0);
  const h = rows.length * (r.fh * K + gap + 12) + gap;
  const out = Gif.newImg(w, h);
  Gif.fill(out, 0, 0, w, h, [28, 28, 34]);
  let y = gap;
  for (const row of rows) {
    Gif.text(out, gap, y, row.label, [255, 220, 120]);
    let x = gap;
    for (const it of row.items) { Gif.blitScaled(out, it.img, it.sx, it.sy, r.fw, r.fh, x, y + 12, K); x += r.fw * K + gap; }
    y += r.fh * K + gap + 12;
  }
  if (romRef) {
    Gif.text(out, w - romRef.w * 2 * K - gap, gap, "ROM", [255, 220, 120]);
    Gif.blitScaled(out, romRef, 0, 0, romRef.w, romRef.h, w - romRef.w * 2 * K - gap, gap + 12, 2 * K);
  }
  return out;
}

function romRefCell(ax) {
  if (!fs.existsSync(ROM_SHEETS)) return null;
  const f = fs.readdirSync(ROM_SHEETS).find((n) => n.startsWith(`ax${String(ax).padStart(3, "0")}_`));
  if (!f) return null;
  const img = Pixelize.decodePng(path.join(ROM_SHEETS, f));
  // First cell: the sheet is a grid of equal cells; cell size = first opaque column block.
  const cw = Math.round(img.w / Math.round(img.w / 58)), ch = Math.round(img.h / Math.round(img.h / 41));
  const cell = Gif.newImg(cw, ch);
  for (let y = 0; y < ch; y++) cell.data.set(img.data.subarray((y * img.w) * 4, (y * img.w + cw) * 4), y * cw * 4);
  return cell;
}

function writeManifest(manifest) {
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT, "manifest.js"), "// Generated for the gen-folder pokeAnim sheets. Do not edit by hand.\n" + `window.POKE_ANIM = ${JSON.stringify(manifest)};\n`);
}

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const has = (k) => process.argv.includes(k);
  const id = arg("--id");
  if (!id) { console.error("usage: node tools/build-pmd-anim.js --id <roster id> [--ax N] [--height N] [--colors N] [--review dir] [--rom-ref png] [--install]"); process.exit(1); }
  const r = build({ id, ax: arg("--ax") ? +arg("--ax") : undefined, height: arg("--height") ? +arg("--height") : undefined, colors: arg("--colors") ? +arg("--colors") : undefined, paletteFrom: arg("--palette-from"), noPalette: has("--no-palette") });
  const review = path.resolve(arg("--review") || path.join(ROOT, "..", "確認用画像", "pmd-anim", id));
  fs.mkdirSync(review, { recursive: true });
  for (const [name, img] of Object.entries(r.sheets)) fs.writeFileSync(path.join(review, `${name}.png`), Gif.encodePng(img));
  fs.writeFileSync(path.join(review, "manifest-fragment.json"), JSON.stringify(r.rec, null, 2) + "\n");
  fs.writeFileSync(path.join(review, "rom-anims.json"), JSON.stringify({ ax: r.rom.ax, romBodyH: r.rom.romBodyH, poses: r.rom.poses, animCount: r.rom.animCount, slots: r.rom.slots }, null, 1) + "\n");
  const ref = arg("--rom-ref") ? Pixelize.decodePng(arg("--rom-ref")) : romRefCell(r.rom.ax);
  fs.writeFileSync(path.join(review, "contact.png"), Gif.encodePng(contact(r, ref)));
  console.log(`${id}: ax${r.rom.ax} romBodyH ${r.rom.romBodyH} → 1x height ${r.rec.pixel.height1x} (scale ${r.rec.pixel.scale}), palette ${r.px.palette.length} colours, cell ${r.fw}x${r.fh}, body ${r.rec.bodyW}x${r.rec.bodyH}; review ${review}`);
  if (has("--install")) {
    const dest = path.join(OUT, r.src);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(dest)) if (f.endsWith(".png")) fs.unlinkSync(path.join(dest, f));
    for (const [name, img] of Object.entries(r.sheets)) fs.writeFileSync(path.join(dest, `${name}.png`), Gif.encodePng(img));
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
    manifest.pokemon[id] = r.rec;
    writeManifest(manifest);
    console.log(`installed → ${dest} (manifest.json / manifest.js updated)`);
  }
}

module.exports = { build, readRom, SLOTS, ROW_GIF };
