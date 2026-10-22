#!/usr/bin/env python3
"""Build pokeAnim sheets from a pokeSprite front.png and back.png.

Pixels come only from those two PNGs. Nearest-neighbor copies, a 1px squash
when the ROM pose changes, and whole-sprite integer offsets. No box filter,
no redraw, no write into pokeAnim or pokeSprite.

Motion is the measured Pokémon Mystery Dungeon: Red Rescue Team (Japan) ax
grammar. Each animation slot is 8 direction sequences. Each step is 12 bytes:
duration (1/60 s, 0 ends the sequence), flags, pose id, offset x, offset y,
shadow x, shadow y. Negative y is up. Direction order is South, Southeast,
East, Northeast, North, Northwest, West, Southwest — the same order as
game/js/sprites.js dirRow.

The arena names use these ROM slots, measured on ax001 / ax006 / ax025:

    Walk 0, Attack 1, Strike 2, Shoot 3, SpAttack 4,
    Faint 5 (the ROM's long two-pose sleep), Hurt 6, Idle 7, Charge 11.

Slot 5 is sleep in the ROM. The arena has Faint and no Sleep, so Faint keeps
that slot's holds. Do not run tools/build-anim.js: it deletes pokeAnim.

    /tmp/poke-venv/bin/python tools/build-sprite-anim.py --id 0001_bulbasaur
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ROM_PATH = Path(
    "/Users/honmahiroshi/Desktop/claude_workspace/あまり触らない。/rom_analytics/rom/"
    "Pocket Monsters - Fushigi no Dungeon Aka no Kyuujotai (Japan).gba"
)
REVIEW_OUT = Path("/Users/honmahiroshi/Desktop/claude_workspace/確認用画像/pmd_sprite_anim")
SERVE_OUT = ROOT / "sprite-anim-preview"

DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]
# Arena sheet name → ROM animation slot.
SLOTS = {
    "Walk": 0,
    "Attack": 1,
    "Strike": 2,
    "Shoot": 3,
    "SpAttack": 4,
    "Faint": 5,
    "Hurt": 6,
    "Idle": 7,
    "Charge": 11,
}
HIT_NAMES = {"Attack", "Strike", "Shoot", "SpAttack", "Charge"}
SHEET_NAMES = ["Idle", "Walk", "Attack", "Shoot", "SpAttack", "Strike", "Charge", "Hurt", "Faint"]

PKSDIR = 0x514000
PKSDIR_ENTRIES = 0x514018
PKSDIR_COUNT = 497
MONSPARA = 0x0355140
MON_RECORD = 72
PALET_FILE = 0x16C142C

OBJ_SIZE = {
    (0, 0): (8, 8), (0, 1): (16, 16), (0, 2): (32, 32), (0, 3): (64, 64),
    (1, 0): (16, 8), (1, 1): (32, 8), (1, 2): (32, 16), (1, 3): (64, 32),
    (2, 0): (8, 16), (2, 1): (8, 32), (2, 2): (16, 32), (2, 3): (32, 64),
}


def die(msg: str) -> None:
    raise SystemExit(msg)


def assert_safe(path: Path) -> Path:
    path = path.resolve()
    if "pokeAnim" in path.parts or "pokeSprite" in path.parts:
        die(f"refusing to write inside {path}")
    return path


def u32(buf: bytes, off: int) -> int:
    return struct.unpack_from("<I", buf, off)[0]


def s32(buf: bytes, off: int) -> int:
    return struct.unpack_from("<i", buf, off)[0]


def u16(buf: bytes, off: int) -> int:
    return struct.unpack_from("<H", buf, off)[0]


def s16(buf: bytes, off: int) -> int:
    return struct.unpack_from("<h", buf, off)[0]


def s8(v: int) -> int:
    return v - 256 if v >= 128 else v


def gba(ptr: int, n: int) -> int | None:
    if not (0x08000000 <= ptr < 0x0A000000):
        return None
    off = ptr - 0x08000000
    if off < 0 or off >= n:
        return None
    return off


def load_rom_curves(ax: int) -> dict:
    if not ROM_PATH.is_file():
        die(f"ROM not found: {ROM_PATH}")
    rom = ROM_PATH.read_bytes()
    if rom[PKSDIR:PKSDIR + 7] != b"pksdir0":
        die("pksdir0 magic missing; this is not the measured JP archive")
    name = f"ax{ax:03d}".encode()
    file_off = None
    for i in range(PKSDIR_COUNT):
        np = u32(rom, PKSDIR_ENTRIES + i * 8)
        dp = u32(rom, PKSDIR_ENTRIES + i * 8 + 4)
        no = gba(np, len(rom))
        if no is None:
            continue
        end = rom.find(b"\x00", no, no + 16)
        if rom[no:end] == name:
            file_off = gba(dp, len(rom))
            break
    if file_off is None:
        die(f"{name.decode()} is not in the graphics directory")
    if rom[file_off:file_off + 4] != b"SIRO":
        die(f"{name.decode()} is not SIRO")
    content = gba(u32(rom, file_off + 4), len(rom))
    if content is None:
        die("SIRO pointer is outside the ROM")
    pose_tbl = gba(u32(rom, content), len(rom))
    anim_tbl = gba(u32(rom, content + 4), len(rom))
    anim_count = u32(rom, content + 8)
    spr_tbl = gba(u32(rom, content + 0x0C), len(rom))
    positions = gba(u32(rom, content + 0x10), len(rom))
    if None in (pose_tbl, anim_tbl, spr_tbl, positions) or content < spr_tbl or positions < pose_tbl:
        die("axmain pointers are not usable")

    sprites = []
    for i in range((content - spr_tbl) // 4):
        rec = gba(u32(rom, spr_tbl + i * 4), len(rom))
        if rec is None:
            sprites.append(None)
            continue
        gfx = gba(u32(rom, rec), len(rom))
        bc = s32(rom, rec + 4)
        sprites.append((gfx, bc) if gfx is not None and 0 < bc <= 2_000_000 else None)

    # The pose pointer array has no terminator. ax001 happens to be followed by
    # 0xFFFFFFFF; ax006 and ax025 are followed by 0xFFF6FFFF, so a scan walks
    # into the next table. Length is the span up to the positions pointer.
    nposes = (positions - pose_tbl) // 4

    def read_seq(off: int) -> list[dict]:
        steps = []
        for i in range(80):
            o = off + i * 12
            dur = rom[o]
            if dur == 0:
                return steps
            flag = rom[o + 1]
            pose = s16(rom, o + 2)
            ox, oy = s16(rom, o + 4), s16(rom, o + 6)
            if not (0 <= pose < nposes) or abs(ox) > 80 or abs(oy) > 80:
                die(f"sequence at {o:#x} is not an ax step (pose {pose})")
            steps.append({"t": dur, "flag": flag, "pose": pose, "x": ox, "y": oy})
        die(f"sequence at {off:#x} has no terminator")

    slots = {}
    for ai in range(anim_count):
        group = gba(u32(rom, anim_tbl + ai * 4), len(rom))
        dirs = []
        for d in range(8):
            seq = gba(u32(rom, group + d * 4), len(rom))
            if seq is None:
                die(f"anim {ai} dir {d} is not a pointer")
            dirs.append(read_seq(seq))
        slots[str(ai)] = {"dirs": dirs}

    body_h = measure_body(rom, sprites, pose_tbl, ax)
    return {"ax": ax, "romBodyH": body_h, "animCount": anim_count, "poses": nposes, "slots": slots}


def measure_body(rom: bytes, sprites: list, pose_tbl: int, ax: int) -> int:
    """Opaque height of pose 0, in GBA pixels. Offsets are in this space."""
    pal_i = rom[MONSPARA + ax * MON_RECORD + 8]
    canvas = 96
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    px = img.load()
    anchor = canvas // 2
    po = gba(u32(rom, pose_tbl), len(rom))
    parts = 0
    while parts < 8:
        sid = s16(rom, po)
        if sid < 0:
            break
        if sid >= len(sprites) or sprites[sid] is None:
            po += 10
            parts += 1
            continue
        a0, a1, a2 = u16(rom, po + 4), u16(rom, po + 6), u16(rom, po + 8)
        shape, size = (a0 >> 14) & 3, (a1 >> 14) & 3
        hflip, vflip = (a1 >> 12) & 1, (a1 >> 13) & 1
        tile = a2 & 0x3FF
        x, y = s8(a1 & 0xFF), s8(a0 & 0xFF)
        tw, th = OBJ_SIZE[(shape, size)]
        gfx, bc = sprites[sid]
        start = tile * 32 if tile * 32 < bc else 0
        tx_n, ty_n = tw // 8, th // 8
        for ty in range(ty_n):
            for tx in range(tx_n):
                toff = gfx + start + (ty * tx_n + tx) * 32
                if toff + 32 > gfx + bc:
                    continue
                for py in range(8):
                    for bx in range(4):
                        b = rom[toff + py * 4 + bx]
                        for bit, nib in ((0, b & 15), (1, b >> 4)):
                            if nib == 0:
                                continue
                            sx = tx * 8 + bx * 2 + bit
                            sy = py
                            dx = tw - 1 - sx if hflip else sx
                            dy = th - 1 - (ty * 8 + sy) if vflip else ty * 8 + sy
                            X, Y = anchor + x + dx, anchor + y + dy
                            if 0 <= X < canvas and 0 <= Y < canvas:
                                px[X, Y] = (255, 255, 255, 255)
        po += 10
        parts += 1
    ys = [y for y in range(canvas) if any(px[x, y][3] for x in range(canvas))]
    if not ys:
        return 24
    return ys[-1] - ys[0] + 1


def find_sprite_dir(species_id: str, form: str) -> Path:
    hits = sorted((ROOT / "pokeSprite").glob(f"*/{species_id}/{form}/front.png"))
    if not hits:
        die(f"no pokeSprite front.png for {species_id}/{form}")
    folder = hits[0].parent
    if not (folder / "back.png").is_file():
        die(f"missing back.png in {folder}")
    return folder


def harden(im: Image.Image) -> Image.Image:
    """Alpha below 16 becomes clear. Every other pixel stays, at alpha 255."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    colors = set()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 16:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, 255)
                colors.add((r, g, b))
    if len(colors) > 15:
        im = snap_colors(im, colors)
    return im


def snap_colors(im: Image.Image, colors: set[tuple[int, int, int]]) -> Image.Image:
    """Keep the 15 most common colors. Other pixels snap to the nearest kept color."""
    px = im.load()
    w, h = im.size
    counts: dict[tuple[int, int, int], int] = {c: 0 for c in colors}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a:
                counts[(r, g, b)] += 1
    kept = [c for c, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:15]]

    def nearest(c: tuple[int, int, int]) -> tuple[int, int, int]:
        return min(kept, key=lambda k: (k[0] - c[0]) ** 2 + (k[1] - c[1]) ** 2 + (k[2] - c[2]) ** 2)

    table = {c: nearest(c) for c in colors}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (*table[(r, g, b)], 255)
    return im


def crop_opaque(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    if bbox is None:
        die("sprite has no opaque pixels")
    return im.crop(bbox)


def face_sign(im: Image.Image) -> int:
    """+1 if the red eye mass sits on the right of the body, else -1."""
    px = im.load()
    w, h = im.size
    body = []
    eyes = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            body.append(x)
            if r > 160 and g < 120 and b < 120:
                eyes.append(x)
    if not body:
        return -1
    cx = sum(body) / len(body)
    if not eyes:
        return -1
    return 1 if (sum(eyes) / len(eyes)) > cx else -1


def squash(im: Image.Image, drop: int) -> Image.Image:
    """Delete `drop` upper-middle rows and bottom-align the rest. Feet stay."""
    if drop <= 0:
        return im.copy()
    w, h = im.size
    src = im.load()
    rows = [y for y in range(h) if any(src[x, y][3] for x in range(w))]
    if len(rows) < drop + 4:
        return im.copy()
    top, bot = rows[0], rows[-1]
    span = bot - top + 1
    kills = []
    for i in range(drop):
        y = top + int(span * (0.35 + 0.12 * i))
        if top < y < bot and y not in kills:
            kills.append(y)
    if not kills:
        return im.copy()
    killset = set(kills)
    kept = [y for y in range(top, bot + 1) if y not in killset]
    out = im.copy()
    dst = out.load()
    for y in range(top, bot + 1):
        for x in range(w):
            dst[x, y] = (0, 0, 0, 0)
    dest0 = bot - len(kept) + 1
    for i, sy in enumerate(kept):
        for x in range(w):
            dst[x, dest0 + i] = src[x, sy]
    return out


def scale_off(v: int, scale: float) -> int:
    if v == 0:
        return 0
    s = int(round(v * scale))
    if s == 0:
        s = 1 if v > 0 else -1
    return s


def build_facings(front: Image.Image, back: Image.Image) -> list[Image.Image]:
    """S and N are the real front and back. Sides are mirrors so east faces right."""
    front_sign = face_sign(front)
    # East must face screen-right. Flip the front when its eyes are on the left.
    east = front.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if front_sign < 0 else front
    west = front if front_sign < 0 else front.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    back_sign = face_sign(back)
    ne = back if back_sign > 0 else back.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    nw = back.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if back_sign > 0 else back
    by_dir = {
        "S": front,
        "SE": east,
        "E": east,
        "NE": ne,
        "N": back,
        "NW": nw,
        "W": west,
        "SW": west,
    }
    return [by_dir[d] for d in DIRS]


def variants_for(base: Image.Image) -> list[Image.Image]:
    return [base, squash(base, 1), squash(base, 2)]


def pose_variant(steps: list[dict], index: int) -> int:
    order = []
    for step in steps:
        if step["pose"] not in order:
            order.append(step["pose"])
    return order.index(steps[index]["pose"]) % 3


def hit_index(steps: list[dict]) -> int | None:
    for i, step in enumerate(steps):
        if step["flag"] == 2:
            return i
    for i, step in enumerate(steps):
        if step["flag"] == 1:
            return i
    return None


def compose(curves: dict, front: Image.Image, back: Image.Image) -> tuple[dict, dict[str, Image.Image]]:
    body = curves["romBodyH"]
    facings = build_facings(front, back)
    crops = [crop_opaque(im) for im in facings]
    scale = crops[0].size[1] / body
    posed = [variants_for(c) for c in crops]

    scaled_slots = {}
    min_ox = max_ox = min_oy = max_oy = 0
    for name, slot in SLOTS.items():
        key = str(slot)
        if key not in curves["slots"]:
            die(f"ROM ax has no animation slot {slot} for {name}")
        dirs = []
        for d, steps in enumerate(curves["slots"][key]["dirs"]):
            out_steps = []
            for i, step in enumerate(steps):
                ox, oy = scale_off(step["x"], scale), scale_off(step["y"], scale)
                min_ox, max_ox = min(min_ox, ox), max(max_ox, ox)
                min_oy, max_oy = min(min_oy, oy), max(max_oy, oy)
                out_steps.append({
                    "t": step["t"], "flag": step["flag"], "pose": step["pose"],
                    "x": ox, "y": oy, "variant": pose_variant(steps, i),
                })
            dirs.append(out_steps)
        scaled_slots[name] = dirs

    max_sw = max(c.size[0] for c in crops)
    max_sh = max(c.size[1] for c in crops)
    margin = 2
    side = margin + max(-min_ox, max_ox, 0)
    top = margin + max(-min_oy, 0)
    bot = margin + max(max_oy, 0)
    fw = max_sw + side * 2
    fh = max_sh + top + bot
    anchor_y = top + max_sh

    sheets = {}
    meta = {}
    for name in SHEET_NAMES:
        dirs = scaled_slots[name]
        frames = len(dirs[0])
        if any(len(d) != frames for d in dirs):
            die(f"{name} directions do not share a frame count")
        sheet = Image.new("RGBA", (fw * frames, fh * 8), (0, 0, 0, 0))
        for d, steps in enumerate(dirs):
            for i, step in enumerate(steps):
                sprite = posed[d][step["variant"]]
                sw, sh = sprite.size
                x = (fw - sw) // 2 + step["x"]
                y = anchor_y - sh + step["y"]
                cell = sheet.crop((i * fw, d * fh, (i + 1) * fw, (d + 1) * fh))
                cell.paste(sprite, (x, y), sprite)
                sheet.paste(cell, (i * fw, d * fh))
                if step["variant"] == 0:
                    opaque = sum(1 for p in sprite.getdata() if p[3])
                    pasted = sum(1 for p in cell.getdata() if p[3])
                    if pasted != opaque:
                        die(f"{name} dir {d} frame {i} clipped ({pasted} != {opaque})")
        hit = hit_index(curves["slots"][str(SLOTS[name])]["dirs"][0]) if name in HIT_NAMES else None
        sheets[name] = sheet
        meta[name] = {
            "file": f"{name}.png",
            "fw": fw, "fh": fh, "frames": frames, "rows": 8,
            "durations": [s["t"] for s in dirs[0]],
            "hit": hit, "rush": None, "ret": None, "anchorY": anchor_y,
            "romSlot": SLOTS[name],
        }
    # Body box of the resting south idle, for the game's scale.
    idle = meta["Idle"]
    rest = sheets["Idle"].crop((0, 0, fw, fh))
    bbox = rest.getbbox()
    body_w = bbox[2] - bbox[0] if bbox else fw
    body_h = bbox[3] - bbox[1] if bbox else fh
    fragment = {
        "dirs": DIRS,
        "bodyW": body_w,
        "bodyH": body_h,
        "shadowSize": 1,
        "foot": "anchorY - fh/2, from Idle only",
        "scaleFromRom": round(scale, 4),
        "romBodyH": body,
        "anims": meta,
    }
    return fragment, sheets


def write_contact(folder: Path, sheets: dict[str, Image.Image], fragment: dict) -> None:
    fw, fh = fragment["anims"]["Idle"]["fw"], fragment["anims"]["Idle"]["fh"]
    zoom = 3
    groups = [("facings", "Idle", list(range(8)), [0])]
    groups += [(name, name, [0], list(range(fragment["anims"][name]["frames"]))) for name in ("Idle", "Walk", "Attack", "Hurt", "Faint")]
    groups.append(("east-walk", "Walk", [2], list(range(fragment["anims"]["Walk"]["frames"]))))
    rows = []
    width = 0
    for _, name, dir_list, frame_list in groups:
        sheet = sheets[name]
        cells = []
        for d in dir_list:
            for f in frame_list:
                cell = sheet.crop((f * fw, d * fh, (f + 1) * fw, (d + 1) * fh))
                cells.append(cell.resize((fw * zoom, fh * zoom), Image.Resampling.NEAREST))
        gap = 8
        row_w = sum(c.size[0] for c in cells) + gap * (len(cells) - 1)
        row_h = cells[0].size[1]
        row = Image.new("RGBA", (row_w, row_h), (32, 32, 36, 255))
        x = 0
        for c in cells:
            row.paste(c, (x, 0), c)
            x += c.size[0] + gap
        rows.append(row)
        width = max(width, row_w)
    gap_y = 10
    height = sum(r.size[1] for r in rows) + gap_y * (len(rows) - 1)
    contact = Image.new("RGBA", (width, height), (24, 24, 28, 255))
    y = 0
    for row in rows:
        contact.paste(row, (0, y))
        y += row.size[1] + gap_y
    contact.save(folder / "contact.png")


PREVIEW = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>sprite to pokeAnim preview</title>
<style>
  body { margin: 0; background: #1b1b22; color: #eee; font: 14px/1.4 sans-serif; }
  header { padding: 12px 16px; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; padding: 0 16px 24px; }
  canvas { background: #2a2a34; image-rendering: pixelated; }
  button { margin: 2px; }
  button.on { background: #ead36a; }
</style>
</head>
<body>
<header>
  <div id="title"></div>
  <div id="dirs"></div>
</header>
<div class="row" id="stage"></div>
<script>
const Z = 3;
const DIRS = ["S","SE","E","NE","N","NW","W","SW"];
let row = 0;
let meta, images;

function feetOf(idle) { return idle.anchorY - idle.fh / 2; }

async function main() {
  meta = await (await fetch("manifest-fragment.json")).json();
  const idle = meta.anims.Idle;
  const foot = feetOf(idle);
  document.getElementById("title").textContent =
    meta.id + "  body " + meta.bodyW + "x" + meta.bodyH +
    "  cell " + idle.fw + "x" + idle.fh +
    "  foot " + foot + "  (Idle.anchorY - fh/2)";
  const bar = document.getElementById("dirs");
  DIRS.forEach((d, i) => {
    const b = document.createElement("button");
    b.textContent = d;
    b.className = i === 0 ? "on" : "";
    b.onclick = () => { row = i; [...bar.children].forEach((c, k) => c.className = k === i ? "on" : ""); };
    bar.appendChild(b);
  });
  images = {};
  const stage = document.getElementById("stage");
  const views = [];
  for (const name of Object.keys(meta.anims)) {
    const a = meta.anims[name];
    const img = new Image();
    img.src = "normal/" + a.file;
    images[name] = img;
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.textContent = name;
    const canvas = document.createElement("canvas");
    canvas.width = 180; canvas.height = 210;
    wrap.append(label, canvas);
    stage.appendChild(wrap);
    views.push({ name, canvas, t0: performance.now() });
  }
  await Promise.all(Object.values(images).map(img => img.decode()));
  const loop = new Set(["Idle", "Walk"]);
  function frame() {
    const now = performance.now();
    for (const v of views) {
      const a = meta.anims[v.name];
      const ctx = v.canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
      const total = a.durations.reduce((s, d) => s + d, 0) / 60;
      let t = (now - v.t0) / 1000;
      if (loop.has(v.name)) t = total ? t % total : 0;
      else t = Math.min(t, Math.max(0, total - 1 / 60));
      let acc = 0, i = a.frames - 1;
      for (let k = 0; k < a.frames; k++) { acc += a.durations[k] / 60; if (t < acc) { i = k; break; } }
      const foot = feetOf(meta.anims.Idle);
      const ax = a.fw / 2, ay = a.fh / 2 + foot;
      const dx = 90 - ax * Z, dy = 150 - ay * Z;
      ctx.drawImage(images[v.name], i * a.fw, row * a.fh, a.fw, a.fh, dx, dy, a.fw * Z, a.fh * Z);
      ctx.strokeStyle = "#3dba7a";
      ctx.beginPath(); ctx.moveTo(20, 150); ctx.lineTo(160, 150); ctx.stroke();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main();
</script>
</body>
</html>
"""


def color_count(im: Image.Image) -> int:
    return len({p[:3] for p in im.getdata() if p[3]})


def check(folder: Path, fragment: dict) -> list[str]:
    problems = []
    idle = fragment["anims"]["Idle"]
    foot = idle["anchorY"] - idle["fh"] / 2
    for name, a in fragment["anims"].items():
        im = Image.open(folder / "normal" / a["file"])
        if im.size != (a["fw"] * a["frames"], a["fh"] * a["rows"]):
            problems.append(f"{name} size {im.size}")
        if a["rows"] != 8 or len(a["durations"]) != a["frames"]:
            problems.append(f"{name} rows/durations")
        if im.mode != "RGBA":
            problems.append(f"{name} mode {im.mode}")
        alphas = {p[3] for p in im.getdata()}
        if not alphas <= {0, 255}:
            problems.append(f"{name} partial alpha")
        # Resting south feet sit on anchorY.
        if a["durations"]:
            cell = im.crop((0, 0, a["fw"], a["fh"]))
            box = cell.getbbox()
            if box and box[3] != a["anchorY"]:
                # Only the zero-offset rest pose of Idle is required to sit there.
                if name == "Idle":
                    problems.append(f"Idle feet bottom {box[3]} != anchorY {a['anchorY']}")
        if a["anchorY"] - a["fh"] / 2 != foot:
            problems.append(f"{name} foot differs")
    # East rest is the horizontal mirror of west rest.
    idle_im = Image.open(folder / "normal" / "Idle.png")
    fw, fh = idle["fw"], idle["fh"]
    west = idle_im.crop((0, 6 * fh, fw, 7 * fh))
    east = idle_im.crop((0, 2 * fh, fw, 3 * fh)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if list(west.getdata()) != list(east.getdata()):
        problems.append("east is not the mirror of west")
    south = idle_im.crop((0, 0, fw, fh))
    north = idle_im.crop((0, 4 * fh, fw, 5 * fh))
    if list(south.getdata()) == list(north.getdata()):
        problems.append("north matches south; back.png was not used")
    return problems


def write_species(species_id: str, form: str, curves: dict, front: Image.Image, back: Image.Image, out_root: Path) -> Path:
    out_root = assert_safe(out_root)
    folder = out_root / species_id
    normal = folder / "normal"
    if normal.exists():
        shutil.rmtree(normal)
    normal.mkdir(parents=True)
    fragment, sheets = compose(curves, front, back)
    fragment["id"] = species_id
    fragment["form"] = form
    fragment["src"] = f"pokeSprite {form} front.png+back.png"
    fragment["romAx"] = curves["ax"]
    for name, im in sheets.items():
        im.save(normal / f"{name}.png")
    (folder / "manifest-fragment.json").write_text(json.dumps(fragment, indent=2) + "\n")
    (folder / "index.html").write_text(PREVIEW)
    # Full measured slot list, including ones the arena does not play.
    (folder / "rom-anims.json").write_text(json.dumps({
        "ax": curves["ax"], "romBodyH": curves["romBodyH"],
        "poses": curves["poses"], "animCount": curves["animCount"],
        "arenaSlots": SLOTS, "slots": curves["slots"],
    }, indent=2) + "\n")
    write_contact(folder, sheets, fragment)
    problems = check(folder, fragment)
    if problems:
        die("; ".join(problems))
    idle = fragment["anims"]["Idle"]
    print(
        f"wrote {folder} cell {idle['fw']}x{idle['fh']} "
        f"anchorY {idle['anchorY']} body {fragment['bodyW']}x{fragment['bodyH']} "
        f"romBody {curves['romBodyH']} scale {fragment['scaleFromRom']} "
        f"colors {color_count(sheets['Idle'])}"
    )
    return folder


def main() -> None:
    ap = argparse.ArgumentParser(description="Create pokeAnim sheets from pokeSprite PNGs")
    ap.add_argument("--id", required=True, help="roster folder, e.g. 0001_bulbasaur")
    ap.add_argument("--form", default="normal")
    ap.add_argument("--ax", type=int, default=None, help="ROM ax number. Default is the id's dex number")
    ap.add_argument("--curves", type=Path, default=None, help="rom-anims.json from an earlier run")
    ap.add_argument("--out", type=Path, default=REVIEW_OUT)
    ap.add_argument("--serve", type=Path, default=SERVE_OUT, help="second copy the local game server can open")
    args = ap.parse_args()
    ax = args.ax if args.ax is not None else int(args.id.split("_", 1)[0])
    if args.curves:
        curves = json.loads(args.curves.read_text())
    else:
        curves = load_rom_curves(ax)
    folder = find_sprite_dir(args.id, args.form)
    front = harden(Image.open(folder / "front.png"))
    back = harden(Image.open(folder / "back.png"))
    print(f"source {folder} front {front.size} colors {color_count(front)} face {face_sign(front)} back face {face_sign(back)}")
    written = write_species(args.id, args.form, curves, front, back, args.out)
    if args.serve:
        dest = assert_safe(args.serve) / args.id
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(written, dest)
        print(f"serve {dest}")


if __name__ == "__main__":
    main()
