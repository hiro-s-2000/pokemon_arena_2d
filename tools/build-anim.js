#!/usr/bin/env node
// Builds pokeAnim/ from the PMD SpriteCollab clone in .cache/SpriteCollab (CC BY-NC 4.0).
// For every roster entry in pokeData/index.json it picks the best sprite folder, copies the
// battle-relevant sheets, measures the body box / feet line from the pixels, and writes
// pokeAnim/manifest.json + manifest.js (window.POKE_ANIM) + CREDITS.md.
//
//   node tools/build-anim.js
//
// No npm dependencies: PNGs are decoded with zlib here. Overrides live in tools/anim-overrides/*.json
// as { "<roster id>": "<sprite path like 0006/0001>" | null } (null = no PMD art).
// Every roster id left without PMD art then gets sheets built from its pokeSprite GIFs by
// tools/build-gif-anim.js ("source": "gif-pixel" in the manifest, redrawn as PMD-style pixel art by tools/pixelize.js; tuning in tools/gif-anim-overrides/).
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const GifAnim = require("./build-gif-anim");
const Recolor = require("./build-recolor-anim");
const HandAnim = require("./build-hand-anim");

const ROOT = path.resolve(__dirname, "..");
const SC = path.join(ROOT, ".cache", "SpriteCollab");
const SPRITE_DIR = path.join(SC, "sprite");
const OUT = path.join(ROOT, "pokeAnim");
const OVERRIDE_DIR = path.join(__dirname, "anim-overrides");

const ANIMS = ["Idle", "Walk", "Attack", "Shoot", "SpAttack", "Charge", "Strike", "Hurt", "Faint"];
// Row order of the 8-direction sheets (verified visually on Charizard / Pikachu Walk sheets).
const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
// Subgroup names that are never battle art.
const BANNED = /(^|_)(Shiny|Altcolor|Cutscene|Beta|Temp|Skytemple)(_|$)/;

// ---------------------------------------------------------------------------------------------
// PNG decoding (non-interlaced; gray / RGB / palette / gray+alpha / RGBA; 1-16 bit). Returns
// { width, height, alpha: Uint8Array } — only alpha is needed for bounding boxes.

function decodePngAlpha(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (interlace) throw new Error(`interlaced PNG not supported: ${file}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (channels * depth) >> 3);           // bytes per pixel for filtering
  const stride = (width * channels * depth + 7) >> 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  // Sample n (0-based) of a row as an integer at the image bit depth.
  const sample = (row, n) => {
    if (depth === 8) return px[row * stride + n];
    if (depth === 16) return px.readUInt16BE(row * stride + n * 2);
    const bit = n * depth, byte = px[row * stride + (bit >> 3)];
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const max = (1 << depth) - 1;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 255;
      if (ctype === 6 || ctype === 4) a = sample(y, x * channels + channels - 1) * 255 / max;
      else if (ctype === 3) a = trns && sample(y, x) < trns.length ? trns[sample(y, x)] : 255;
      else if (ctype === 0 && trns) a = sample(y, x) === trns.readUInt16BE(0) ? 0 : 255;
      else if (ctype === 2 && trns) {
        const r = sample(y, x * 3), g = sample(y, x * 3 + 1), b = sample(y, x * 3 + 2);
        a = r === trns.readUInt16BE(0) && g === trns.readUInt16BE(2) && b === trns.readUInt16BE(4) ? 0 : 255;
      }
      alpha[y * width + x] = a;
    }
  }
  return { width, height, alpha };
}

// Content box of the first sheet row (S facing): max height/width over frames, lowest opaque line.
function measureRow0(png, fw, fh) {
  const frames = Math.floor(png.width / fw);
  let bodyH = 0, bodyW = 0, bottom = 0;
  for (let f = 0; f < frames; f++) {
    let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
    for (let y = 0; y < fh && y < png.height; y++) {
      for (let x = 0; x < fw; x++) {
        if (png.alpha[y * png.width + f * fw + x] < 16) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) continue;
    bodyH = Math.max(bodyH, y1 - y0 + 1);
    bodyW = Math.max(bodyW, x1 - x0 + 1);
    bottom = Math.max(bottom, y1 + 1);
  }
  return { bodyH, bodyW, anchorY: bottom || fh };
}

// ---------------------------------------------------------------------------------------------
// AnimData.xml (tiny regex parser; the files are machine-written and flat).

function readAnimData(dir) {
  const file = path.join(dir, "AnimData.xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const tag = (s, name) => { const m = s.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`)); return m ? m[1] : null; };
  const num = (s, name) => { const v = tag(s, name); return v == null ? null : Number(v); };
  const anims = {};
  for (const m of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const s = m[1];
    const name = tag(s, "Name");
    if (!name) continue;
    anims[name] = {
      copyOf: tag(s, "CopyOf"),
      fw: num(s, "FrameWidth"), fh: num(s, "FrameHeight"),
      rush: num(s, "RushFrame"), hit: num(s, "HitFrame"), ret: num(s, "ReturnFrame"),
      durations: [...s.matchAll(/<Duration>\s*(\d+)\s*<\/Duration>/g)].map(d => Number(d[1])),
    };
  }
  return { shadowSize: num(xml, "ShadowSize") ?? 1, anims };
}

// Follows CopyOf chains; returns the concrete anim record plus the sheet file it lives in.
function resolveAnim(dir, data, name) {
  let cur = name;
  for (let i = 0; i < 8 && data.anims[cur]; i++) {
    const a = data.anims[cur];
    if (a.copyOf) { cur = a.copyOf; continue; }
    const file = path.join(dir, `${cur}-Anim.png`);
    if (!a.fw || !a.fh || !a.durations.length || !fs.existsSync(file)) return null;
    return { ...a, file };
  }
  return null;
}

// Usable = has an Idle sheet that actually moves (several Idle frames, or at least a Walk).
// A few folders hold a single still Idle frame only (e.g. Gigantamax Charizard, Gouging Fire);
// those look worse than the animated GIF fallback, so they are treated as missing.
function hasIdle(src) {
  const dir = path.join(SPRITE_DIR, src);
  const data = readAnimData(dir);
  const idle = data && resolveAnim(dir, data, "Idle");
  return !!idle && (idle.durations.length > 1 || !!resolveAnim(dir, data, "Walk"));
}

// ---------------------------------------------------------------------------------------------
// Roster id → SpriteCollab folder.

const tracker = JSON.parse(fs.readFileSync(path.join(SC, "tracker.json"), "utf8"));
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "pokeData", "index.json"), "utf8")).pokemon;

const titleCase = s => s.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("_");

// Subgroup name candidates, best first. `partial` candidates are a close-but-not-exact form
// (e.g. Galar for Galarian Zen Darmanitan) and give exact:false.
function formCandidates(p) {
  const s = p.slug;
  if (p.category === "mega") {
    if (/-primal$/.test(s)) return [{ name: "Primal" }];
    const m = s.match(/^(.*?)-mega(?:-([xyz]))?$/);
    const suffix = m[2] ? `Mega_${m[2].toUpperCase()}` : "Mega";
    // Qualified megas: meowstic-female-mega, tatsugiri-droopy-mega, magearna-original-mega.
    const q = m[1].match(/-(female|male|curly|droopy|stretchy|original)$/);
    if (q && !["male", "curly"].includes(q[1])) return [{ name: `${titleCase(q[1])}_${suffix}` }];
    return [{ name: suffix }];
  }
  if (p.category === "gigantamax") {
    if (/rapid-strike/.test(s)) return [{ name: "Rapid_Strike_Gigantamax" }];
    if (/low-key/.test(s)) return [{ name: "Lowkey_Gigantamax" }];
    return [{ name: "Gigantamax" }];
  }
  if (p.category === "regional") {
    const region = s.match(/-(alola|galar|hisui|paldea)\b/)[1];
    const R = titleCase(region);
    const rest = s.slice(s.indexOf(`-${region}`) + region.length + 1).replace(/^-/, "").replace(/-breed$/, "").replace(/-standard$/, "");
    if (!rest || rest === "combat") return [{ name: R }];
    return [{ name: `${R}_${titleCase(rest)}` }, { name: R, partial: true }];
  }
  return []; // gen1..gen9 entries are the default form, which is the species root folder.
}

function findSubgroup(dex, name) {
  const e = tracker[dex];
  if (!e) return null;
  for (const [id, g] of Object.entries(e.subgroups)) {
    if (id === "0000" || BANNED.test(g.name)) continue;
    if (g.name.toLowerCase() === name.toLowerCase()) return `${dex}/${id}`;
  }
  return null;
}

// Forms whose base species art is a misleading stand-in: Gigantamax (different silhouette and
// scale) and Mega / Primal (the mega is the whole point of picking that roster slot, and the
// existing GIF already shows the right form). Those go to the GIF fallback instead.
function baseFallbackAllowed(p) {
  return p.category !== "gigantamax" && p.category !== "mega";
}

function pickSource(p) {
  const dex = String(p.dex).padStart(4, "0");
  const base = hasIdle(dex) ? dex : null;
  const cands = formCandidates(p);
  if (!cands.length) return base ? { src: base, exact: true, how: "exact" } : null;
  for (const c of cands) {
    const src = findSubgroup(dex, c.name);
    if (src && hasIdle(src)) return { src, exact: !c.partial, how: c.partial ? "partial" : "exact" };
  }
  if (base && baseFallbackAllowed(p)) return { src: base, exact: false, how: "base" };
  return null;
}

function loadOverrides() {
  const out = {};
  if (!fs.existsSync(OVERRIDE_DIR)) return out;
  for (const f of fs.readdirSync(OVERRIDE_DIR).filter(f => f.endsWith(".json")).sort()) {
    const o = JSON.parse(fs.readFileSync(path.join(OVERRIDE_DIR, f), "utf8"));
    for (const [k, v] of Object.entries(o)) if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Credits.

function loadCreditNames() {
  const names = {};
  const file = path.join(SC, "credit_names.txt");
  if (!fs.existsSync(file)) return names;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).slice(1)) {
    const [name, discord] = line.split("\t");
    if (name && discord) names[discord.trim()] = name.trim();
  }
  return names;
}

function folderCredits(src, creditNames) {
  const file = path.join(SPRITE_DIR, src, "credits.txt");
  if (!fs.existsSync(file)) return [];
  const seen = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const who = line.split("\t")[1];
    if (!who) continue;
    const name = creditNames[who.trim()] || who.trim();
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------

function build() {
  const overrides = loadOverrides();
  const creditNames = loadCreditNames();
  fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(OUT, { recursive: true });

  const manifest = { version: 1, dirs: DIRS, pokemon: {} };
  const stats = {};
  const credits = [];
  const fallbacks = [];

  for (const p of roster) {
    const st = stats[p.category] || (stats[p.category] = { exact: 0, partial: 0, base: 0, none: 0, override: 0 });
    let pick;
    if (p.id in overrides) {
      pick = overrides[p.id] && hasIdle(overrides[p.id]) ? { src: overrides[p.id], exact: true, how: "override" } : null;
      st.override++;
    } else pick = pickSource(p);
    if (!pick) { if (!(p.id in overrides)) st.none++; fallbacks.push(`${p.id} → GIF`); continue; }
    if (pick.how !== "override") st[pick.how]++;
    if (pick.how === "base" || pick.how === "partial") fallbacks.push(`${p.id} → ${pick.src} (${pick.how})`);

    const dir = path.join(SPRITE_DIR, pick.src);
    const data = readAnimData(dir);
    const outDir = path.join(OUT, p.id);
    fs.mkdirSync(outDir, { recursive: true });
    const rec = { src: pick.src, exact: pick.exact, shadowSize: data.shadowSize, bodyH: 0, bodyW: 0, anims: {} };
    for (const name of ANIMS) {
      const a = resolveAnim(dir, data, name);
      if (!a) continue;
      fs.copyFileSync(a.file, path.join(outDir, `${name}.png`));
      const png = decodePngAlpha(a.file);
      const m = measureRow0(png, a.fw, a.fh);
      rec.anims[name] = {
        file: `../pokeAnim/${p.id}/${name}.png`,
        fw: a.fw, fh: a.fh,
        frames: Math.floor(png.width / a.fw),
        rows: Math.floor(png.height / a.fh),
        durations: a.durations,
        hit: a.hit, rush: a.rush, ret: a.ret,
        anchorY: m.anchorY,
      };
      if (name === "Idle") { rec.bodyH = m.bodyH; rec.bodyW = m.bodyW; }
    }
    manifest.pokemon[p.id] = rec;
    credits.push({ id: p.id, name: p.name, src: pick.src, authors: folderCredits(pick.src, creditNames) });
  }

  // Forms listed in tools/recolor-overrides.json get their base form's PMD sheets recoloured.
  const recolorCredits = Recolor.build({ manifest, roster });
  // Forms with hand-drawn key sprites in tools/hand-sprites/ (replaces any recolour above).
  const handCredits = HandAnim.build({ manifest, roster });
  // Roster ids still without an entry get sheets made from their GIFs.
  const gifCredits = GifAnim.build({ manifest, roster });
  GifAnim.writeManifest(manifest);
  writeCredits(credits, gifCredits, recolorCredits.filter((c) => !handCredits.some((h) => h.id === c.id)), handCredits);
  writeReadme();

  console.log("category      exact partial  base  none override");
  const tot = { exact: 0, partial: 0, base: 0, none: 0, override: 0 };
  for (const [cat, s] of Object.entries(stats)) {
    console.log(`${cat.padEnd(12)} ${String(s.exact).padStart(6)} ${String(s.partial).padStart(7)} ${String(s.base).padStart(5)} ${String(s.none).padStart(5)} ${String(s.override).padStart(8)}`);
    for (const k in tot) tot[k] += s[k];
  }
  console.log(`${"total".padEnd(12)} ${String(tot.exact).padStart(6)} ${String(tot.partial).padStart(7)} ${String(tot.base).padStart(5)} ${String(tot.none).padStart(5)} ${String(tot.override).padStart(8)}`);
  if (process.argv.includes("-v")) console.log(fallbacks.join("\n"));
}

function writeCredits(list, gifList = [], recolorList = [], handList = []) {
  const lines = [
    "# Pokémon animation credits",
    "",
    "The sprite sheets in this folder come from the **PMD Sprite Repository (SpriteCollab)**,",
    "https://github.com/PMDCollab/SpriteCollab, and are licensed under",
    "[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).",
    "Non-commercial use only. Sheets were copied unmodified (only renamed); \"CHUNSOFT\" marks",
    "art ripped from the original Pokémon Mystery Dungeon games. Pokémon © Nintendo / Creatures / GAME FREAK.",
    "",
    "| Roster id | Pokémon | SpriteCollab folder | Artists |",
    "|---|---|---|---|",
  ];
  for (const c of list) lines.push(`| ${c.id} | ${c.name} | sprite/${c.src} | ${c.authors.join(", ").replace(/\|/g, "/")} |`);
  lines.push(...Recolor.creditLines(recolorList));
  lines.push(...HandAnim.creditLines(handList));
  lines.push(...GifAnim.creditLines(gifList));
  fs.writeFileSync(path.join(OUT, "CREDITS.md"), lines.join("\n") + "\n");
}

function writeReadme() {
  fs.writeFileSync(path.join(OUT, "README.md"), `# pokeAnim

PMD SpriteCollab のスプライトシート（手足が動くアニメーション＋攻撃モーション）と、
PMD の絵が無いポケモン用に pokeSprite の GIF から PMD 風ドット絵に変換して作ったシート（manifest で \`"source": "gif-pixel"\`）。
ロスター 1216 体すべてにシートがあり、そのうち 144 体（メガ 56・キョダイマックス 34・その他 54）が GIF 由来。
**このフォルダは自動生成物です。手で編集しないでください。**

## 再生成

1. SpriteCollab を \`.cache/SpriteCollab\` に clone（sparse で \`sprite/\`, \`tracker.json\`, \`credit_names.txt\` があれば OK）
2. プロジェクト直下で \`node tools/build-anim.js\`（\`-v\` でフォールバック一覧も表示）。PMD の後に GIF 由来のシートも自動で作り直す
3. GIF 由来の 1 体だけ作り直す: \`node tools/build-gif-anim.js --only <ロスターid>\`（\`--review <dir>\` でコマ選び用コンタクトシート、\`--pixel-review <dir>\` でドット絵確認シートも出力）

## 中身

- \`<ロスターid>/{Idle,Walk,Attack,Shoot,SpAttack,Charge,Strike,Hurt,Faint}.png\` — 元シートをそのままコピー（CopyOf は解決済み、存在するものだけ）
- \`manifest.json\` / \`manifest.js\` — \`window.POKE_ANIM\`。行の向きは \`dirs\`（S, SE, E, NE, N, NW, W, SW）
- \`CREDITS.md\` — 作者クレジットとライセンス（CC BY-NC 4.0、非営利のみ）

## フォルダ選択のルール

- 通常種 → \`sprite/<図鑑番号>\`
- メガ／ゲンシ／キョダイ／リージョン → 同名のサブグループ（Mega, Mega_X, Gigantamax, Galar, Paldea_Aqua …）
- Shiny / Altcolor / Cutscene / Beta / Temp は自動では使わない（目視確認のうえ overrides で指定したものは例外。例: ニドラン♂ の Altcolor（本編と同じ紫）、ディンルー の Temp、ミライドン の Low_Power）
- フォームの絵が無い場合：リージョンは近いフォーム or 基本種の絵（exact:false）。メガ・キョダイは基本種で代用すると別物に見えるので使わず、下記の GIF 由来シートを作る
- 個別に変えたいときは \`tools/anim-overrides/*.json\` に \`{"0006_charizard-gmax": "0006/0003"}\`（null で PMD を使わない）を書いて再ビルド

## 色替えシート（\`"source": "recolor"\`）

- PMD の絵が無いメガ・キョダイマックスのうち、元の姿に PMD の絵があるものは \`tools/build-recolor-anim.js\` が元の姿のシートを
  そのフォームの色に塗り替えて使う（形は元の姿のまま、PMD と同じ品質と全モーション）。対象は \`tools/recolor-overrides.json\`
- 色は元の姿とフォームの pokeSprite GIF の色の差から自動で決める。1 体ずつ直すときは \`tools/recolor-maps/<id>.json\` に
  \`{"map": {"元の色hex": "新しい色hex"}}\` を書く。\`node tools/build-recolor-anim.js --only <id> --review <dir>\` で確認（書き込みなし）
- \`tools/recolor-hand/<id>/\` に手描きのシートがあればそれをそのまま使う（例: メガリザードンY）

## GIF 由来のシート（\`"source": "gif-pixel"\`）

- PMD の絵が無いロスター（メガ・キョダイマックスの大半、一部の第5世代以降）は \`tools/build-gif-anim.js\` が
  \`pokeSprite/\` の front / front-reverse / back / back-reverse.gif から同じ形式（8 行・固定 fw×fh）のシートを作る
- GIF の全コマはまず \`tools/pixelize.js\` で PMD 風ドット絵に変換される: PMD の体高（基本種に PMD の絵があればその画素密度、
  無ければ高さからの回帰）まで面積の多数決で縮小し、全コマ・全方向共通の約 12 色パレットに減色（ディザなし）、
  GIF 自身の線を内側の線として残し、シルエットの外側に 1px の黒い輪郭を付ける。プロポーションは GIF のまま（変形なし）。
  パラメータは manifest の \`pixel\`（高さ・倍率・色数など）に記録される
- 行の割り当て: S・SW・W ← front.gif（左下向き）、SE・E ← front-reverse.gif（右下向き）、NE ← back.gif（右奥）、N・NW ← back-reverse.gif（左奥）
- Idle は GIF のアニメーションそのまま（タイミングも GIF の delay から変換）。技のエフェクトが描き込まれた短い GIF（第6世代以降の 19〜20 コマ）は
  エフェクトの無いコマだけで待機を作る（\`tools/gif-anim-overrides/zz-calm-idle.json\`）。他の動きは GIF のコマを選んで
  ピクセル単位で平行移動（踏み込み・反動・ホップ・沈み込み）と白フラッシュを付けたもので、絵の変形はしていない
- コマ選びや踏み込み量は \`tools/gif-anim-overrides/*.json\` で 1 体ずつ調整できる（書式は同フォルダの README.md）。
  直したら \`node tools/build-gif-anim.js --only <id> --review <dir>\` で作り直し、\`<dir>/<id>.png\` のコンタクトシートで確認する
- ドット絵の見た目も同じ JSON で 1 体ずつ調整できる: \`pixelHeight\`（体の高さ px）、\`colors\`（色数）、
  \`innerLines\` / \`lineWeight\`（GIF の線を黒い線にするしきい値と重み。上げるほど黒線が減る。黒っぽく潰れるときは innerLines を上げ lineWeight を下げる）、
  \`paletteFrom\`（色を寄せる PMD の種。null で GIF の色のまま）、\`speckSize\` / \`speckContrast\`（細かいノイズの除去）、
  \`darkLift\`（暗い体を輪郭より明るくする）、\`outlineInner\`（色の境目にも暗い線）など。
  \`--pixel-review <dir>\` の確認シート（基本種の PMD 絵・変換後の待機 S/E/N・元 GIF・パレット・全モーション）で見比べる
- \`lungePx\` / \`hopPx\` などの移動量は変換後の PMD ピクセル単位
- 複数の \`--only\` を同時に走らせない（manifest.json を読み書きするので、後から終わった方が先の結果を上書きする）
`);
}

build();
