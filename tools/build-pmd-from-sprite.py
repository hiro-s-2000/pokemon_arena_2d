#!/usr/bin/env python3
"""Build authentic PMD1 (Red Rescue Team) style pokeAnim sheets from scratch using pokeSprite.

This tool implements the complete pipeline decoded from:
  Pocket Monsters - Fushigi no Dungeon Aka no Kyuujotai (Japan).gba

Modes (`--mode`):
1. `synth` (default):
   - Uses ONLY `pokeSprite` (`front.png` + `back.png` or `.gif`) as pixel/feature input, combined
     with the measured GBA ROM `axXXX` 12-byte 8-direction animation curves.
   - Quantizes to a 15-color PMD1 palette (OKLab k-means + dark-body lift + 1px `#000000` outline).
   - Constructs all 8 directional facings (`S, SE, E, NE, N, NW, W, SW`) with bilateral eye/feature
     separation on `S`, dorsal symmetry on `N`, single-eye foreshortened profile on `W/E`, and 3/4
     views on `SW/SE/NW/NE`.
   - Synthesizes 9 distinct articulated poses per direction (`rest`, `idle_a`, `idle_b`, `walk_a`,
     `walk_b`, `brace`, `lunge`, `hurt`, `sleep_a`, `sleep_b`) so limbs step, bodies breathe/crouch/lunge,
     and eyes close on Hurt/Faint.
2. `rom-hybrid`:
   - Decodes the exact 8-direction multi-OAM poses (`pose_tbl` + chunked 4bpp RLE `spr_tbl`) from
     the GBA ROM `axXXX`, and recolors/remaps the ROM palette to match the target `pokeSprite`'s
     OKLab color ramps (normal, shiny, or regional/variant colors).
3. `rom`:
   - Extracts the exact GBA ROM pixels, 16-color master palette (`PALET_FILE`), and 12-byte motion
     sequences for any `ax001`..`ax423` directly into `pokeAnim` sheets.
4. `normalize`:
   - Takes newly drawn/generated 8-row sprite sheets (`--sheet-dir`), strips background, binarizes
     alpha, enforces 1px `#000000` outlines, aligns feet to `anchorY`, and packages into `pokeAnim`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import struct
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ROM_PATH = Path(
    "/Users/honmahiroshi/Desktop/claude_workspace/あまり触らない。/rom_analytics/rom/"
    "Pocket Monsters - Fushigi no Dungeon Aka no Kyuujotai (Japan).gba"
)
REVIEW_OUT = Path("/Users/honmahiroshi/Desktop/claude_workspace/確認用画像/pmd_sprite_anim")
SERVE_OUT = ROOT / "sprite-anim-preview"
POKE_ANIM_DIR = ROOT / "pokeAnim"
POKE_SPRITE_DIR = ROOT / "pokeSprite"
POKE_DATA_INDEX = ROOT / "pokeData" / "index.json"

DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]
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
    raise SystemExit(f"ERROR: {msg}")


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
    return off if 0 <= off < n else None


# ---------------------------------------------------------------------------------------------
# Perceptual OKLab Color Space & PMD1 Palette Quantization
# ---------------------------------------------------------------------------------------------

def _srgb_to_lin(c: int) -> float:
    v = c / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _lin_to_srgb(v: float) -> int:
    v = max(0.0, v)
    c = v * 12.92 if v <= 0.0031308 else 1.055 * (v ** (1.0 / 2.4)) - 0.055
    return max(0, min(255, int(round(c * 255.0))))


def rgb_to_oklab(r: int, g: int, b: int) -> tuple[float, float, float]:
    lr, lg, lb = _srgb_to_lin(r), _srgb_to_lin(g), _srgb_to_lin(b)
    l = (0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb) ** (1.0 / 3.0)
    m = (0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb) ** (1.0 / 3.0)
    s = (0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb) ** (1.0 / 3.0)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )


def oklab_to_rgb(L: float, A: float, B: float) -> tuple[int, int, int]:
    l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    return (
        _lin_to_srgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        _lin_to_srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        _lin_to_srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    )


def lab_dist2(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


# ---------------------------------------------------------------------------------------------
# Full GBA ROM `axXXX` Decoder (Chunked 4bpp RLE + OAM + Master Palettes + 12-Byte Curves)
# ---------------------------------------------------------------------------------------------

def load_rom_ax(ax: int, custom_palette: list[tuple[int, int, int, int]] | None = None) -> dict[str, Any]:
    if not ROM_PATH.is_file():
        die(f"ROM not found: {ROM_PATH}")
    rom = ROM_PATH.read_bytes()
    if rom[PKSDIR:PKSDIR + 7] != b"pksdir0":
        die("pksdir0 magic missing")

    ax = max(1, min(423, ax))
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
    if file_off is None or rom[file_off:file_off + 4] != b"SIRO":
        die(f"{name.decode()} not found or not SIRO")

    content = gba(u32(rom, file_off + 4), len(rom))
    if content is None:
        die("SIRO content pointer invalid")

    pose_tbl = gba(u32(rom, content), len(rom))
    anim_tbl = gba(u32(rom, content + 4), len(rom))
    anim_count = u32(rom, content + 8)
    spr_tbl = gba(u32(rom, content + 0x0C), len(rom))
    pos_tbl = gba(u32(rom, content + 0x10), len(rom))
    if None in (pose_tbl, anim_tbl, spr_tbl, pos_tbl):
        die("axmain pointers invalid")

    pal_idx = rom[MONSPARA + ax * MON_RECORD + 8]
    pal_off = PALET_FILE + pal_idx * 64
    palette = custom_palette or (
        [(0, 0, 0, 0)]
        + [
            (rom[pal_off + i * 4], rom[pal_off + i * 4 + 1], rom[pal_off + i * 4 + 2], 255)
            for i in range(1, 16)
        ]
    )

    nspr = (content - spr_tbl) // 4
    sprites: list[bytes] = []
    for i in range(nspr):
        rec = gba(u32(rom, spr_tbl + i * 4), len(rom))
        if rec is None:
            sprites.append(b"")
            continue
        buf = bytearray()
        off = rec
        for _ in range(64):
            gfx = u32(rom, off)
            bc = u16(rom, off + 4)
            off += 8
            if gfx == 0 and bc == 0:
                break
            if gfx == 0:
                buf.extend(b"\x00" * bc)
            else:
                go = gba(gfx, len(rom))
                if go is not None and 0 < bc <= 65536:
                    buf.extend(rom[go:go + bc])
        sprites.append(bytes(buf))

    nposes = (pos_tbl - pose_tbl) // 4

    def render_pose_img(pose_id: int, canvas: int = 96, pal_override: list[tuple[int, int, int, int]] | None = None) -> Image.Image:
        use_pal = pal_override or palette
        im = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        if not (0 <= pose_id < nposes):
            return im
        po = gba(u32(rom, pose_tbl + pose_id * 4), len(rom))
        if po is None:
            return im
        px = im.load()
        anchor = canvas // 2
        parts = 0
        while parts < 16:
            sid = s16(rom, po)
            if sid < 0:
                break
            if sid >= len(sprites) or not sprites[sid]:
                po += 10
                parts += 1
                continue
            a0, a1, a2 = u16(rom, po + 4), u16(rom, po + 6), u16(rom, po + 8)
            shape, size = (a0 >> 14) & 3, (a1 >> 14) & 3
            hflip, vflip = (a1 >> 12) & 1, (a1 >> 13) & 1
            tile = a2 & 0x3FF
            x, y = s8(a1 & 0xFF), s8(a0 & 0xFF)
            tw, th = OBJ_SIZE[(shape, size)]
            tile_buf = sprites[sid]
            start = tile * 32 if tile * 32 < len(tile_buf) else 0
            tx_n, ty_n = tw // 8, th // 8
            for ty in range(ty_n):
                for tx in range(tx_n):
                    toff = start + (ty * tx_n + tx) * 32
                    if toff + 32 > len(tile_buf):
                        continue
                    for py in range(8):
                        for bx in range(4):
                            b = tile_buf[toff + py * 4 + bx]
                            for bit, nib in ((0, b & 15), (1, b >> 4)):
                                if nib == 0:
                                    continue
                                sx = tx * 8 + bx * 2 + bit
                                sy = ty * 8 + py
                                dx = tw - 1 - sx if hflip else sx
                                dy = th - 1 - sy if vflip else sy
                                X, Y = anchor + x + dx, anchor + y + dy
                                if 0 <= X < canvas and 0 <= Y < canvas:
                                    px[X, Y] = use_pal[nib]
            po += 10
            parts += 1
        return im

    def read_seq(off: int) -> list[dict[str, int]]:
        steps = []
        for i in range(80):
            o = off + i * 12
            dur = rom[o]
            if dur == 0:
                return steps
            flag = rom[o + 1]
            pose = s16(rom, o + 2)
            ox, oy = s16(rom, o + 4), s16(rom, o + 6)
            sx, sy = s16(rom, o + 8), s16(rom, o + 10)
            if not (0 <= pose < nposes) or abs(ox) > 120 or abs(oy) > 120:
                break
            steps.append({"t": dur, "flag": flag, "pose": pose, "x": ox, "y": oy, "sx": sx, "sy": sy})
        return steps

    slots: dict[str, Any] = {}
    for ai in range(anim_count):
        group = gba(u32(rom, anim_tbl + ai * 4), len(rom))
        if group is None:
            continue
        dirs = []
        for d in range(8):
            seq = gba(u32(rom, group + d * 4), len(rom))
            dirs.append(read_seq(seq) if seq is not None else [])
        slots[str(ai)] = {"dirs": dirs}

    p0 = render_pose_img(0, 96)
    bbox = p0.getbbox()
    body_h = (bbox[3] - bbox[1]) if bbox else 24
    body_w = (bbox[2] - bbox[0]) if bbox else 24
    foot_y = bbox[3] if bbox else 60

    return {
        "ax": ax,
        "palIdx": pal_idx,
        "palette": palette,
        "romBodyH": body_h,
        "romBodyW": body_w,
        "romFootY": foot_y,
        "animCount": anim_count,
        "poses": nposes,
        "slots": slots,
        "renderPose": render_pose_img,
    }


# ---------------------------------------------------------------------------------------------
# PMD1 Style Conversion & Scratch 8-Direction + Articulated Pose Synthesizer
# ---------------------------------------------------------------------------------------------

def find_sprite_dir(species_id: str, form: str = "normal") -> Path:
    if POKE_DATA_INDEX.is_file():
        idx = json.loads(POKE_DATA_INDEX.read_text())
        for p in idx.get("pokemon", []):
            if p.get("id") == species_id and p.get("sprite"):
                rel = p["sprite"].lstrip("./")
                cand = (ROOT / rel).parent
                if cand.is_dir():
                    return cand
    hits = sorted(POKE_SPRITE_DIR.glob(f"*/{species_id}/{form}/front.png"))
    if not hits:
        hits = sorted(POKE_SPRITE_DIR.glob(f"**/{species_id}/**/front.png"))
    if not hits:
        die(f"No pokeSprite folder found for {species_id}")
    return hits[0].parent


def load_source_pair(folder: Path, shiny: bool = False) -> tuple[Image.Image, Image.Image]:
    suffix = "-shiny" if shiny else ""

    def load_one(stem: str) -> Image.Image | None:
        for ext in (".png", ".gif"):
            f = folder / f"{stem}{suffix}{ext}"
            if f.is_file():
                im = Image.open(f)
                if ext == ".gif":
                    im.seek(0)
                return im.convert("RGBA")
        return None

    front = load_one("front")
    if front is None:
        die(f"Missing front{suffix}.png/.gif in {folder}")
    back = load_one("back")
    if back is None:
        back = front.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return front, back


def crop_opaque(im: Image.Image) -> Image.Image:
    px = im.load()
    w, h = im.size
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[x, y][3] >= 32:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    if x1 < 0:
        return im.crop((0, 0, 1, 1))
    return im.crop((x0, y0, x1 + 1, y1 + 1))


def to_pmd_pixel_art(
    front_raw: Image.Image,
    back_raw: Image.Image,
    target_h: int | None = None,
    max_colors: int = 14,
) -> tuple[Image.Image, Image.Image, list[tuple[int, int, int]]]:
    f_crop = crop_opaque(front_raw)
    b_crop = crop_opaque(back_raw)

    src_h = f_crop.size[1]
    if target_h is None:
        if src_h > 56:
            target_h = max(34, min(52, int(round(src_h * 0.62))))
        else:
            target_h = src_h

    def resize_clean(im: Image.Image, th: int) -> Image.Image:
        w, h = im.size
        if h == th:
            return im.copy()
        tw = max(8, int(round(w * (th / h))))
        return im.resize((tw, th), Image.Resampling.BOX if th < h else Image.Resampling.NEAREST)

    bh = max(12, int(round(b_crop.size[1] * (target_h / src_h))))
    f_scaled = resize_clean(f_crop, target_h)
    b_scaled = resize_clean(b_crop, bh)

    hist: dict[tuple[int, int, int], int] = {}
    for im in (f_scaled, b_scaled):
        px = im.load()
        w, h = im.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a < 96 or max(r, g, b) < 28:
                    continue
                key = ((r >> 2) << 2, (g >> 2) << 2, (b >> 2) << 2)
                hist[key] = hist.get(key, 0) + 1

    if not hist:
        hist[(128, 128, 128)] = 1

    pts = [(rgb_to_oklab(*rgb), cnt, rgb) for rgb, cnt in hist.items()]
    pts.sort(key=lambda x: -x[1])
    k = min(max_colors, len(pts))
    centers = [pts[0][0]]
    dmin = [lab_dist2(p[0], centers[0]) for p in pts]
    while len(centers) < k:
        best_s, best_i = -1.0, 0
        for i, (lab, cnt, _) in enumerate(pts):
            s = (cnt ** 0.38) * dmin[i]
            if s > best_s:
                best_s, best_i = s, i
        if best_s <= 1e-7:
            break
        centers.append(pts[best_i][0])
        for i, (lab, _, _) in enumerate(pts):
            d = lab_dist2(lab, centers[-1])
            if d < dmin[i]:
                dmin[i] = d

    for _ in range(20):
        acc = [[0.0, 0.0, 0.0, 0.0] for _ in centers]
        for lab, cnt, _ in pts:
            bi = min(range(len(centers)), key=lambda j: lab_dist2(lab, centers[j]))
            acc[bi][0] += lab[0] * cnt
            acc[bi][1] += lab[1] * cnt
            acc[bi][2] += lab[2] * cnt
            acc[bi][3] += cnt
        for j, a in enumerate(acc):
            if a[3] > 0:
                centers[j] = (a[0] / a[3], a[1] / a[3], a[2] / a[3])

    total_w = sum(p[1] for p in pts)
    shares = [0.0] * len(centers)
    for lab, cnt, _ in pts:
        bi = min(range(len(centers)), key=lambda j: lab_dist2(lab, centers[j]))
        shares[bi] += cnt / total_w
    for j, c in enumerate(centers):
        if shares[j] >= 0.05 and c[0] < 0.30:
            centers[j] = (0.30, c[1], c[2])

    pal_rgb = [(0, 0, 0)] + [oklab_to_rgb(*c) for c in centers]
    pal_lab = [rgb_to_oklab(*c) for c in pal_rgb]

    def apply_pmd_finish(im: Image.Image) -> Image.Image:
        w, h = im.size
        src = im.load()
        pw, ph = w + 4, h + 4
        idx = [[-1] * pw for _ in range(ph)]
        for y in range(h):
            for x in range(w):
                r, g, b, a = src[x, y]
                if a < 96:
                    continue
                if max(r, g, b) < 28:
                    idx[y + 2][x + 2] = 0
                else:
                    lab = rgb_to_oklab(r, g, b)
                    bi = min(range(1, len(pal_lab)), key=lambda j: lab_dist2(lab, pal_lab[j]))
                    idx[y + 2][x + 2] = bi

        for y in range(1, ph - 1):
            for x in range(1, pw - 1):
                n4 = [idx[y - 1][x], idx[y + 1][x], idx[y][x - 1], idx[y][x + 1]]
                if idx[y][x] >= 0 and all(v < 0 for v in n4):
                    idx[y][x] = -1
                elif idx[y][x] < 0 and all(v >= 0 for v in n4):
                    pos_n = [v for v in n4 if v > 0]
                    idx[y][x] = max(set(pos_n), key=pos_n.count) if pos_n else 0

        out_edges = []
        for y in range(1, ph - 1):
            for x in range(1, pw - 1):
                if idx[y][x] >= 0:
                    if any(idx[y + dy][x + dx] < 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                        out_edges.append((x, y))
        for x, y in out_edges:
            idx[y][x] = 0

        out = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        dst = out.load()
        for y in range(ph):
            for x in range(pw):
                ci = idx[y][x]
                if ci >= 0:
                    dst[x, y] = (*pal_rgb[ci], 255)
        return crop_opaque(out)

    return apply_pmd_finish(f_scaled), apply_pmd_finish(b_scaled), pal_rgb


def detect_face_sign(im: Image.Image) -> int:
    px = im.load()
    w, h = im.size
    body_x = []
    eye_x = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            body_x.append(x)
            if 0.15 * h <= y <= 0.72 * h:
                if (r > 165 and g < 120 and b < 120) or (r > 230 and g > 230 and b > 230):
                    eye_x.append(x)
    if not body_x or not eye_x:
        return -1
    return 1 if (sum(eye_x) / len(eye_x)) > (sum(body_x) / len(body_x)) else -1


def reoutline(im: Image.Image) -> Image.Image:
    im = crop_opaque(im)
    w, h = im.size
    pw, ph = w + 2, h + 2
    canvas = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    canvas.paste(im, (1, 1))
    px = canvas.load()
    inner = [[px[x, y] for x in range(pw)] for y in range(ph)]
    for y in range(1, ph - 1):
        for x in range(1, pw - 1):
            r, g, b, a = inner[y][x]
            if a == 0:
                continue
            if any(inner[y + dy][x + dx][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[x, y] = (0, 0, 0, 255)
            else:
                px[x, y] = (r, g, b, 255)
    return crop_opaque(canvas)


def synthesize_front_south(sw: Image.Image) -> Image.Image:
    """Construct a true S (front) view from a 3/4 SW sprite without collapsing the eyes into one:
    In a 3/4 SW sprite, the near eye sits around x ~ 0.40w..0.52w and the snout/forehead Bridge
    is around x ~ 0.25w..0.32w. By mirroring the near-side half [bridge_x .. bridge_x + half_w]
    around the central bridge_x, both eyes and both front legs sit symmetrically left and right!"""
    w, h = sw.size
    src = sw.load()
    # Find the near eye x-cluster or use 0.28 * w as the nasal bridge axis
    eye_xs = [
        x for y in range(int(h * 0.22), int(h * 0.72))
        for x in range(w)
        if src[x, y][3] and ((src[x, y][0] > 165 and src[x, y][1] < 120) or min(src[x, y][:3]) > 225)
    ]
    if eye_xs:
        min_ex, max_ex = min(eye_xs), max(eye_xs)
        # If two eyes are visible in 3/4 view, bridge is between them; if one eye, bridge is 3px to its left
        bridge_x = int(round((min_ex + max_ex) / 2.0)) if (max_ex - min_ex) >= 5 else max(3, max_ex - 4)
    else:
        bridge_x = int(round(w * 0.32))

    out_w = w
    out = Image.new("RGBA", (out_w, h), (0, 0, 0, 0))
    dst = out.load()
    mid = out_w // 2

    for y in range(h):
        xs = [x for x in range(w) if src[x, y][3] > 0]
        if not xs:
            continue
        row_l, row_r = xs[0], xs[-1]
        row_span = row_r - row_l + 1
        half_span = max(1, int(round(row_span * 0.45)))
        # Dorsal top (y < 0.30h) centers around row middle; face/chest mirrors the near hemisphere (bridge_x + |dx|)
        pivot = int(round((row_l + row_r) / 2.0)) if y < int(h * 0.28) else max(row_l + 1, min(row_r - 1, bridge_x))
        for dx in range(-half_span, half_span + 1):
            tx = mid + dx
            if not (0 <= tx < out_w):
                continue
            sx = pivot + int(round(abs(dx) * 0.90))
            sx = max(row_l, min(row_r, sx))
            c = src[sx, y]
            if c[3] == 0:
                c = src[max(row_l, min(row_r, pivot)), y]
            dst[tx, y] = c
    return reoutline(out)


def synthesize_back_north(nw: Image.Image) -> Image.Image:
    """Construct a true N (back) view by bilaterally centering the dorsal silhouette."""
    w, h = nw.size
    src = nw.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    mid = w // 2
    for y in range(h):
        xs = [x for x in range(w) if src[x, y][3] > 0]
        if not xs:
            continue
        row_l, row_r = xs[0], xs[-1]
        row_c = int(round((row_l + row_r) / 2.0))
        half_span = max(1, int(round((row_r - row_l + 1) * 0.46)))
        for dx in range(-half_span, half_span + 1):
            tx = mid + dx
            if not (0 <= tx < w):
                continue
            # Sample from the fuller right (dorsal) side of NW
            sx = max(row_l, min(row_r, row_c + int(round(abs(dx) * 0.85))))
            c = src[sx, y]
            if c[3] == 0:
                c = src[row_c, y]
            dst[tx, y] = c
    return reoutline(out)


def synthesize_side_profile(sw: Image.Image) -> Image.Image:
    """Construct a true W (West, facing left) side profile from SW:
    - Suppresses the far-side (leftmost) eye so only the near profile eye remains
    - Shifts dorsal mass 1px backward (right) and snout 1px forward (left)."""
    w, h = sw.size
    src = sw.load()
    # Find dominant skin/body color to cover the far eye on the extreme left edge
    body_colors = [
        src[x, y][:3]
        for y in range(h)
        for x in range(w)
        if src[x, y][3] and max(src[x, y][:3]) > 60 and not (src[x, y][0] > 165 and src[x, y][1] < 120)
    ]
    skin_rgb = max(set(body_colors), key=body_colors.count) if body_colors else (100, 180, 140)

    out = Image.new("RGBA", (w + 2, h), (0, 0, 0, 0))
    dst = out.load()
    for y in range(h):
        vf = y / max(1, h - 1)
        shift_x = 1 if vf < 0.34 else (-1 if 0.38 <= vf <= 0.68 else 0)
        for x in range(w):
            r, g, b, a = src[x, y]
            if not a:
                continue
            # If a far eye sits near the left silhouette edge (x < 0.25w), replace with skin tone for true profile
            if x < int(w * 0.24) and 0.25 <= vf <= 0.70 and ((r > 165 and g < 120) or min(r, g, b) > 225):
                r, g, b = skin_rgb
            tx = x + 1 + shift_x
            if 0 <= tx < w + 2:
                dst[tx, y] = (r, g, b, 255)
    return reoutline(out)


def build_8dir_base_sprites(front: Image.Image, back: Image.Image) -> dict[str, Image.Image]:
    """Build 8 directional base sprites preserving the crisp facial & dorsal art of front/back
    on S and N while synthesizing distinct side profiles (W/E, single eye + foreshortened body)
    and 3/4 diagonals (SW/SE/NW/NE)."""
    f_sign = detect_face_sign(front)
    sw = front if f_sign < 0 else front.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    se = sw.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    b_sign = detect_face_sign(back)
    nw = back.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if b_sign >= 0 else back
    ne = nw.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    w_view = synthesize_side_profile(sw)
    e_view = w_view.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    return {
        "S": front,
        "SE": se,
        "E": e_view,
        "NE": ne,
        "N": back,
        "NW": nw,
        "W": w_view,
        "SW": sw,
    }


def articulate_poses(base: Image.Image, direction: str) -> dict[str, Image.Image]:
    base = crop_opaque(base)
    w, h = base.size
    src = base.load()

    fx = 1 if direction in ("E", "SE", "NE") else (-1 if direction in ("W", "SW", "NW") else 0)
    fy = 1 if direction in ("S", "SE", "SW") else (-1 if direction in ("N", "NE", "NW") else 0)

    def make_idle(drop_px: int, puff: int = 0) -> Image.Image:
        out = Image.new("RGBA", (w + 4, h + 2), (0, 0, 0, 0))
        dst = out.load()
        split_y = int(h * 0.68)
        for y in range(split_y, h):
            for x in range(w):
                if src[x, y][3]:
                    dst[x + 2, y + 2] = src[x, y]
        for y in range(0, split_y):
            ty = min(h + 1, y + 2 + drop_px)
            for x in range(w):
                if src[x, y][3]:
                    dst[x + 2, ty] = src[x, y]
                    if puff and 0.35 * h <= y <= 0.65 * h:
                        if x < w // 2 and x + 1 >= 0 and dst[x + 1, ty][3] == 0:
                            dst[x + 1, ty] = src[x, y]
                        elif x >= w // 2 and x + 3 < w + 4 and dst[x + 3, ty][3] == 0:
                            dst[x + 3, ty] = src[x, y]
        return reoutline(out)

    def make_walk(phase: int) -> Image.Image:
        out = Image.new("RGBA", (w + 6, h + 4), (0, 0, 0, 0))
        dst = out.load()
        leg_y = int(h * 0.70)
        mid_x = w // 2
        body_drop = 1 if phase < 0 else 0

        for y in range(0, leg_y):
            sway = (phase if fx == 0 else fx * (1 if phase > 0 else 0)) if y < int(h * 0.35) else 0
            for x in range(w):
                if src[x, y][3]:
                    dst[x + 3 + sway, y + 2 + body_drop] = src[x, y]

        for y in range(leg_y, h):
            for x in range(w):
                if not src[x, y][3]:
                    continue
                is_left = x < mid_x
                leg_sign = phase if is_left else -phase
                if fx != 0:
                    dx = leg_sign * 1
                    dy = -1 if leg_sign < 0 else 0
                else:
                    dx = (-1 if is_left else 1) if leg_sign > 0 else 0
                    dy = -2 if leg_sign < 0 else 0
                tx, ty = x + 3 + dx, y + 2 + dy
                if 0 <= tx < w + 6 and 0 <= ty < h + 4:
                    dst[tx, ty] = src[x, y]
        return reoutline(out)

    def make_brace() -> Image.Image:
        return make_idle(drop_px=2, puff=1)

    def make_lunge() -> Image.Image:
        out = Image.new("RGBA", (w + 8, h + 6), (0, 0, 0, 0))
        dst = out.load()
        for y in range(h):
            lean = int(round((1.0 - y / max(1, h - 1)) * 2.0))
            dx = fx * lean
            dy = (1 if fy > 0 else (-1 if fy < 0 else 0)) * (1 if y < h * 0.6 else 0)
            for x in range(w):
                c = src[x, y]
                if not c[3]:
                    continue
                tx, ty = x + 4 + dx, y + 3 + dy
                if 0 <= tx < w + 8 and 0 <= ty < h + 6:
                    dst[tx, ty] = c
        return reoutline(out)

    def make_hurt() -> Image.Image:
        out = Image.new("RGBA", (w + 8, h + 6), (0, 0, 0, 0))
        dst = out.load()
        body_colors = [
            src[x, y][:3]
            for y in range(h)
            for x in range(w)
            if src[x, y][3] and max(src[x, y][:3]) > 60 and not (src[x, y][0] > 170 and src[x, y][1] < 110)
        ]
        skin_rgb = max(set(body_colors), key=body_colors.count) if body_colors else (120, 180, 120)

        for y in range(h):
            recoil = int(round((1.0 - y / max(1, h - 1)) * 2.0))
            dx = -fx * recoil
            for x in range(w):
                r, g, b, a = src[x, y]
                if not a:
                    continue
                if 0.25 * h <= y <= 0.72 * h and ((r > 165 and g < 115) or (r > 230 and g > 230 and b > 230)):
                    r, g, b = (0, 0, 0) if (x + y) % 2 == 0 else skin_rgb
                tx, ty = x + 4 + dx, y + 3
                if 0 <= tx < w + 8 and 0 <= ty < h + 6:
                    dst[tx, ty] = (r, g, b, 255)
        return reoutline(out)

    def make_sleep(breath: int) -> Image.Image:
        out = make_idle(drop_px=2 + breath, puff=1)
        px = out.load()
        ow, oh = out.size
        body_colors = [
            px[x, y][:3]
            for y in range(oh)
            for x in range(ow)
            if px[x, y][3] and max(px[x, y][:3]) > 60 and not (px[x, y][0] > 170 and px[x, y][1] < 110)
        ]
        skin_rgb = max(set(body_colors), key=body_colors.count) if body_colors else (120, 180, 120)
        for y in range(int(oh * 0.25), int(oh * 0.78)):
            for x in range(ow):
                r, g, b, a = px[x, y]
                if a and ((r > 165 and g < 115) or (r > 230 and g > 230 and b > 230)):
                    px[x, y] = (0, 0, 0, 255) if y >= int(oh * 0.52) else (*skin_rgb, 255)
        return out

    return {
        "rest": base,
        "idle_a": make_idle(1, 0),
        "idle_b": make_idle(2, 1),
        "walk_a": make_walk(1),
        "walk_b": make_walk(-1),
        "brace": make_brace(),
        "lunge": make_lunge(),
        "shoot": make_lunge(),
        "hurt": make_hurt(),
        "sleep_a": make_sleep(0),
        "sleep_b": make_sleep(1),
    }


def choose_pose_key(slot_name: str, steps: list[dict[str, Any]], step_idx: int) -> str:
    order: list[int] = []
    for s in steps:
        if s["pose"] not in order:
            order.append(s["pose"])
    rank = order.index(steps[step_idx]["pose"])

    if slot_name == "Idle":
        return ["rest", "idle_a", "idle_b"][rank % 3]
    if slot_name == "Walk":
        return ["rest", "walk_a", "walk_b"][rank % 3]
    if slot_name in ("Attack", "Strike"):
        if len(order) >= 3:
            return ["rest", "brace", "lunge"][min(2, rank)]
        return "lunge" if step_idx >= len(steps) // 3 else "brace"
    if slot_name in ("Shoot", "SpAttack"):
        return "shoot" if rank % 2 == 1 else "brace"
    if slot_name == "Charge":
        return "brace"
    if slot_name == "Hurt":
        return "hurt"
    if slot_name == "Faint":
        return "sleep_b" if rank % 2 == 1 else "sleep_a"
    return "rest"


def scale_off(v: int, scale: float) -> int:
    if v == 0:
        return 0
    s = int(round(v * scale))
    if s == 0:
        s = 1 if v > 0 else -1
    return s


def compose_sheets_synth(
    rom_data: dict[str, Any],
    front_raw: Image.Image,
    back_raw: Image.Image,
    target_h: int | None = None,
) -> tuple[dict[str, Any], dict[str, Image.Image]]:
    front_pmd, back_pmd, pal_rgb = to_pmd_pixel_art(front_raw, back_raw, target_h=target_h)
    dir_bases = build_8dir_base_sprites(front_pmd, back_pmd)
    dir_poses = [articulate_poses(dir_bases[d], d) for d in DIRS]

    rom_body_h = max(16, rom_data["romBodyH"])
    s_rest = dir_poses[0]["rest"]
    scale = s_rest.size[1] / rom_body_h

    scaled_slots: dict[str, list[list[dict[str, Any]]]] = {}
    min_ox = max_ox = min_oy = max_oy = 0

    for name in SHEET_NAMES:
        slot_id = SLOTS[name]
        key = str(slot_id)
        if key not in rom_data["slots"]:
            key = "3" if "3" in rom_data["slots"] else "0"
        dirs = []
        for d, steps in enumerate(rom_data["slots"][key]["dirs"]):
            out_steps = []
            for i, step in enumerate(steps):
                ox = scale_off(step["x"], scale)
                oy = scale_off(step["y"], scale)
                min_ox, max_ox = min(min_ox, ox), max(max_ox, ox)
                min_oy, max_oy = min(min_oy, oy), max(max_oy, oy)
                out_steps.append({
                    "t": step["t"],
                    "flag": step["flag"],
                    "pose": step["pose"],
                    "x": ox,
                    "y": oy,
                    "poseKey": choose_pose_key(name, steps, i),
                })
            dirs.append(out_steps)
        scaled_slots[name] = dirs

    max_sw = max(im.size[0] for dp in dir_poses for im in dp.values())
    max_sh = max(im.size[1] for dp in dir_poses for im in dp.values())
    margin = 4
    side = margin + max(-min_ox, max_ox, 0)
    top = margin + max(-min_oy, 0)
    bot = margin + max(max_oy, 0)
    fw = max_sw + side * 2
    fh = max_sh + top + bot
    if fw % 2: fw += 1
    if fh % 2: fh += 1
    anchor_y = top + max_sh

    sheets: dict[str, Image.Image] = {}
    meta: dict[str, Any] = {}

    for name in SHEET_NAMES:
        dirs = scaled_slots[name]
        frames = len(dirs[0])
        sheet = Image.new("RGBA", (fw * frames, fh * 8), (0, 0, 0, 0))
        for d, steps in enumerate(dirs):
            for i, step in enumerate(steps):
                sprite = dir_poses[d][step["poseKey"]]
                sw, sh = sprite.size
                x = (fw - sw) // 2 + step["x"]
                y = anchor_y - sh + step["y"]
                sheet.paste(sprite, (i * fw + x, d * fh + y), sprite)

        s0 = dirs[0]
        hit = next((i for i, s in enumerate(s0) if s["flag"] == 2), None) if name in HIT_NAMES else None
        if hit is None and name in HIT_NAMES:
            hit = next((i for i, s in enumerate(s0) if s["flag"] == 1), len(s0) // 2)
        rush = max(0, hit - 2) if (hit is not None and name in ("Attack", "Strike") and hit >= 2) else None
        ret = min(frames - 1, hit + 2) if (hit is not None and hit + 2 < frames) else None

        sheets[name] = sheet
        meta[name] = {
            "file": f"{name}.png",
            "fw": fw,
            "fh": fh,
            "frames": frames,
            "rows": 8,
            "durations": [s["t"] for s in dirs[0]],
            "hit": hit,
            "rush": rush,
            "ret": ret,
            "anchorY": anchor_y,
            "romSlot": SLOTS[name],
        }

    rest_cell = sheets["Idle"].crop((0, 0, fw, fh))
    bbox = rest_cell.getbbox()
    body_w = (bbox[2] - bbox[0]) if bbox else s_rest.size[0]
    body_h = (bbox[3] - bbox[1]) if bbox else s_rest.size[1]

    fragment = {
        "dirs": DIRS,
        "bodyW": body_w,
        "bodyH": body_h,
        "shadowSize": 2 if body_w >= 46 else 1,
        "foot": "anchorY - fh/2, from Idle only",
        "scaleFromRom": round(scale, 4),
        "romBodyH": rom_body_h,
        "palette": [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in pal_rgb],
        "anims": meta,
    }
    return fragment, sheets


def build_hybrid_palette(
    rom_palette: list[tuple[int, int, int, int]],
    front_raw: Image.Image,
    back_raw: Image.Image,
) -> list[tuple[int, int, int, int]]:
    """Transfer the color palette of `pokeSprite` (front + back) onto the 16-slot GBA ROM palette
    while preserving PMD1's 3-shade ramp structure and #000000 black outline (slot 1)."""
    _, _, sprite_pal = to_pmd_pixel_art(front_raw, back_raw, max_colors=14)
    sp_labs = [(rgb_to_oklab(*c), c) for c in sprite_pal[1:]]
    if not sp_labs:
        return rom_palette

    new_pal = [(0, 0, 0, 0), (0, 0, 0, 255)]
    for i in range(2, 16):
        rr, rg, rb, ra = rom_palette[i]
        if rr > 240 and rg > 240 and rb > 240:
            new_pal.append((255, 255, 255, 255))
            continue
        rlab = rgb_to_oklab(rr, rg, rb)
        # Match hue/chroma to nearest sprite cluster while blending lightness to keep PMD shading ramp
        best_lab, _ = min(
            sp_labs,
            key=lambda item: (rlab[0] - item[0][0]) ** 2 * 0.35 + (rlab[1] - item[0][1]) ** 2 + (rlab[2] - item[0][2]) ** 2,
        )
        blended_L = max(0.22, min(0.95, rlab[0] * 0.55 + best_lab[0] * 0.45))
        nr, ng, nb = oklab_to_rgb(blended_L, best_lab[1], best_lab[2])
        new_pal.append((nr, ng, nb, 255))
    return new_pal


def compose_sheets_rom(
    rom_data: dict[str, Any],
    pal_override: list[tuple[int, int, int, int]] | None = None,
    pixel_scale: int = 1,
) -> tuple[dict[str, Any], dict[str, Image.Image]]:
    pose_cache: dict[int, Image.Image] = {}

    def get_pose(pid: int) -> Image.Image:
        if pid not in pose_cache:
            pose_cache[pid] = rom_data["renderPose"](pid, 96, pal_override=pal_override)
        return pose_cache[pid]

    canvas = 96
    rom_foot_y = rom_data["romFootY"]
    min_x, max_x, min_y, max_y = canvas, 0, canvas, 0

    slot_steps: dict[str, list[list[dict[str, int]]]] = {}
    for name in SHEET_NAMES:
        slot_id = SLOTS[name]
        key = str(slot_id)
        if key not in rom_data["slots"]:
            key = "3" if "3" in rom_data["slots"] else "0"
        dirs = rom_data["slots"][key]["dirs"]
        slot_steps[name] = dirs
        for d, steps in enumerate(dirs):
            for st in steps:
                im = get_pose(st["pose"])
                bb = im.getbbox()
                if not bb:
                    continue
                min_x = min(min_x, bb[0] + st["x"])
                max_x = max(max_x, bb[2] + st["x"])
                min_y = min(min_y, bb[1] + st["y"])
                max_y = max(max_y, bb[3] + st["y"])

    cx = canvas // 2
    half_w = max(cx - min_x, max_x - cx, 16) + 4
    top_h = max(rom_foot_y - min_y, 16) + 4
    bot_h = max(max_y - rom_foot_y, 4) + 4
    fw = half_w * 2
    fh = top_h + bot_h
    anchor_y = top_h

    sheets: dict[str, Image.Image] = {}
    meta: dict[str, Any] = {}
    for name in SHEET_NAMES:
        dirs = slot_steps[name]
        frames = len(dirs[0])
        sheet = Image.new("RGBA", (fw * frames, fh * 8), (0, 0, 0, 0))
        for d, steps in enumerate(dirs):
            for i, st in enumerate(steps):
                im = get_pose(st["pose"])
                dx = i * fw + half_w - cx + st["x"]
                dy = d * fh + anchor_y - rom_foot_y + st["y"]
                sheet.paste(im, (dx, dy), im)

        if pixel_scale > 1:
            sheet = sheet.resize((sheet.size[0] * pixel_scale, sheet.size[1] * pixel_scale), Image.Resampling.NEAREST)

        s0 = dirs[0]
        hit = next((i for i, s in enumerate(s0) if s["flag"] == 2), None) if name in HIT_NAMES else None
        if hit is None and name in HIT_NAMES:
            hit = next((i for i, s in enumerate(s0) if s["flag"] == 1), len(s0) // 2)
        rush = max(0, hit - 2) if (hit is not None and name in ("Attack", "Strike") and hit >= 2) else None
        ret = min(frames - 1, hit + 2) if (hit is not None and hit + 2 < frames) else None

        sheets[name] = sheet
        meta[name] = {
            "file": f"{name}.png",
            "fw": fw * pixel_scale,
            "fh": fh * pixel_scale,
            "frames": frames,
            "rows": 8,
            "durations": [s["t"] for s in dirs[0]],
            "hit": hit,
            "rush": rush,
            "ret": ret,
            "anchorY": anchor_y * pixel_scale,
            "romSlot": SLOTS[name],
        }

    use_pal = pal_override or rom_data["palette"]
    fragment = {
        "dirs": DIRS,
        "bodyW": rom_data["romBodyW"] * pixel_scale,
        "bodyH": rom_data["romBodyH"] * pixel_scale,
        "shadowSize": 2 if rom_data["romBodyW"] >= 28 else 1,
        "foot": "anchorY - fh/2, from Idle only",
        "scaleFromRom": float(pixel_scale),
        "romBodyH": rom_data["romBodyH"],
        "palette": [f"#{r:02x}{g:02x}{b:02x}" for r, g, b, a in use_pal[1:]],
        "anims": meta,
    }
    return fragment, sheets


def strip_sheet_background_and_quantize(
    sheet: Image.Image,
    frames: int,
    rows: int = 8,
    pal_rgb: list[tuple[int, int, int]] | None = None,
    re_outline: bool = True,
) -> tuple[Image.Image, int, int, int]:
    """Normalize an externally drawn or AI-generated 8-direction sheet into strict PMD1 format:
    - Strips solid/gradient background via border floodfill if corners are opaque
    - Quantizes interior pixels to PMD 15-color palette (if pal_rgb given)
    - Enforces binary alpha (0 or 255) and 1px #000000 black outline
    - Aligns each cell's foot to a unified anchorY
    Returns (cleaned_sheet, fw, fh, anchor_y)."""
    im = sheet.convert("RGBA")
    w, h = im.size
    fw = w // max(1, frames)
    fh = h // max(1, rows)
    px = im.load()

    # Check if corners are opaque (e.g. from image-generator output)
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    opaque_corners = [px[cx, cy][:3] for cx, cy in corners if px[cx, cy][3] > 32]
    if opaque_corners:
        bg_r = sum(c[0] for c in opaque_corners) // len(opaque_corners)
        bg_g = sum(c[1] for c in opaque_corners) // len(opaque_corners)
        bg_b = sum(c[2] for c in opaque_corners) // len(opaque_corners)

        def is_bg(r: int, g: int, b: int, a: int) -> bool:
            if a < 32:
                return True
            return abs(r - bg_r) + abs(g - bg_g) + abs(b - bg_b) < 48

        visited = [[False] * w for _ in range(h)]
        stack: list[tuple[int, int]] = []
        # Seed floodfill along all cell borders
        for r_idx in range(rows):
            for f_idx in range(frames):
                x0, y0 = f_idx * fw, r_idx * fh
                for x in range(x0, min(w, x0 + fw)):
                    stack.append((x, y0))
                    stack.append((x, min(h - 1, y0 + fh - 1)))
                for y in range(y0, min(h, y0 + fh)):
                    stack.append((x0, y))
                    stack.append((min(w - 1, x0 + fw - 1), y))
        while stack:
            cx, cy = stack.pop()
            if not (0 <= cx < w and 0 <= cy < h) or visited[cy][cx]:
                continue
            visited[cy][cx] = True
            r, g, b, a = px[cx, cy]
            if is_bg(r, g, b, a):
                px[cx, cy] = (0, 0, 0, 0)
                stack.extend([(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)])

    pal_labs = [rgb_to_oklab(*c) for c in pal_rgb[1:]] if (pal_rgb and len(pal_rgb) > 1) else []

    out_sheet = Image.new("RGBA", (fw * frames, fh * rows), (0, 0, 0, 0))
    anchor_y = int(round(fh * 0.78))

    for d in range(rows):
        for f in range(frames):
            cell = im.crop((f * fw, d * fh, (f + 1) * fw, (d + 1) * fh))
            cpx = cell.load()
            for y in range(fh):
                for x in range(fw):
                    r, g, b, a = cpx[x, y]
                    if a < 96:
                        cpx[x, y] = (0, 0, 0, 0)
                    elif max(r, g, b) < 28:
                        cpx[x, y] = (0, 0, 0, 255)
                    elif pal_labs and pal_rgb:
                        lab = rgb_to_oklab(r, g, b)
                        best_i = min(range(len(pal_labs)), key=lambda i: lab_dist2(lab, pal_labs[i]))
                        cr, cg, cb = pal_rgb[best_i + 1]
                        cpx[x, y] = (cr, cg, cb, 255)
                    else:
                        cpx[x, y] = (r, g, b, 255)
            if re_outline:
                snap = [[cpx[x, y][3] > 0 for x in range(fw)] for y in range(fh)]
                for y in range(fh):
                    for x in range(fw):
                        if not snap[y][x]:
                            continue
                        if (
                            x == 0 or x == fw - 1 or y == 0 or y == fh - 1
                            or not snap[y - 1][x] or not snap[y + 1][x]
                            or not snap[y][x - 1] or not snap[y][x + 1]
                        ):
                            cpx[x, y] = (0, 0, 0, 255)
            out_sheet.paste(cell, (f * fw, d * fh), cell)

    # Compute true anchorY from Idle/first cell bottom
    cell0 = out_sheet.crop((0, 0, fw, fh))
    bb0 = cell0.getbbox()
    if bb0:
        anchor_y = bb0[3]
    return out_sheet, fw, fh, anchor_y


def compose_sheets_normalize(
    rom_data: dict[str, Any],
    sheet_dir: Path,
    front_raw: Image.Image | None = None,
    back_raw: Image.Image | None = None,
    quantize_to_sprite: bool = False,
) -> tuple[dict[str, Any], dict[str, Image.Image]]:
    pal_rgb: list[tuple[int, int, int]] | None = None
    if front_raw is not None and back_raw is not None:
        _, _, pal_rgb = to_pmd_pixel_art(front_raw, back_raw, max_colors=14)

    sheets: dict[str, Image.Image] = {}
    meta: dict[str, Any] = {}

    for name in SHEET_NAMES:
        cand = sheet_dir / f"{name}.png"
        if not cand.is_file() and (sheet_dir / "normal" / f"{name}.png").is_file():
            cand = sheet_dir / "normal" / f"{name}.png"
        if not cand.is_file():
            continue
        raw_sheet = Image.open(cand).convert("RGBA")
        slot_id = SLOTS[name]
        key = str(slot_id) if str(slot_id) in rom_data["slots"] else "0"
        rom_dirs = rom_data["slots"][key]["dirs"]
        rom_frames = len(rom_dirs[0]) if rom_dirs and rom_dirs[0] else 4

        # Infer frame count from aspect ratio or ROM slot
        w, h = raw_sheet.size
        fh_est = h // 8
        frames = rom_frames if (w % rom_frames == 0) else max(1, round(w / max(1, fh_est)))
        cleaned, fw, fh, anchor_y = strip_sheet_background_and_quantize(
            raw_sheet,
            frames=frames,
            rows=8,
            pal_rgb=pal_rgb if quantize_to_sprite else None,
            re_outline=True,
        )
        s0 = rom_dirs[0] if (rom_dirs and len(rom_dirs[0]) == frames) else [{"t": 8, "flag": 0} for _ in range(frames)]
        hit = next((i for i, s in enumerate(s0) if s.get("flag") == 2), frames // 2) if name in HIT_NAMES else None
        rush = max(0, hit - 2) if (hit is not None and name in ("Attack", "Strike") and hit >= 2) else None
        ret = min(frames - 1, hit + 2) if (hit is not None and hit + 2 < frames) else None

        sheets[name] = cleaned
        meta[name] = {
            "file": f"{name}.png",
            "fw": fw,
            "fh": fh,
            "frames": frames,
            "rows": 8,
            "durations": [s.get("t", 8) for s in s0],
            "hit": hit,
            "rush": rush,
            "ret": ret,
            "anchorY": anchor_y,
            "romSlot": slot_id,
        }

    if not sheets:
        die(f"No {SHEET_NAMES} PNGs found in {sheet_dir}")

    # If only a subset of sheets was provided, fill missing ones from Idle/Walk/Attack
    fallback_order = ["Idle", "Walk", "Attack", "Strike", "Shoot", "SpAttack", "Charge", "Hurt", "Faint"]
    base_name = next((n for n in fallback_order if n in sheets), next(iter(sheets.keys())))
    for name in SHEET_NAMES:
        if name not in sheets:
            sheets[name] = sheets[base_name].copy()
            m = dict(meta[base_name])
            m["file"] = f"{name}.png"
            m["romSlot"] = SLOTS[name]
            meta[name] = m

    idle_info = meta["Idle"]
    cell0 = sheets["Idle"].crop((0, 0, idle_info["fw"], idle_info["fh"]))
    bb = cell0.getbbox()
    body_w = (bb[2] - bb[0]) if bb else idle_info["fw"] // 2
    body_h = (bb[3] - bb[1]) if bb else idle_info["fh"] // 2

    fragment = {
        "dirs": DIRS,
        "bodyW": body_w,
        "bodyH": body_h,
        "shadowSize": 2 if body_w >= 46 else 1,
        "foot": "anchorY - fh/2, from Idle only",
        "scaleFromRom": round(body_h / max(1, rom_data["romBodyH"]), 4),
        "romBodyH": rom_data["romBodyH"],
        "palette": [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in (pal_rgb or [(0, 0, 0)])],
        "anims": meta,
    }
    return fragment, sheets


def write_contact(folder: Path, sheets: dict[str, Image.Image], fragment: dict[str, Any]) -> None:
    fw, fh = fragment["anims"]["Idle"]["fw"], fragment["anims"]["Idle"]["fh"]
    zoom = 3 if fw <= 96 else 2
    groups = [
        ("8-Dir Facings (S SE E NE N NW W SW)", "Idle", list(range(8)), [0]),
        ("Idle (S)", "Idle", [0], list(range(fragment["anims"]["Idle"]["frames"]))),
        ("Walk (S)", "Walk", [0], list(range(fragment["anims"]["Walk"]["frames"]))),
        ("Walk (E)", "Walk", [2], list(range(fragment["anims"]["Walk"]["frames"]))),
        ("Attack (S)", "Attack", [0], list(range(fragment["anims"]["Attack"]["frames"]))),
        ("Attack (E)", "Attack", [2], list(range(fragment["anims"]["Attack"]["frames"]))),
        ("Shoot (S)", "Shoot", [0], list(range(fragment["anims"]["Shoot"]["frames"]))),
        ("Hurt (S/E/N)", "Hurt", [0, 2, 4], list(range(fragment["anims"]["Hurt"]["frames"]))),
        ("Faint (Sleep)", "Faint", [0], list(range(fragment["anims"]["Faint"]["frames"]))),
    ]
    rows = []
    width = 0
    for _, name, dir_list, frame_list in groups:
        sheet = sheets[name]
        afw, afh = fragment["anims"][name]["fw"], fragment["anims"][name]["fh"]
        cells = []
        for d in dir_list:
            for f in frame_list:
                cell = sheet.crop((f * afw, d * afh, (f + 1) * afw, (d + 1) * afh))
                cells.append(cell.resize((afw * zoom, afh * zoom), Image.Resampling.NEAREST))
        gap = 6
        row_w = sum(c.size[0] for c in cells) + gap * max(0, len(cells) - 1)
        row_h = cells[0].size[1]
        row = Image.new("RGBA", (row_w, row_h), (34, 36, 44, 255))
        x = 0
        for c in cells:
            row.paste(c, (x, 0), c)
            x += c.size[0] + gap
        rows.append(row)
        width = max(width, row_w)
    gap_y = 8
    height = sum(r.size[1] for r in rows) + gap_y * (len(rows) - 1)
    contact = Image.new("RGBA", (width, height), (22, 24, 30, 255))
    y = 0
    for row in rows:
        contact.paste(row, (0, y))
        y += row.size[1] + gap_y
    contact.save(folder / "contact.png")


def install_into_pokeanim(species_id: str, sheets: dict[str, Image.Image], fragment: dict[str, Any]) -> Path:
    manifest_json_path = POKE_ANIM_DIR / "manifest.json"
    manifest_js_path = POKE_ANIM_DIR / "manifest.js"
    if not manifest_json_path.is_file():
        die(f"manifest.json not found at {manifest_json_path}")

    manifest = json.loads(manifest_json_path.read_text())
    existing = manifest.get("pokemon", {}).get(species_id)
    if existing and existing.get("src"):
        rel_dir = existing["src"]
    else:
        idx = json.loads(POKE_DATA_INDEX.read_text())
        entry = next((p for p in idx["pokemon"] if p["id"] == species_id), None)
        if entry and entry.get("sprite"):
            rel_dir = str(Path(entry["sprite"].replace("../pokeSprite/", "")).parent)
        else:
            rel_dir = f"gen1/{species_id}/normal"

    target_dir = POKE_ANIM_DIR / rel_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    anims_rec: dict[str, Any] = {}
    for name, im in sheets.items():
        out_file = target_dir / f"{name}.png"
        im.save(out_file)
        h = hashlib.md5(out_file.read_bytes()).hexdigest()[:8]
        a = dict(fragment["anims"][name])
        a.pop("romSlot", None)
        a["file"] = f"../pokeAnim/{rel_dir}/{name}.png?v={h}"
        anims_rec[name] = a

    manifest["pokemon"][species_id] = {
        "src": rel_dir,
        "exact": True,
        "source": "pmd-from-sprite",
        "shadowSize": fragment.get("shadowSize", 1),
        "bodyH": fragment["bodyH"],
        "bodyW": fragment["bodyW"],
        "anims": anims_rec,
    }
    manifest_text = json.dumps(manifest, separators=(",", ":"))
    manifest_json_path.write_text(manifest_text + "\n")
    manifest_js_path.write_text(f"window.POKE_ANIM = {manifest_text};\n")
    return target_dir


def write_preview_html(folder: Path, species_id: str, fragment: dict[str, Any], rom_data: dict[str, Any]) -> None:
    rom_json = {
        "ax": rom_data["ax"],
        "palIdx": rom_data["palIdx"],
        "romBodyH": rom_data["romBodyH"],
        "animCount": rom_data["animCount"],
        "poses": rom_data["poses"],
        "slots": rom_data["slots"],
    }
    (folder / "rom-anims.json").write_text(json.dumps(rom_json, indent=2) + "\n")

    html = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>{species_id} — PMD1 Sprite Anim Preview</title>
<style>
  body {{ margin:0; padding:16px 20px; background:#0f1117; color:#e6e8ef; font:13px/1.45 -apple-system,BlinkMacSystemFont,sans-serif; }}
  h1 {{ margin:0 0 6px; font-size:16px; }}
  .sub {{ color:#9499ad; font-size:12px; margin-bottom:14px; }}
  .bar {{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }}
  button {{ background:#1d2130; color:#cfd3e0; border:1px solid #2d3348; padding:5px 10px; border-radius:4px; cursor:pointer; font-size:12px; }}
  button.active {{ background:#3a56d4; border-color:#5a76f4; color:#fff; }}
  .grid {{ display:grid; grid-template-columns:repeat(3, minmax(220px, 1fr)); gap:10px; }}
  .card {{ background:#161925; border:1px solid #252a3d; border-radius:6px; padding:10px; }}
  .card h3 {{ margin:0 0 6px; font-size:12px; color:#b8bfd4; display:flex; justify-content:space-between; }}
  canvas {{ display:block; margin:0 auto; image-rendering:pixelated; background:#1c2030; border:1px solid #2a3047; border-radius:4px; }}
</style>
</head>
<body>
<h1>{species_id} — PMD1 8-Dir Sprite Animation Preview</h1>
<div class="sub">src: {fragment.get("src", "")} · body {fragment["bodyW"]}×{fragment["bodyH"]}px · cell {fragment["anims"]["Idle"]["fw"]}×{fragment["anims"]["Idle"]["fh"]}px · anchorY {fragment["anims"]["Idle"]["anchorY"]}</div>
<div class="bar" id="dirBar"><span>Dir:</span></div>
<div class="grid" id="grid"></div>
<script>
const MANIFEST = {json.dumps(fragment)};
const DIRS = MANIFEST.dirs;
const NAMES = Object.keys(MANIFEST.anims);
let curDir = 0;
const dirBar = document.getElementById('dirBar');
DIRS.forEach((d, idx) => {{
  const b = document.createElement('button');
  b.textContent = idx + ':' + d;
  if (idx === 0) b.classList.add('active');
  b.onclick = () => {{
    curDir = idx;
    [...dirBar.querySelectorAll('button')].forEach((el, j) => el.classList.toggle('active', j === idx));
  }};
  dirBar.appendChild(b);
}});
const grid = document.getElementById('grid');
const states = {{}};
NAMES.forEach(name => {{
  const a = MANIFEST.anims[name];
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h3><span>${{name}}</span><span>${{a.frames}}f</span></h3>`;
  const cv = document.createElement('canvas');
  cv.width = a.fw * 2; cv.height = a.fh * 2;
  card.appendChild(cv);
  grid.appendChild(card);
  const img = new Image();
  img.src = 'normal/' + a.file + '?t=' + Date.now();
  states[name] = {{ a, cv, ctx: cv.getContext('2d'), img, fi: 0, tick: 0 }};
}});
function step() {{
  for (const s of Object.values(states)) {{
    if (!s.img.complete) continue;
    const {{ a, ctx, cv, img }} = s;
    s.tick++;
    if (s.tick >= (a.durations[s.fi] || 8)) {{ s.tick = 0; s.fi = (s.fi + 1) % a.frames; }}
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(255,90,90,0.35)';
    ctx.beginPath(); ctx.moveTo(0, a.anchorY * 2); ctx.lineTo(cv.width, a.anchorY * 2); ctx.stroke();
    ctx.drawImage(img, s.fi * a.fw, curDir * a.fh, a.fw, a.fh, 0, 0, a.fw * 2, a.fh * 2);
  }}
  requestAnimationFrame(step);
}}
requestAnimationFrame(step);
</script>
</body>
</html>
"""
    (folder / "index.html").write_text(html)


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate PMD1 pokeAnim sheets from scratch using pokeSprite + GBA ROM")
    ap.add_argument("--id", required=True, help="Roster ID, e.g. 0001_bulbasaur, 0025_pikachu, 0003_venusaur-mega")
    ap.add_argument("--form", default="normal", help="Subfolder form name when searching pokeSprite")
    ap.add_argument("--ax", type=int, default=None, help="GBA ROM ax number (1..423) for motion curves / ROM extract")
    ap.add_argument("--mode", choices=["synth", "rom-hybrid", "rom", "normalize"], default="synth", help="Generation mode")
    ap.add_argument("--sheet-dir", type=Path, default=None, help="Directory with custom/AI-generated 8-dir sheets (for --mode normalize)")
    ap.add_argument("--quantize-to-sprite", action="store_true", help="Quantize normalized sheets to pokeSprite PMD palette")
    ap.add_argument("--target-h", type=int, default=None, help="Target PMD body height in pixels (synth mode)")
    ap.add_argument("--pixel-scale", type=int, default=1, help="Integer pixel upscale factor (rom/rom-hybrid mode)")
    ap.add_argument("--shiny", action="store_true", help="Use shiny pokeSprite palette")
    ap.add_argument("--out", type=Path, default=REVIEW_OUT, help="Review output directory")
    ap.add_argument("--serve", type=Path, default=SERVE_OUT, help="Preview server directory")
    ap.add_argument("--install", action="store_true", help="Also install directly into pokeAnim/ and update manifest.json/js")
    args = ap.parse_args()

    dex_m = re.match(r"^(\d+)", args.id)
    dex = int(dex_m.group(1)) if dex_m else 1
    ax = args.ax if args.ax is not None else (dex if 1 <= dex <= 386 else 1)

    rom_data = load_rom_ax(ax)

    if args.mode == "rom":
        fragment, sheets = compose_sheets_rom(rom_data, pixel_scale=args.pixel_scale)
        fragment["src"] = f"GBA ROM ax{ax:03d}"
    elif args.mode == "rom-hybrid":
        sp_dir = find_sprite_dir(args.id, args.form)
        front_raw, back_raw = load_source_pair(sp_dir, shiny=args.shiny)
        hybrid_pal = build_hybrid_palette(rom_data["palette"], front_raw, back_raw)
        fragment, sheets = compose_sheets_rom(rom_data, pal_override=hybrid_pal, pixel_scale=args.pixel_scale)
        fragment["src"] = f"GBA ROM ax{ax:03d} + pokeSprite ({sp_dir.relative_to(ROOT)}) palette"
    elif args.mode == "normalize":
        if not args.sheet_dir or not args.sheet_dir.is_dir():
            die("--mode normalize requires --sheet-dir pointing to a directory containing 8-row PNG sheet(s)")
        front_raw, back_raw = None, None
        try:
            sp_dir = find_sprite_dir(args.id, args.form)
            front_raw, back_raw = load_source_pair(sp_dir, shiny=args.shiny)
        except SystemExit:
            pass
        fragment, sheets = compose_sheets_normalize(
            rom_data,
            args.sheet_dir,
            front_raw=front_raw,
            back_raw=back_raw,
            quantize_to_sprite=args.quantize_to_sprite,
        )
        fragment["src"] = f"Normalized custom/AI 8-dir sheets ({args.sheet_dir})"
    else:
        sp_dir = find_sprite_dir(args.id, args.form)
        front_raw, back_raw = load_source_pair(sp_dir, shiny=args.shiny)
        fragment, sheets = compose_sheets_synth(rom_data, front_raw, back_raw, target_h=args.target_h)
        fragment["src"] = f"pokeSprite ({sp_dir.relative_to(ROOT)}) -> PMD1 synth"

    fragment["id"] = args.id
    fragment["romAx"] = ax

    folder = args.out / args.id
    normal_dir = folder / "normal"
    if normal_dir.exists():
        shutil.rmtree(normal_dir)
    normal_dir.mkdir(parents=True, exist_ok=True)

    for name, im in sheets.items():
        im.save(normal_dir / f"{name}.png")

    (folder / "manifest-fragment.json").write_text(json.dumps(fragment, indent=2) + "\n")
    write_contact(folder, sheets, fragment)
    write_preview_html(folder, args.id, fragment, rom_data)

    if args.serve and str(args.serve):
        dest = args.serve / args.id
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(folder, dest)

    if args.install:
        installed_dir = install_into_pokeanim(args.id, sheets, fragment)
        print(f"Installed into pokeAnim: {installed_dir}")

    idle = fragment["anims"]["Idle"]
    print(
        f"[{args.mode.upper()}] {args.id} (ax{ax:03d}) -> {folder}\n"
        f"  body={fragment['bodyW']}x{fragment['bodyH']}px  cell={idle['fw']}x{idle['fh']}px  "
        f"anchorY={idle['anchorY']}  palette={len(fragment['palette'])} colors"
    )


if __name__ == "__main__":
    main()
