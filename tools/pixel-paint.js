#!/usr/bin/env node
// Hand-paint layer for the GIF-derived ("gif-pixel") pokeAnim entries.
//
// tools/build-gif-anim.js converts every pokeSprite GIF frame to PMD-style pixel art (pixelize.js)
// and composes the actions from a few of those frames. For entries whose conversion is weak, a
// painter can redraw the converted frames by hand as text grids in tools/pixel-paint/<id>/; the
// build then uses those exact pixels instead (apply() below is called right after pixelize).
//
//   node tools/pixel-paint.js export <id> [--keys N] [--all] [--force]
//        write tools/pixel-paint/<id>/ (palette.txt, meta.json, map.json, one grid per key frame)
//   node tools/pixel-paint.js preview <id> [--out file-or-dir]
//        dry-run build (pokeAnim/ and the manifest are not touched) → preview PNG
//   node tools/pixel-paint.js check <id>
//        validate grids / palette / map, and list used frames that are not painted
//
// Formats: see tools/pixel-paint/README.md.
"use strict";

const fs = require("fs");
const path = require("path");

const PAINT_DIR = path.join(__dirname, "pixel-paint");
const SCRATCH = "/private/tmp/claude-501/-Users-honmahiroshi-Desktop-claude-workspace/51c3ddde-de40-48ed-918d-f3b3748b824d/scratchpad/paint/preview";
const CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MARGIN = 4;
const VIEW_ORDER = ["front", "frontR", "back", "backR"];
const MIRROR_OF = { frontR: "front", backR: "back" };

// ---------------------------------------------------------------------------------------------
// Data files.

const dirOf = (id) => path.join(PAINT_DIR, id);
const readJson = (f, def = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : def);
const hex = (c) => c.map((v) => v.toString(16).padStart(2, "0")).join("");

// palette.txt: one "<char> <rrggbb>" per line; "." = transparent, "//" starts a comment.
function readPalette(dir) {
  const f = path.join(dir, "palette.txt");
  const pal = new Map(), errors = [];
  if (!fs.existsSync(f)) return { pal, errors: ["palette.txt missing"] };
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, n) => {
    const l = line.replace(/\/\/.*$/, "").trimEnd();
    if (!l.trim()) return;
    const ch = l[0], rest = l.slice(1).trim().split(/\s+/)[0] || "";
    if (/\s/.test(ch)) { errors.push(`palette.txt:${n + 1}: line must start with its character`); return; }
    if (ch === ".") return;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(rest);
    if (!m) { errors.push(`palette.txt:${n + 1}: "${ch}" needs a colour rrggbb, got "${rest}"`); return; }
    if (pal.has(ch)) errors.push(`palette.txt:${n + 1}: "${ch}" defined twice`);
    const v = parseInt(m[1], 16);
    pal.set(ch, [v >> 16, (v >> 8) & 255, v & 255]);
  });
  return { pal, errors };
}

function readGrid(file) {
  return fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n").filter((l, i, a) => !(l === "" && i === a.length - 1));
}

// Which grid file paints frame i of a view: <view>_f<iii>.txt beats a key in map.json.
function resolver(dir, map, view) {
  const keys = ((map && map.views && map.views[view]) || {}).keys || {};
  const byFrame = new Map();
  for (const [k, v] of Object.entries(keys)) for (const i of v.frames || []) if (!byFrame.has(i)) byFrame.set(i, k);
  return (i) => {
    const f = path.join(dir, `${view}_f${String(i).padStart(3, "0")}.txt`);
    if (fs.existsSync(f)) return { file: f, pid: `${view}:f${i}` };
    const k = byFrame.get(i);
    if (k != null) {
      const kf = path.join(dir, `${view}_${k}.txt`);
      if (fs.existsSync(kf)) return { file: kf, pid: `${view}:${k}` };
    }
    return null;
  };
}

// ---------------------------------------------------------------------------------------------
// Build hook. gifs = pixelize output { front, frontR?, back?, backR? } (each {W, H, frames: [{data, delay}]}).
// Mutates gifs in place. opt.mode "derive" = only derive the mirrored views (export dry run).

function mirror(g) {
  return {
    W: g.W, H: g.H,
    frames: g.frames.map((f) => {
      const d = new Uint8Array(f.data.length);
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const s = (y * g.W + x) * 4, t = (y * g.W + g.W - 1 - x) * 4;
        d[t] = f.data[s]; d[t + 1] = f.data[s + 1]; d[t + 2] = f.data[s + 2]; d[t + 3] = f.data[s + 3];
      }
      return { data: d, delay: f.delay, pid: f.pid != null ? `m:${f.pid}` : undefined };
    }),
  };
}

// Same fill-in as build-gif-anim's layoutSource, so the views exist before painting.
function normalize(gifs) {
  if (!gifs.frontR) gifs.frontR = mirror(gifs.front);
  if (!gifs.back) gifs.back = gifs.backR ? mirror(gifs.backR) : gifs.frontR;
  if (!gifs.backR) gifs.backR = mirror(gifs.back);
}

function deriveMirrors(gifs, derive) {
  for (const [v, how] of Object.entries(derive || {})) {
    const from = /^mirror (\w+)$/.exec(how);
    if (from && gifs[from[1]]) gifs[v] = mirror(gifs[from[1]]);
  }
}

function apply(id, gifs, opt = {}) {
  const dir = dirOf(id);
  const meta = readJson(path.join(dir, "meta.json"));
  if (opt.mode === "derive") {
    normalize(gifs);
    deriveMirrors(gifs, opt.derive);
    return { painted: false };
  }
  if (!meta) return { painted: false };
  normalize(gifs);
  const map = readJson(path.join(dir, "map.json"), {});
  const { pal, errors } = readPalette(dir);
  if (errors.length) throw new Error(`pixel-paint ${id}: ${errors.join("; ")}`);
  let frames = 0;
  const used = new Set();
  for (const [view, vm] of Object.entries(meta.views)) {
    const g = gifs[view];
    if (!g) continue;
    if (g.W !== vm.W || g.H !== vm.H) console.warn(`  pixel-paint ${id}: ${view} converted canvas is ${g.W}x${g.H}, grids were exported for ${vm.W}x${vm.H} (placed at the stored origin)`);
    const ux = Math.min(0, vm.x0), uy = Math.min(0, vm.y0);
    const NW = Math.max(g.W, vm.x0 + vm.w) - ux, NH = Math.max(g.H, vm.y0 + vm.h) - uy;
    const res = resolver(dir, map, view);
    const cache = new Map();
    const out = { W: NW, H: NH, frames: [] };
    g.frames.forEach((f, i) => {
      const d = new Uint8Array(NW * NH * 4);
      const r = res(i);
      if (r) {
        let rows = cache.get(r.file);
        if (!rows) { rows = readGrid(r.file); cache.set(r.file, rows); }
        for (let y = 0; y < Math.min(rows.length, vm.h); y++) for (let x = 0; x < Math.min(rows[y].length, vm.w); x++) {
          const ch = rows[y][x];
          if (ch === ".") continue;
          const c = pal.get(ch);
          if (!c) throw new Error(`pixel-paint ${id}: ${path.basename(r.file)} row ${y + 1} col ${x + 1}: unknown char "${ch}"`);
          const t = ((vm.y0 + y - uy) * NW + vm.x0 + x - ux) * 4;
          d[t] = c[0]; d[t + 1] = c[1]; d[t + 2] = c[2]; d[t + 3] = 255;
          used.add(ch);
        }
        frames++;
        out.frames.push({ data: d, delay: f.delay, pid: r.pid });
      } else {
        for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
          const s = (y * g.W + x) * 4;
          if (!f.data[s + 3]) continue;
          const t = ((y - uy) * NW + x - ux) * 4;
          d[t] = f.data[s]; d[t + 1] = f.data[s + 1]; d[t + 2] = f.data[s + 2]; d[t + 3] = 255;
        }
        out.frames.push({ data: d, delay: f.delay });
      }
    });
    gifs[view] = out;
  }
  deriveMirrors(gifs, meta.derive);
  return { painted: frames > 0, frames, poses: map.poses || null, paletteSize: [...used].filter((c) => c !== "#").length };
}

// ---------------------------------------------------------------------------------------------
// Dry-run build of one entry (nothing written).

let BG_ = null;
const B = () => (BG_ = BG_ || require("./build-gif-anim"));

function context() {
  const { ROOT, OUT, heightOf } = B();
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon;
  return { manifest, roster, heightOf };
}

function dryBuild(id, ctx, paint) {
  const b = B();
  const p = ctx.roster.find((r) => r.id === id);
  if (!p) throw new Error(`unknown roster id: ${id}`);
  const o = b.loadOverrides()[id] || {};
  const entry = b.buildEntry(p, o, { ...ctx, paint });
  if (!entry) throw new Error(`${id}: no front.gif`);
  entry.manifestRef = ctx.manifest;
  b.thinIdle(entry);
  return { p, o, entry };
}

// For each painted view: which frame indices each anim uses (frontR/backR rows count for the view
// they are mirrored from).
function usedFrames(entry, derive) {
  const b = B();
  const per = {};
  for (const name of b.ANIM_ORDER) for (const fr of entry.frames[name]) for (let row = 0; row < 8; row++) {
    let view = b.ROW_GIF[b.DIRS[row]];
    const m = /^mirror (\w+)$/.exec((derive || {})[view] || "");
    if (m) view = m[1];
    const gi = b.rowFrame(entry.src, row, fr.fi);
    ((per[view] = per[view] || {})[name] = per[view][name] || new Set()).add(gi);
  }
  return per;
}

// Is <rev>.gif the mirror image of <view>.gif? Every reverse frame must match some mirrored frame
// (alpha mismatch ≤ 1 %, strong colour mismatch ≤ 2 % of the opaque pixels).
function mirrorCheck(raw, view, rev) {
  const A = raw.g[view], R = raw.g[rev];
  if (!A || !R) return { ok: true, note: `${rev}.gif missing: build already mirrors ${view}` };
  if (A.W !== R.W || A.H !== R.H) return { ok: false, note: "canvas sizes differ" };
  let worst = 0;
  const step = Math.max(1, Math.floor(R.frames.length / 12));
  for (let fb = 0; fb < R.frames.length; fb += step) {
    let best = 1;
    const y = R.frames[fb].data;
    for (let fa = 0; fa < A.frames.length && best > 0; fa++) {
      const x = A.frames[fa].data;
      let bad = 0, tot = 0;
      for (let r = 0; r < A.H; r++) for (let c = 0; c < A.W; c++) {
        const i = (r * A.W + c) * 4, j = (r * A.W + A.W - 1 - c) * 4;
        if (!x[i + 3] && !y[j + 3]) continue;
        tot++;
        if ((x[i + 3] > 127) !== (y[j + 3] > 127)) bad += 2;
        else if (Math.abs(x[i] - y[j]) + Math.abs(x[i + 1] - y[j + 1]) + Math.abs(x[i + 2] - y[j + 2]) > 120) bad++;
      }
      best = Math.min(best, tot ? bad / tot / 2 : 0);
    }
    worst = Math.max(worst, best);
  }
  return { ok: worst <= 0.02, note: `worst frame mismatch ${(worst * 100).toFixed(2)}% (${A.frames.length} vs ${R.frames.length} frames)` };
}

// ---------------------------------------------------------------------------------------------
// export

function frameDiff(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3] && !b[i + 3]) continue;
    if (a[i + 3] !== b[i + 3] || a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

// Picks ≤ maxKeys key frames for a view: the action poses first, then farthest-point over the used
// frames; every frame of the GIF is routed to its nearest key. Idle keeps ≥ 3 distinct keys when
// it has ≥ 3 distinct frames.
function chooseKeys(g, usedSet, seeds, idleFrames, maxKeys) {
  const nF = g.frames.length;
  const used = [...usedSet].sort((a, b) => a - b);
  const memo = new Map();
  const D = (i, j) => {
    if (i === j) return 0;
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    let v = memo.get(k);
    if (v === undefined) { v = frameDiff(g.frames[i].data, g.frames[j].data); memo.set(k, v); }
    return v;
  };
  const distinct = [];
  for (const i of used) if (!distinct.some((j) => D(i, j) === 0)) distinct.push(i);
  const K = Math.min(maxKeys, distinct.length);
  const keys = [];
  const near = (i) => Math.min(...keys.map((k) => D(i, k)));
  for (const s of seeds) if (keys.length < K && usedSet.has(s) && (!keys.length || near(s) > 0)) keys.push(s);
  while (keys.length < K) {
    let bi = -1, bd = 0;
    for (const i of distinct) { const d = keys.length ? near(i) : 1; if (d > bd) { bd = d; bi = i; } }
    if (bi < 0) break;
    keys.push(bi);
  }
  const assign = (i) => { let bk = keys[0], bd = Infinity; for (const k of keys) { const d = D(i, k); if (d < bd) { bd = d; bk = k; } } return bk; };
  const idleDistinct = distinct.filter((i) => idleFrames.has(i));
  for (;;) {
    const ks = new Set([...idleFrames].map(assign));
    if (ks.size >= Math.min(3, idleDistinct.length)) break;
    let bi = -1, bd = 0;
    for (const i of idleDistinct) { const d = near(i); if (d > bd) { bd = d; bi = i; } }
    if (bi < 0) break;
    keys.push(bi);
  }
  keys.sort((a, b) => a - b);
  const out = {};
  keys.forEach((k, n) => { out[`k${n}`] = { src: k, frames: [] }; });
  const name = new Map(keys.map((k, n) => [k, `k${n}`]));
  for (let i = 0; i < nF; i++) out[name.get(assign(i))].frames.push(i);
  return out;
}

function cmdExport(id, args) {
  const dir = dirOf(id);
  const force = args.includes("--force");
  const all = args.includes("--all");
  const ki = args.indexOf("--keys");
  const maxKeys = ki > 0 ? +args[ki + 1] : 10;
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".txt")) && !force) {
    console.error(`${path.relative(process.cwd(), dir)} already has grids (painters' work). Use --force to overwrite.`);
    process.exit(1);
  }
  const b = B();
  const ctx = context();
  const p = ctx.roster.find((r) => r.id === id);
  if (!p) throw new Error(`unknown roster id: ${id}`);
  // 1. Are the reverse GIFs mirrors? Then only front / back are painted.
  const raw = b.loadGifs(p);
  const derive = {}, checks = {};
  for (const [rev, view] of Object.entries(MIRROR_OF)) {
    const c = mirrorCheck(raw, view, rev);
    checks[rev] = c.note;
    if (c.ok) derive[rev] = `mirror ${view}`;
  }
  // 2. Dry build with only the mirrors derived (= exactly what the painted build will compose).
  const { entry } = dryBuild(id, ctx, { mode: "derive", derive });
  const per = usedFrames(entry, derive);
  const views = ["front", "frontR", "back", "backR"].filter((v) => !derive[v] && per[v]);
  const gifs = {};
  for (const v of views) gifs[v] = entry.src.gifs[v].gif;
  // Poses in the view's own frame numbers (front frame numbers; back via timing).
  const poses = entry.poses;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.(txt|json)$/.test(f) && f !== "README.md") fs.rmSync(path.join(dir, f));

  // 3. Palette over every frame of the painted views.
  const colours = new Map(); // rgb int → char
  const order = [...entry.px.palette, ...entry.px.outlines].map((c) => (c[0] << 16) | (c[1] << 8) | c[2]);
  for (const v of views) for (const f of gifs[v].frames) for (let i = 0; i < f.data.length; i += 4) {
    if (!f.data[i + 3]) continue;
    const k = (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2];
    if (!colours.has(k)) colours.set(k, null);
  }
  const keysSorted = [...colours.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 1e6 + a : ia) - (ib < 0 ? 1e6 + b : ib);
  });
  let ci = 0;
  for (const k of keysSorted) colours.set(k, k === 0 ? "#" : CHARS[ci++]);
  if (!colours.has(0)) colours.set(0, "#");
  const palLines = [
    `// pixel-paint palette for ${id}. One colour per line: <char> <rrggbb>. "." = transparent.`,
    "// \"#\" = outline black. Add new colours freely (any unused non-space char), e.g.:  P ff80c0",
    ". transparent",
    "# 000000",
  ];
  for (const k of keysSorted) if (k !== 0) palLines.push(`${colours.get(k)} ${hex([k >> 16, (k >> 8) & 255, k & 255])}`);
  fs.writeFileSync(path.join(dir, "palette.txt"), palLines.join("\n") + "\n");

  // 4. Grid canvas per view: union bbox of all frames + margin.
  const meta = { id, exported: new Date().toISOString(), margin: MARGIN, views: {}, derive, mirrorCheck: checks, pixel: entry.pixel };
  const map = {
    _help: "views.<view>.keys.<key> = { src: converted frame the grid started from, frames: every GIF frame index drawn with <view>_<key>.txt }. A file <view>_f<iii>.txt overrides one frame. poses pins the action poses (front.gif frame numbers).",
    poses: { rest: poses.rest, crouch: poses.crouch, reach: poses.reach, mid: poses.mid },
    views: {},
  };
  const report = { id, derive, checks, views: {} };
  for (const v of views) {
    const g = gifs[v];
    let x0 = g.W, y0 = g.H, x1 = -1, y1 = -1;
    for (const f of g.frames) for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      if (!f.data[(y * g.W + x) * 4 + 3]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const vm = { W: g.W, H: g.H, x0: x0 - MARGIN, y0: y0 - MARGIN, w: x1 - x0 + 1 + 2 * MARGIN, h: y1 - y0 + 1 + 2 * MARGIN, frames: g.frames.length };
    meta.views[v] = vm;
    const toGrid = (f) => {
      const rows = [];
      for (let y = 0; y < vm.h; y++) {
        let s = "";
        for (let x = 0; x < vm.w; x++) {
          const gx = vm.x0 + x, gy = vm.y0 + y;
          if (gx < 0 || gy < 0 || gx >= g.W || gy >= g.H) { s += "."; continue; }
          const i = (gy * g.W + gx) * 4;
          s += f.data[i + 3] ? colours.get((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]) : ".";
        }
        rows.push(s);
      }
      return rows.join("\n") + "\n";
    };
    const usedAll = new Set();
    for (const s of Object.values(per[v])) for (const i of s) usedAll.add(i);
    const idleSet = per[v].Idle || new Set();
    const seedRows = v.startsWith("back") ? 2 : 0; // row whose rowFrame gives this view's index
    const rowOf = { front: 0, frontR: 2, back: 3, backR: 4 }[v] ?? seedRows;
    const seeds = ["rest", "crouch", "reach", "mid"].map((k) => b.rowFrame(entry.src, rowOf, poses[k]));
    let keys;
    if (all) {
      keys = {};
      const seen = [];
      for (const i of [...usedAll].sort((a, c) => a - c)) {
        const same = seen.find((j) => frameDiff(g.frames[i].data, g.frames[j].data) === 0);
        if (same != null) { keys[`f${same}`].frames.push(i); continue; }
        seen.push(i);
        keys[`f${i}`] = { src: i, frames: [i] };
      }
      // Unused frames → nearest exported frame, so stale converted frames never mix in.
      for (let i = 0; i < g.frames.length; i++) if (!usedAll.has(i)) {
        let bj = seen[0], bd = Infinity;
        for (const j of seen) { const d = frameDiff(g.frames[i].data, g.frames[j].data); if (d < bd) { bd = d; bj = j; } }
        keys[`f${bj}`].frames.push(i);
      }
    } else keys = chooseKeys(g, usedAll, seeds, idleSet, maxKeys);
    // Grid files: key mode → <view>_k<n>.txt; --all → <view>_f<iii>.txt (named by source frame).
    const keyOfFrame = new Map();
    for (const [k, kv] of Object.entries(keys)) {
      kv.frames.sort((a, c) => a - c);
      for (const i of kv.frames) keyOfFrame.set(i, k);
      const fname = all ? `${v}_key_f${String(kv.src).padStart(3, "0")}` : `${v}_${k}`;
      fs.writeFileSync(path.join(dir, `${fname}.txt`), toGrid(g.frames[kv.src]));
    }
    if (all) {
      // In --all mode the key name is the file stem after "<view>_".
      const renamed = {};
      for (const [k, kv] of Object.entries(keys)) renamed[`key_f${String(kv.src).padStart(3, "0")}`] = kv;
      keys = renamed;
      keyOfFrame.clear();
      for (const [k, kv] of Object.entries(keys)) for (const i of kv.frames) keyOfFrame.set(i, k);
    }
    map.views[v] = { keys };
    const anims = {};
    for (const [name, s] of Object.entries(per[v])) {
      const ks = new Set([...s].map((i) => keyOfFrame.get(i)));
      const distinct = new Set();
      for (const i of s) distinct.add(i);
      anims[name] = { frames: s.size, keys: ks.size };
    }
    report.views[v] = { grid: `${vm.w}x${vm.h}`, gifFrames: g.frames.length, usedFrames: usedAll.size, keys: Object.keys(keys).length, anims };
  }
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
  fs.writeFileSync(path.join(dir, "map.json"), JSON.stringify(map, null, 1).replace(/\[\s*([\d,\s]+?)\s*\]/g, (_, l) => `[${l.split(/[\s,]+/).join(", ")}]`) + "\n");
  printReport(report);
  return report;
}

function printReport(r) {
  console.log(`${r.id}: derived ${Object.entries(r.derive).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  for (const [k, v] of Object.entries(r.checks)) console.log(`  mirror check ${k}: ${v}`);
  for (const [v, s] of Object.entries(r.views)) {
    console.log(`  ${v}: grid ${s.grid}, gif ${s.gifFrames} frames, used ${s.usedFrames}, keys ${s.keys}`);
    console.log("    " + Object.entries(s.anims).map(([n, a]) => `${n} ${a.frames}→${a.keys}`).join("  "));
  }
}

// ---------------------------------------------------------------------------------------------
// check

function cmdCheck(id, { quiet = false } = {}) {
  const dir = dirOf(id);
  const errors = [], warnings = [];
  const meta = readJson(path.join(dir, "meta.json"));
  if (!meta) { console.error(`${id}: no ${path.join(dir, "meta.json")} (run export first)`); process.exit(1); }
  let map;
  try { map = readJson(path.join(dir, "map.json"), {}); } catch (e) { errors.push(`map.json: ${e.message}`); map = {}; }
  const { pal, errors: pe } = readPalette(dir);
  errors.push(...pe);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt") && f !== "palette.txt");
  let painted = 0;
  for (const f of files) {
    const m = /^(front|frontR|back|backR)_(.+)\.txt$/.exec(f);
    if (!m) { warnings.push(`${f}: not <view>_<key>.txt / <view>_f<iii>.txt, ignored`); continue; }
    const vm = meta.views[m[1]];
    if (!vm) { errors.push(`${f}: view ${m[1]} is not painted (meta.json views: ${Object.keys(meta.views).join(", ")})`); continue; }
    const rows = readGrid(path.join(dir, f));
    if (rows.length !== vm.h) errors.push(`${f}: ${rows.length} rows, expected ${vm.h}`);
    rows.forEach((r, y) => {
      if (r.length !== vm.w) errors.push(`${f}: row ${y + 1} has ${r.length} chars, expected ${vm.w}`);
      for (let x = 0; x < r.length; x++) if (r[x] !== "." && !pal.has(r[x])) errors.push(`${f}: row ${y + 1} col ${x + 1}: unknown char "${r[x]}"`);
    });
    // Body touching the canvas edge = no room left; the painter may need a bigger margin (re-export).
    const edge = rows.length && (/[^.]/.test(rows[0]) || /[^.]/.test(rows[rows.length - 1]) || rows.some((r) => r[0] !== "." || r[r.length - 1] !== "."));
    if (edge) warnings.push(`${f}: pixels on the grid border (fine, but nothing can go further out)`);
    painted++;
  }
  // map.json keys must have files.
  for (const [v, vv] of Object.entries((map && map.views) || {})) for (const [k, kv] of Object.entries(vv.keys || {})) {
    if (!fs.existsSync(path.join(dir, `${v}_${k}.txt`))) warnings.push(`map.json ${v}.${k}: no ${v}_${k}.txt (frames ${kv.frames.join(",")} stay converted)`);
    for (const i of kv.frames || []) if (!(i >= 0 && i < (meta.views[v] || {}).frames)) errors.push(`map.json ${v}.${k}: frame ${i} out of range`);
  }
  // Coverage: frames the build uses that would stay unpainted.
  if (!errors.length) {
    try {
      const ctx = context();
      const { entry } = dryBuild(id, ctx);
      const per = usedFrames(entry, meta.derive);
      for (const v of Object.keys(meta.views)) {
        const res = resolver(dir, map, v);
        const miss = new Set();
        for (const s of Object.values(per[v] || {})) for (const i of s) if (!res(i)) miss.add(i);
        if (miss.size) warnings.push(`${v}: used frames without a grid (converted pixels will show): ${[...miss].sort((a, b) => a - b).join(",")}`);
      }
      if (!quiet) console.log(`${id}: dry build OK, bodyH ${entry.bodyH} bodyW ${entry.bodyW}, painted frames ${entry.paint.frames || 0}`);
    } catch (e) { errors.push(`dry build failed: ${e.message}`); }
  }
  for (const w of warnings) console.log(`  warn: ${w}`);
  for (const e of errors.slice(0, 60)) console.log(`  ERROR: ${e}`);
  if (errors.length > 60) console.log(`  … ${errors.length - 60} more errors`);
  console.log(`${id}: ${painted} grid files, ${pal.size} colours, ${errors.length} errors, ${warnings.length} warnings`);
  if (errors.length) process.exitCode = 1;
  return errors.length === 0;
}

// ---------------------------------------------------------------------------------------------
// preview

function cmdPreview(id, args) {
  const b = B();
  const oi = args.indexOf("--out");
  let out = oi > 0 ? path.resolve(args[oi + 1]) : path.join(SCRATCH, `${id}.png`);
  if (!out.endsWith(".png")) out = path.join(out, `${id}.png`);
  const ctx = context();
  const { p, entry } = dryBuild(id, ctx);
  const sheets = {};
  for (const n of b.ANIM_ORDER) sheets[n] = b.renderSheet(entry, n);
  const { newImg, fill, blitScaled, bigText, encodePng, OUT } = b;
  const BG = [52, 56, 66], CELL = [86, 92, 106], LAB = [255, 230, 160], W = 1800;

  // Painted grids (or a note that nothing is painted yet).
  const dir = dirOf(id);
  const meta = readJson(path.join(dir, "meta.json"));
  const grids = [];
  if (meta) {
    const { pal } = readPalette(dir);
    const map = readJson(path.join(dir, "map.json"), {});
    for (const f of fs.readdirSync(dir).filter((f) => /^(front|frontR|back|backR)_.+\.txt$/.test(f))
      .sort((x, y) => (VIEW_ORDER.indexOf(x.split("_")[0]) - VIEW_ORDER.indexOf(y.split("_")[0])) || x.localeCompare(y, "en", { numeric: true }))) {
      const view = f.split("_")[0], key = f.slice(view.length + 1, -4);
      const vm = meta.views[view];
      if (!vm) continue;
      const rows = readGrid(path.join(dir, f));
      const img = newImg(vm.w, vm.h);
      rows.forEach((r, y) => { for (let x = 0; x < Math.min(r.length, vm.w); x++) { const c = pal.get(r[x]); if (c && y < vm.h) { const t = (y * vm.w + x) * 4; img.data[t] = c[0]; img.data[t + 1] = c[1]; img.data[t + 2] = c[2]; img.data[t + 3] = 255; } } });
      const kv = ((map.views || {})[view] || {}).keys || {};
      const n = kv[key] ? kv[key].frames.length : 1;
      grids.push({ label: `${view} ${key} X${n}`, img, vm });
    }
  }
  // PMD comparisons: base species, then 2 PMD entries of similar body size.
  const man = ctx.manifest;
  const pmdIdle = (pid) => {
    const r = man.pokemon[pid];
    const f = path.join(OUT, pid, "Idle.png");
    if (!r || !fs.existsSync(f)) return null;
    return { img: require("./pixelize").decodePng(f), w: r.anims.Idle.fw, h: r.anims.Idle.fh };
  };
  const cmp = [];
  const baseId = entry.target.base;
  if (baseId) { const it = pmdIdle(baseId); if (it) cmp.push({ label: `PMD ${baseId.replace(/^\d+_/, "")}`, ...it }); }
  const baseNum = id.slice(0, 4);
  const sim = Object.entries(man.pokemon)
    .filter(([k, r]) => !r.source && r.bodyH && !k.startsWith(baseNum) && fs.existsSync(path.join(OUT, k, "Idle.png")))
    .map(([k, r]) => ({ k, s: 2 * Math.abs(r.bodyH - entry.bodyH) + Math.abs(r.bodyW - entry.bodyW) + (k.includes("-") ? 0.5 : 0) }))
    .sort((a, c) => a.s - c.s || (a.k < c.k ? -1 : 1));
  const usedNum = new Set();
  for (const { k } of sim) {
    if (cmp.length >= (baseId ? 3 : 2)) break;
    if (usedNum.has(k.slice(0, 4))) continue;
    usedNum.add(k.slice(0, 4));
    const it = pmdIdle(k);
    if (it) cmp.push({ label: `PMD ${k.replace(/^\d+_/, "")} H${man.pokemon[k].bodyH}`, ...it });
  }

  const I = sheets.Idle;
  const lay = (img) => {
    let y = 8;
    const pi = entry.pixel;
    if (img) bigText(img, 8, y, `${id}  ${pi.painted ? `PAINTED ${pi.paintedFrames} FR` : "NOT PAINTED"}  BODY ${entry.bodyH}X${entry.bodyW}  COLORS ${pi.palette}  IDLE ${I.frames} FR`, [255, 255, 255]);
    y += 22;
    // Grids ×8 with a faint pixel grid.
    const G = 8;
    let x = 8, rowH = 0;
    for (const g of grids) {
      const w = g.vm.w * G, h = g.vm.h * G;
      if (x > 8 && x + w > W - 8) { x = 8; y += rowH + 8; rowH = 0; }
      if (img) {
        bigText(img, x, y, g.label, LAB);
        fill(img, x, y + 14, w, h, CELL);
        blitScaled(img, g.img, 0, 0, g.vm.w, g.vm.h, x, y + 14, G);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const onLine = xx % G === 0 || yy % G === 0;
          const inMargin = xx < meta.margin * G || yy < meta.margin * G || xx >= w - meta.margin * G || yy >= h - meta.margin * G;
          if (!onLine && !(inMargin && (xx + yy) % 6 === 0)) continue;
          const t = ((y + 14 + yy) * img.w + x + xx) * 4;
          for (let c = 0; c < 3; c++) img.data[t + c] = Math.round(img.data[t + c] * 0.8 + 255 * 0.2 * (onLine ? 1 : 0.6));
        }
      }
      x += Math.max(w, g.label.length * 8) + 16; rowH = Math.max(rowH, h + 14);
    }
    if (!grids.length && img) bigText(img, 8, y, "NO GRIDS - RUN EXPORT", [255, 120, 120]);
    y += (grids.length ? rowH : 14) + 16;
    // Idle S/E/N ×4 next to the PMD references ×4.
    const K = 4;
    x = 8; rowH = 0;
    const items = [
      ...[["IDLE S", 0], ["IDLE E", 2], ["IDLE N", 4]].map(([label, r]) => ({ label, img: I.img, sx: 0, sy: r * I.fh, w: I.fw, h: I.fh })),
      ...cmp.map((c) => ({ label: c.label, img: c.img, sx: 0, sy: 0, w: c.w, h: c.h })),
    ];
    for (const it of items) {
      const w = it.w * K, h = it.h * K;
      if (x > 8 && x + w > W - 8) { x = 8; y += rowH + 8; rowH = 0; }
      if (img) { bigText(img, x, y, it.label.replace(/_/g, " "), LAB); fill(img, x, y + 14, w, h, CELL); blitScaled(img, it.img, it.sx, it.sy, it.w, it.h, x, y + 14, K); }
      x += Math.max(w, it.label.length * 8) + 12; rowH = Math.max(rowH, h + 14);
    }
    y += rowH + 14;
    for (const n of b.ANIM_ORDER) {
      const s = sheets[n];
      if (img) bigText(img, 8, y, `${n} HIT ${s.hit ?? "-"} ${s.fw}X${s.fh} FR ${s.frames}`, LAB);
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
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Unique temp name + rename: safe with many agents previewing at once.
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, encodePng(img));
  fs.renameSync(tmp, out);
  console.log(`${id}: preview ${out} (${img.w}x${img.h}) ${entry.pixel.painted ? `painted ${entry.pixel.paintedFrames} frames` : "not painted"}, bodyH ${entry.bodyH}`);
  return out;
}

module.exports = { apply, readPalette, PAINT_DIR };

if (require.main === module) {
  const [cmd, id, ...rest] = process.argv.slice(2);
  const usage = "usage: node tools/pixel-paint.js export|preview|check <id> [options]";
  if (!cmd || !id) { console.error(usage); process.exit(2); }
  const ids = id.split(",");
  for (const one of ids) {
    if (cmd === "export") cmdExport(one, rest);
    else if (cmd === "preview") cmdPreview(one, rest);
    else if (cmd === "check") cmdCheck(one);
    else { console.error(usage); process.exit(2); }
  }
}
