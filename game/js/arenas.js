// Procedural pixel-art arenas. Everything is painted once per battle into offscreen canvases at
// one art pixel per world unit; the renderer scales them up crisply and adds HD-2D lighting.
"use strict";

const Arenas = (() => {
  const W = 960, H = 600;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
  // Light comes from the upper left in every arena.
  const LX = -0.55, LY = -0.62, LZ = 0.56;

  function pal(colors) { return colors.map(U.hex); }
  function dpick(p, v, x, y, amt = 1) {
    const i = Math.round(U.clamp(v * (p.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] * amt, 0, p.length - 1));
    return p[i];
  }

  function paint(w, h, fn) {
    const c = U.canvas(w, h);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, c.height);
    const d = img.data;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const col = fn(x, y);
        if (!col) continue;
        const i = (y * c.width + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col[3] === undefined ? 255 : col[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function shade(col, k) {
    return [U.clamp(col[0] * k, 0, 255), U.clamp(col[1] * k, 0, 255), U.clamp(col[2] * k, 0, 255)];
  }

  // Soft cast shadow toward the lower right, matching the light direction.
  function castShadow(ctx, x, y, rx, ry, len = 1, alpha = 0.32) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x + rx * 0.35 * len, y + ry * 0.4, 1, x + rx * 0.35 * len, y + ry * 0.4, rx * 1.15 * len);
    g.addColorStop(0, "rgba(8,16,24,1)");
    g.addColorStop(0.6, "rgba(8,16,24,0.6)");
    g.addColorStop(1, "rgba(8,16,24,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x + rx * 0.35 * len, y + ry * 0.4, rx * 1.15 * len, ry * 1.1, 0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---------- Props ----------

  function pineTree(size, seed) {
    const w = Math.round(size * 0.78), h = Math.round(size * 1.12);
    const P = pal(["#163a22", "#1f4f29", "#2c6a31", "#3f8a38", "#5eae47", "#93d163", "#c7ec8a"]);
    const trunk = pal(["#3a2416", "#5a3a22", "#7a5232"]);
    const cx = w / 2, tiers = 4;
    return paint(w, h, (x, y) => {
      // Trunk
      if (y > h * 0.86 && Math.abs(x - cx) < size * 0.06) {
        return dpick(trunk, x < cx ? 0.9 : 0.2, x, y);
      }
      const fy = y / (h * 0.9);
      if (fy > 1) return null;
      for (let t = tiers - 1; t >= 0; t--) {
        const top = (t / tiers) * 0.78;
        const bot = top + 0.36;
        if (fy < top || fy > bot) continue;
        const ty = (fy - top) / (bot - top);
        const jag = (U.hash(Math.floor(x / 2), t, seed) - 0.5) * 0.12;
        const half = (0.14 + ty * 0.36 + t * 0.03 + jag) * w;
        const dx = x - cx;
        if (Math.abs(dx) > half) continue;
        // Bottom edge of each tier is a scalloped fringe.
        if (ty > 0.82 && U.hash(x, t + 9, seed) > 1 - (ty - 0.82) * 4) continue;
        const nx = dx / half;
        let l = 0.62 - nx * 0.42 - ty * 0.28 + (1 - ty) * 0.18;
        l += (U.hash(x, y, seed) - 0.5) * 0.16;
        if (ty > 0.78) l -= 0.25;
        return dpick(P, U.clamp(l, 0, 1), x, y, 1.2);
      }
      return null;
    });
  }

  function roundTree(size, seed) {
    const w = Math.round(size), h = Math.round(size * 1.05);
    const P = pal(["#1b4424", "#28602d", "#3a8034", "#55a243", "#80c65a", "#b9e57f"]);
    const trunk = pal(["#3a2416", "#5a3a22", "#7a5232"]);
    return paint(w, h, (x, y) => {
      const cx = w / 2;
      if (y > h * 0.72 && Math.abs(x - cx) < size * 0.08) return dpick(trunk, x < cx ? 0.8 : 0.2, x, y);
      let best = null;
      const blobs = [[0.5, 0.42, 0.42], [0.3, 0.5, 0.26], [0.7, 0.5, 0.26], [0.5, 0.24, 0.28]];
      for (const [bx, by, br] of blobs) {
        const dx = x / w - bx, dy = y / h - by;
        const r = br + (U.smoothNoise(x / 3, y / 3, seed) - 0.5) * 0.06;
        const d = Math.hypot(dx, dy) / r;
        if (d < 1) {
          const nz = Math.sqrt(1 - d * d);
          const l = (dx / r) * LX + (dy / r) * LY + nz * LZ;
          best = dpick(P, U.clamp(l * 0.75 + 0.35 + (U.hash(x, y, seed) - 0.5) * 0.15, 0, 1), x, y, 1.2);
        }
      }
      return best;
    });
  }

  function boulder(r, seed, moss) {
    const w = Math.round(r * 2.2), h = Math.round(r * 1.9);
    const P = pal(["#2b2622", "#463d34", "#635648", "#85745f", "#a8957b", "#cfbfa1"]);
    const M = pal(["#2e5a24", "#477f33", "#6aa647"]);
    return paint(w, h, (x, y) => {
      const cx = w / 2, cy = h * 0.55;
      const a = Math.atan2(y - cy, x - cx);
      const rr = r * (0.86 + U.smoothNoise(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, seed) * 0.28);
      const dx = (x - cx) / rr, dy = (y - cy) / (rr * 0.82);
      const d = Math.hypot(dx, dy);
      if (d > 1) return null;
      const nz = Math.sqrt(1 - d * d);
      let l = dx * LX + dy * LY + nz * LZ;
      // Facets give the rock a chiselled pixel-art look.
      l = Math.round(l * 4) / 4 + (U.hash(Math.floor(x / 3), Math.floor(y / 3), seed) - 0.5) * 0.25;
      if (U.smoothNoise(x / 2.5, y / 2.5, seed + 4) > 0.78) l -= 0.35;
      if (moss && dy < -0.25 && U.smoothNoise(x / 3, y / 3, seed + 2) > 0.48) return dpick(M, U.clamp(l * 0.6 + 0.5, 0, 1), x, y);
      if (d > 0.9) l -= 0.3;
      return dpick(P, U.clamp(l * 0.62 + 0.42, 0, 1), x, y, 1.3);
    });
  }

  function barrel(r, seed) {
    const ry = Math.round(r * 0.6), side = Math.round(r * 0.42);
    const w = r * 2 + 2, h = ry * 2 + side + 3;
    const Wd = pal(["#3b210f", "#5a3417", "#7c4a20", "#9c612b", "#bd7c3c", "#dc9d58", "#efc07a"]);
    const Metal = pal(["#2a2622", "#4c463f", "#7a7268"]);
    return paint(w, h, (x, y) => {
      const cx = w / 2;
      const dxs = (x - cx) / r;
      // Top disc
      const dyt = (y - ry - 1) / ry;
      const dt = Math.hypot(dxs, dyt);
      if (dt <= 1) {
        if (dt > 0.9) return dpick(Metal, 0.4 - dxs * 0.3 - dyt * 0.3, x, y);
        const plank = Math.floor((y + 1) / 5);
        if ((y + 1) % 5 === 0) return Wd[1];
        let l = 0.62 - dxs * 0.22 - dyt * 0.22 + (U.hash(plank, 1, seed) - 0.5) * 0.2;
        l += (U.smoothNoise(x / 4, plank * 3, seed) - 0.5) * 0.2;
        // A stencilled logo in the middle, like the arena barrels in the reference videos.
        if (dt < 0.42 && dt > 0.32) l -= 0.25;
        return dpick(Wd, U.clamp(l, 0, 1), x, y, 1.1);
      }
      // Side wall
      if (Math.abs(dxs) <= 1) {
        const topEdge = ry + 1 + Math.sqrt(1 - dxs * dxs) * ry;
        if (y > topEdge - 1 && y <= topEdge + side) {
          const v = (y - topEdge) / side;
          if (Math.abs(v - 0.5) < 0.12) return dpick(Metal, 0.5 - dxs * 0.4, x, y);
          const stave = Math.floor((dxs + 1) * 6);
          let l = 0.45 - dxs * 0.35 - v * 0.25 + (U.hash(stave, 7, seed) - 0.5) * 0.12;
          if (Math.abs(((dxs + 1) * 6) % 1) < 0.12) l -= 0.25;
          return dpick(Wd, U.clamp(l, 0, 1), x, y);
        }
      }
      return null;
    });
  }

  function crystal(size, seed, hue) {
    const w = Math.round(size * 1.2), h = Math.round(size * 1.5);
    const c = U.canvas(w, h);
    const ctx = c.getContext("2d");
    const P = hue === "cyan"
      ? ["#123a55", "#1f6f9a", "#3fb2e0", "#9ae8ff", "#e8fbff"]
      : ["#2a1458", "#4b23a0", "#7d4ce0", "#b993ff", "#efe4ff"];
    const shards = [[0.5, 0.0, 0.17], [0.28, 0.25, 0.12], [0.73, 0.2, 0.13], [0.15, 0.48, 0.09], [0.86, 0.45, 0.09]];
    shards.sort((a, b) => a[1] - b[1]);
    for (const [sx, top, sw] of shards) {
      const bx = sx * w, half = sw * w, tipY = top * h + 2, baseY = h * 0.94;
      const lean = (U.hash(Math.floor(sx * 100), 2, seed) - 0.5) * half * 0.8;
      // left face
      ctx.fillStyle = P[3];
      ctx.beginPath(); ctx.moveTo(bx + lean, tipY); ctx.lineTo(bx - half, tipY + half * 1.2); ctx.lineTo(bx - half, baseY); ctx.lineTo(bx, baseY); ctx.closePath(); ctx.fill();
      // right face
      ctx.fillStyle = P[1];
      ctx.beginPath(); ctx.moveTo(bx + lean, tipY); ctx.lineTo(bx + half, tipY + half * 1.2); ctx.lineTo(bx + half, baseY); ctx.lineTo(bx, baseY); ctx.closePath(); ctx.fill();
      // center face
      ctx.fillStyle = P[2];
      ctx.beginPath(); ctx.moveTo(bx + lean, tipY); ctx.lineTo(bx - half * 0.3, tipY + half * 1.3); ctx.lineTo(bx - half * 0.3, baseY); ctx.lineTo(bx + half * 0.3, baseY); ctx.lineTo(bx + half * 0.3, tipY + half * 1.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P[4];
      ctx.fillRect(Math.round(bx - half * 0.6), Math.round(tipY + half * 1.4), 1, Math.round((baseY - tipY) * 0.5));
    }
    ctx.fillStyle = "#1a1230";
    ctx.fillRect(0, h - 3, w, 3);
    crisp(c);
    return c;
  }

  function crisp(c) {
    const ctx = c.getContext("2d");
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 110 ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function flowerBed(w, h, seed) {
    const G = pal(["#1f4a21", "#2f6b2a", "#438a34"]);
    const R = pal(["#7a1212", "#c42a1e", "#ff4b32", "#ff9a7a"]);
    const Soil = pal(["#3a2416", "#55361f"]);
    return paint(w, h, (x, y) => {
      const cellX = Math.floor(x / 8), cellY = Math.floor(y / 7);
      const fx = x % 8, fy = y % 7;
      const ox = (cellY % 2) * 4;
      const lx = (x + ox) % 8;
      if (fy >= 1 && fy <= 4 && lx >= 2 && lx <= 5) {
        const d = Math.hypot(lx - 3.5, fy - 2.5);
        if (d < 1.9) return dpick(R, 0.75 - (lx - 3.5) * 0.15 - (fy - 2.5) * 0.15, x, y);
      }
      if (fy >= 4 && U.hash(x, y, seed) > 0.25) return dpick(G, U.hash(cellX, cellY, seed) * 0.6 + (fx < 4 ? 0.3 : 0), x, y);
      return dpick(Soil, U.hash(x, y, seed + 1), x, y);
    });
  }

  function fence(len, horizontal) {
    const Wd = pal(["#4a2a12", "#7a4a20", "#a8692f", "#d69a58"]);
    const w = horizontal ? len : 8, h = horizontal ? 18 : len;
    return paint(w, h, (x, y) => {
      if (horizontal) {
        const post = x % 10 < 5;
        if (post && y >= 2) {
          if (y < 4 && (x % 10 === 0 || x % 10 === 4)) return null;
          return dpick(Wd, (x % 10) < 2 ? 0.9 : (x % 10) > 3 ? 0.2 : 0.6, x, y);
        }
        if ((y >= 6 && y <= 8) || (y >= 12 && y <= 14)) return dpick(Wd, y === 6 || y === 12 ? 0.8 : 0.35, x, y);
        return null;
      }
      if (x >= 1 && x <= 6) return dpick(Wd, x < 3 ? 0.85 : 0.35, x, y);
      return null;
    });
  }

  function crowdStrip(w, h, seed, frame) {
    const shirts = pal(["#e04a3a", "#3a7be0", "#f2c53a", "#4bb35a", "#e872c2", "#8a5ae0", "#f08a2a", "#ffffff", "#2ac2c2", "#c23a6a"]);
    const skins = pal(["#f7d2b0", "#e0a878", "#b77a4a", "#7a4a2a", "#ffe0c8"]);
    const hair = pal(["#2a1a10", "#5a3a1a", "#d8b040", "#1a1a1a", "#a83a1a", "#5a5aa0"]);
    const seat = pal(["#1b2238", "#252e4a", "#313c5e"]);
    return paint(w, h, (x, y) => {
      const rowH = 11;
      const row = Math.floor(y / rowH), ry = y % rowH;
      const step = 7;
      const ox = (row % 2) * 3;
      const col = Math.floor((x + ox) / step), cx = (x + ox) % step;
      const pid = U.hash(col, row, seed);
      const bounce = frame && U.hash(col, row, seed + 5) > 0.45 ? -1 : 0;
      const yy = ry - bounce;
      if (ry >= 9) return seat[0];
      if (pid < 0.08) return dpick(seat, 0.5, x, y);
      if (cx >= 1 && cx <= 5) {
        if (yy >= 0 && yy <= 1 && cx >= 2 && cx <= 4) return hair[Math.floor(U.hash(col, row, seed + 2) * hair.length)];
        if (yy >= 2 && yy <= 3 && cx >= 2 && cx <= 4) return skins[Math.floor(U.hash(col, row, seed + 3) * skins.length)];
        if (yy >= 4 && yy <= 8) {
          const s = shirts[Math.floor(pid * shirts.length)];
          // Raised arms on cheering frames
          if (frame && (cx === 1 || cx === 5) && yy <= 5 && U.hash(col, row, seed + 7) > 0.6) return skins[0];
          return cx === 5 ? shade(s, 0.7) : s;
        }
      }
      return dpick(seat, (ry / rowH) * 0.8, x, y);
    });
  }

  // ---------- Ground textures ----------

  function grassGround(seed) {
    const P = pal(["#22402a", "#2d552e", "#3a6b33", "#4a823a", "#5e9842", "#7aae4f", "#9cc565"]);
    return paint(W, H, (x, y) => {
      const patch = U.fbm(x / 90, y / 90, seed, 4);
      const clump = U.smoothNoise(x / 3, y / 4, seed + 2);
      const blade = U.hash(Math.floor(x / 2), Math.floor(y / 3), seed + 1);
      // Sunlight falls from the upper left; the far corner sits in shade.
      const sun = 0.18 - (x / W) * 0.12 - (y / H) * 0.12;
      let l = patch * 0.8 + sun + (clump - 0.5) * 0.16;
      if (blade > 0.9) l += 0.12;
      if (blade < 0.04) l -= 0.12;
      return dpick(P, U.clamp(l, 0, 1), x, y, 0.7);
    });
  }

  function dirtGround(seed) {
    const P = pal(["#3b2a1c", "#4f3a26", "#654b31", "#7b5c3d", "#94714b", "#ae8a5e"]);
    return paint(W, H, (x, y) => {
      const n = U.fbm(x / 70, y / 70, seed, 5);
      let l = n * 0.9 + (U.hash(x, y, seed) - 0.5) * 0.18 + 0.05 - (y / H) * 0.08;
      const crack = Math.abs(U.fbm(x / 40, y / 40, seed + 9, 3) - 0.5);
      if (crack < 0.005) l -= 0.3;
      if (U.hash(Math.floor(x / 2), Math.floor(y / 2), seed + 3) > 0.985) l += 0.35;
      return dpick(P, U.clamp(l, 0, 1), x, y, 1.3);
    });
  }

  function basaltGround(seed) {
    const P = pal(["#120d0d", "#1d1615", "#2a201d", "#382b26", "#4a3a32"]);
    const L = pal(["#5a1405", "#a3270a", "#e8550f", "#ff9a2a", "#ffe08a"]);
    const pts = [];
    const cell = 46;
    const cols = Math.ceil(W / cell) + 3, rows = Math.ceil(H / cell) + 3;
    // Index 0 holds grid cell -1 so lookups at the border stay in range.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = c - 1, gy = r - 1;
        pts.push([(gx + U.hash(gx, gy, seed)) * cell, (gy + U.hash(gx, gy, seed + 1)) * cell]);
      }
    }
    return paint(W, H, (x, y) => {
      const gx = Math.floor(x / cell) + 1, gy = Math.floor(y / cell) + 1;
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const p = pts[(gy + oy) * cols + gx + ox];
          if (!p) continue;
          const d = Math.hypot(p[0] - x, p[1] - y);
          if (d < d1) { d2 = d1; d1 = d; id = (gy + oy) * cols + gx + ox; }
          else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1;
      if (edge < 2.2) {
        const glow = U.clamp(1 - edge / 2.2, 0, 1) * (0.55 + U.fbm(x / 60, y / 60, seed + 4, 2) * 0.6);
        return dpick(L, U.clamp(glow, 0, 1), x, y);
      }
      let l = 0.55 + (U.hash(id, 3, seed) - 0.5) * 0.4 - (edge < 5 ? 0.25 : 0);
      l += (U.hash(x, y, seed) - 0.5) * 0.2;
      // Bevel: lit on the upper-left edge of each slab.
      return dpick(P, U.clamp(l, 0, 1), x, y, 1.2);
    });
  }

  function waterGround(seed) {
    const P = pal(["#0d2f78", "#123f96", "#1a51b3", "#2465c8", "#3279d8", "#4c93e6"]);
    return paint(W, H, (x, y) => {
      const n = U.fbm(x / 120, y / 60, seed, 4);
      const wave = Math.sin(x / 9 + U.fbm(x / 50, y / 30, seed + 3, 3) * 9 + y / 14);
      let l = n * 0.75 + 0.1 + wave * 0.08 + (U.hash(x, y, seed) - 0.5) * 0.08;
      return dpick(P, U.clamp(l, 0, 1), x, y, 1.2);
    });
  }

  function waterGlints(seed, t) {
    return paint(W, H, (x, y) => {
      const v = U.fbm(x / 26 + t * 0.7, y / 13 - t * 0.35, seed + 11, 3);
      const band = Math.abs(Math.sin(v * 22 + t * 2));
      if (band > 0.985 && U.hash(x, y, seed) > 0.3) return [210, 236, 255, 200];
      if (band > 0.965 && U.hash(x, y, seed + 1) > 0.55) return [150, 200, 255, 110];
      return null;
    });
  }

  function crystalFloor(seed) {
    const P = pal(["#130f24", "#1c1634", "#261e45", "#312857", "#3d3369"]);
    const tile = 48;
    return paint(W, H, (x, y) => {
      const tx = x % tile, ty = y % tile;
      const id = U.hash(Math.floor(x / tile), Math.floor(y / tile), seed);
      let l = 0.45 + (id - 0.5) * 0.3 + (U.hash(x, y, seed) - 0.5) * 0.12;
      if (tx < 1 || ty < 1) l = 0;
      else if (tx < 3 || ty < 3) l += 0.35;
      else if (tx > tile - 3 || ty > tile - 3) l -= 0.3;
      if (U.fbm(x / 30, y / 30, seed + 2, 3) > 0.68) l -= 0.2;
      return dpick(P, U.clamp(l, 0, 1), x, y, 1.1);
    });
  }

  // Dappled shade from the surrounding trees; drawn with multiply and drifting slowly.
  function canopyShadows(seed) {
    const c = U.canvas(W / 4, H / 4);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const n = U.fbm(x / 22, y / 22, seed + 31, 4);
        const edge = Math.min(x, c.width - x, y * 1.6) / 40;
        const shade = U.clamp((0.62 - n) * 2.2 + (1 - U.clamp(edge, 0, 1)) * 0.5, 0, 0.55);
        const i = (y * c.width + x) * 4;
        img.data[i] = 255 - shade * 200; img.data[i + 1] = 255 - shade * 170; img.data[i + 2] = 255 - shade * 120; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ---------- Field markings ----------

  function markings(ctx, field, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const cx = field.x + field.w / 2, cy = field.y + field.h / 2;
    const ring = (r, th) => {
      for (let a = 0; a < TAU; a += 0.6 / r) {
        const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r);
        if (U.hash(px, py, 9) > 0.12) ctx.fillRect(px, py, th, th);
      }
    };
    ring(field.h * 0.23, 2);
    ring(16, 2);
    for (let y = field.y + 4; y < field.y + field.h - 4; y++) {
      if (U.hash(cx, y, 4) > 0.12) ctx.fillRect(Math.round(cx), y, 2, 1);
    }
    for (let x = field.x; x < field.x + field.w; x++) {
      if (U.hash(x, 1, 5) > 0.12) { ctx.fillRect(x, field.y, 1, 2); ctx.fillRect(x, field.y + field.h - 2, 1, 2); }
    }
    for (let y = field.y; y < field.y + field.h; y++) {
      if (U.hash(1, y, 6) > 0.12) { ctx.fillRect(field.x, y, 2, 1); ctx.fillRect(field.x + field.w - 2, y, 2, 1); }
    }
    ctx.restore();
  }

  function stands(ctx, seed, frame, top = 92, bottom = 0) {
    const strip = crowdStrip(W, top - 14, seed, frame);
    ctx.drawImage(strip, 0, 0);
    // Railing and a league banner along the front of the stands.
    ctx.fillStyle = "#0e1220";
    ctx.fillRect(0, top - 14, W, 14);
    ctx.fillStyle = "#e8b81e";
    for (let x = 0; x < W; x += 12) ctx.fillRect(x, top - 4, 6, 4);
    ctx.fillStyle = "#1a1a1a";
    for (let x = 6; x < W; x += 12) ctx.fillRect(x, top - 4, 6, 4);
    ctx.fillStyle = "#cfd6e8";
    ctx.font = "bold 8px monospace";
    ctx.textBaseline = "top";
    const label = "POKéMON LEAGUE  ·  ARENA HD-2D  ·  ";
    let x = 6;
    while (x < W) { ctx.fillText(label, x, top - 13); x += ctx.measureText(label).width; }
    if (bottom) {
      const s2 = crowdStrip(W, bottom, seed + 3, frame);
      ctx.drawImage(s2, 0, H - bottom);
      ctx.fillStyle = "#0e1220";
      ctx.fillRect(0, H - bottom - 6, W, 6);
    }
  }

  // ---------- Arena definitions ----------

  const DEFS = [
    {
      id: "meadow",
      jp: "森のバトル広場",
      ambient: "dust",
      light: { rays: "#fff2c4", raysAlpha: 0.22, warm: "#ffd98a", tint: "#1c3a1a", vignette: 0.45 },
      field: { x: 120, y: 92, w: 720, h: 430 },
      build(a) {
        const g = a.ground.getContext("2d");
        g.drawImage(grassGround(a.seed), 0, 0);
        markings(g, a.field, "#f4f0d6", 0.3);
        a.canopy = canopyShadows(a.seed);

        const trees = [];
        const add = (x, y, s, kind) => trees.push({ x, y, s, kind });
        for (let y = -10; y < H + 40; y += 30) {
          add(U.rand(10, 44), y + U.rand(-6, 6), U.rand(58, 76), "pine");
          add(U.rand(60, 100), y + 14 + U.rand(-6, 6), U.rand(52, 70), "pine");
          add(W - U.rand(10, 44), y + U.rand(-6, 6), U.rand(58, 76), "pine");
          add(W - U.rand(60, 100), y + 14 + U.rand(-6, 6), U.rand(52, 70), "pine");
        }
        for (let x = 120; x < W - 110; x += 34) {
          add(x + U.rand(-8, 8), U.rand(18, 40), U.rand(54, 70), U.chance(0.7) ? "pine" : "round");
          add(x + 17 + U.rand(-8, 8), U.rand(52, 70), U.rand(46, 60), U.chance(0.75) ? "pine" : "round");
        }
        trees.sort((p, q) => p.y - q.y);
        for (const t of trees) castShadow(g, t.x, t.y, t.s * 0.45, t.s * 0.18, 1.5, 0.38);
        for (const t of trees) {
          const spr = t.kind === "pine" ? pineTree(t.s, Math.floor(t.x * 7 + t.y)) : roundTree(t.s, Math.floor(t.x + t.y * 3));
          g.drawImage(spr, Math.round(t.x - spr.width / 2), Math.round(t.y - spr.height));
        }

        // Flower beds and fence along the bottom, drawn above the fighters.
        const f = a.fg.getContext("2d");
        const bedY = H - 58;
        castShadow(f, W / 2, bedY + 34, 240, 18, 1, 0.25);
        for (const bx of [170, 560]) {
          const bed = flowerBed(230, 44, a.seed + bx);
          f.drawImage(bed, bx, bedY + 10);
        }
        const fenceImg = fence(W - 200, true);
        f.drawImage(fenceImg, 100, bedY - 4);
        for (let y = H - 30; y < H + 40; y += 32) {
          const t = pineTree(U.rand(58, 70), Math.floor(y));
          f.drawImage(t, Math.round(U.rand(0, 30)), y - t.height + 10);
          const t2 = pineTree(U.rand(58, 70), Math.floor(y) + 3);
          f.drawImage(t2, Math.round(W - t2.width - U.rand(0, 30)), y - t2.height + 10);
        }

        for (let i = 0; i < 7; i++) {
          const x = U.rand(a.field.x + 60, a.field.x + a.field.w - 60);
          const y = U.rand(a.field.y + 40, a.field.y + a.field.h - 40);
          if (Math.abs(x - W / 2) < 120) continue;
          a.addProp(boulder(U.rand(9, 14), i * 13 + a.seed, true), x, y, 9, true, g);
        }
      },
    },
    {
      id: "water",
      jp: "水のフィールド",
      ambient: "spray",
      water: true,
      light: { rays: "#e6f6ff", raysAlpha: 0.14, warm: "#bfe4ff", tint: "#0a2050", vignette: 0.4 },
      field: { x: 70, y: 108, w: 820, h: 452 },
      build(a) {
        const g = a.ground.getContext("2d");
        // Deck around the pool
        g.drawImage(dirtGround(a.seed), 0, 0);
        g.fillStyle = "rgba(160,170,190,0.55)";
        g.fillRect(0, 0, W, H);
        const pool = { x: 54, y: 104, w: W - 108, h: H - 120 };
        a.pool = pool;
        g.drawImage(waterGround(a.seed), pool.x, pool.y, pool.w, pool.h, pool.x, pool.y, pool.w, pool.h);
        // Pool rim with hazard stripes
        g.fillStyle = "#8b93a6";
        g.fillRect(pool.x - 10, pool.y - 10, pool.w + 20, 10);
        g.fillRect(pool.x - 10, pool.y + pool.h, pool.w + 20, 10);
        g.fillRect(pool.x - 10, pool.y, 10, pool.h);
        g.fillRect(pool.x + pool.w, pool.y, 10, pool.h);
        for (let x = pool.x - 10; x < pool.x + pool.w + 10; x += 10) {
          g.fillStyle = (x / 10) % 2 ? "#f2c21b" : "#1d1d22";
          g.fillRect(x, pool.y - 4, 10, 4);
        }
        g.fillStyle = "rgba(4,16,48,0.45)";
        g.fillRect(pool.x, pool.y, pool.w, 8);
        g.fillRect(pool.x, pool.y, 6, pool.h);
        stands(g, a.seed, 0, 96);
        a.crowd = [U.canvas(W, 96), U.canvas(W, 96)];
        stands(a.crowd[0].getContext("2d"), a.seed, 0, 96);
        stands(a.crowd[1].getContext("2d"), a.seed, 1, 96);

        a.glints = [waterGlints(a.seed, 0), waterGlints(a.seed, 1.6)];

        const spots = [
          [W / 2, H / 2 + 30, 34], [W / 2 - 170, H / 2 - 50, 24], [W / 2 + 170, H / 2 - 50, 24],
          [W / 2 - 210, H / 2 + 120, 28], [W / 2 + 210, H / 2 + 120, 28], [W / 2, 170, 22],
          [W / 2 - 330, 200, 22], [W / 2 + 330, 200, 22], [W / 2 - 100, H - 60, 22], [W / 2 + 120, H - 70, 22],
        ];
        a.platforms = [];
        for (const [x, y, r] of spots) {
          const img = barrel(r, Math.floor(x + y));
          castShadow(g, x, y + r * 0.3, r, r * 0.45, 1, 0.35);
          g.save();
          g.globalAlpha = 0.5;
          g.strokeStyle = "#cfeaff";
          g.beginPath(); g.ellipse(x, y + r * 0.62, r * 1.08, r * 0.62, 0, 0, TAU); g.stroke();
          g.restore();
          // Platforms are stood on, so they are part of the ground rather than depth-sorted props.
          g.drawImage(img, Math.round(x - img.width / 2), Math.round(y + r * 0.42 + 2 - img.height));
          a.platforms.push({ x, y: y - r * 0.05, rx: r * 0.95, ry: r * 0.62 });
        }
        // Poké Ball trainer platforms on both sides
        for (const side of [-1, 1]) {
          const x = W / 2 + side * 400, y = H / 2 + 40, r = 44;
          g.save();
          castShadow(g, x, y, r, r * 0.5, 1, 0.3);
          g.fillStyle = "#e8e8ee";
          g.beginPath(); g.ellipse(x, y + 8, r, r * 0.6, 0, 0, TAU); g.fill();
          g.fillStyle = "#d8322a";
          g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, Math.PI, TAU); g.fill();
          g.fillStyle = "#f6f6fa";
          g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI); g.fill();
          g.fillStyle = "#1b1b22";
          g.fillRect(x - r, y - 2, r * 2, 4);
          g.beginPath(); g.ellipse(x, y, 11, 8, 0, 0, TAU); g.fill();
          g.fillStyle = "#fff";
          g.beginPath(); g.ellipse(x, y, 7, 5, 0, 0, TAU); g.fill();
          g.restore();
          a.platforms.push({ x, y, rx: r, ry: r * 0.6 });
        }
        a.isWater = (x, y) => x > pool.x && x < pool.x + pool.w && y > pool.y && y < pool.y + pool.h &&
          !a.platforms.some((p) => ((x - p.x) / p.rx) ** 2 + ((y - p.y) / p.ry) ** 2 < 1);
      },
    },
    {
      id: "volcano",
      jp: "灼熱の火山",
      ambient: "embers",
      light: { rays: "#ffb070", raysAlpha: 0.08, warm: "#ff8a3a", tint: "#200a06", vignette: 0.6, dark: 0.18 },
      field: { x: 60, y: 108, w: 840, h: 460 },
      build(a) {
        const g = a.ground.getContext("2d");
        const base = basaltGround(a.seed);
        g.drawImage(base, 0, 0);
        a.glow = U.canvas(W / 4, H / 4);
        const gc = a.glow.getContext("2d");
        gc.imageSmoothingEnabled = true;
        gc.filter = "blur(2px)";
        gc.drawImage(base, 0, 0, W / 4, H / 4);
        gc.filter = "none";
        a.lava = [];
        for (let i = 0; i < 5; i++) {
          const x = U.rand(160, W - 160), y = U.rand(200, H - 90), r = U.rand(22, 36);
          if (a.lava.some((l) => U.dist(l.x, l.y, x, y) < 140) || Math.abs(x - W / 2) < 90) continue;
          a.lava.push({ x, y, r });
          const pool = paint(r * 2.4, r * 1.8, (px, py) => {
            const dx = (px - r * 1.2) / r, dy = (py - r * 0.9) / (r * 0.7);
            const n = U.smoothNoise(px / 5, py / 5, i) * 0.3;
            const d = Math.hypot(dx, dy) + n * 0.4;
            if (d > 1.1) return null;
            if (d > 0.92) return [40, 18, 12];
            const L = pal(["#a3270a", "#e8550f", "#ff8a1f", "#ffc24a", "#fff0a0"]);
            return dpick(L, U.clamp(1 - d + U.fbm(px / 8, py / 8, i + 3, 2) * 0.6 - 0.2, 0, 1), px, py);
          });
          g.drawImage(pool, Math.round(x - pool.width / 2), Math.round(y - pool.height / 2));
          gc.fillStyle = "rgba(255,140,40,0.9)";
          gc.beginPath(); gc.ellipse(x / 4, y / 4, r / 3, r / 4, 0, 0, TAU); gc.fill();
        }
        stands(g, a.seed, 0, 96);
        a.crowd = [U.canvas(W, 96), U.canvas(W, 96)];
        stands(a.crowd[0].getContext("2d"), a.seed, 0, 96);
        stands(a.crowd[1].getContext("2d"), a.seed, 1, 96);
        for (let i = 0; i < 8; i++) {
          const x = U.rand(a.field.x + 40, a.field.x + a.field.w - 40), y = U.rand(a.field.y + 50, a.field.y + a.field.h - 30);
          if (Math.abs(x - W / 2) < 110 || a.lava.some((l) => U.dist(l.x, l.y, x, y) < l.r + 30)) continue;
          a.addProp(boulder(U.rand(11, 17), i * 7 + a.seed, false), x, y, 11, true, g);
        }
        a.isLava = (x, y) => a.lava.some((l) => ((x - l.x) / l.r) ** 2 + ((y - l.y) / (l.r * 0.7)) ** 2 < 0.8);
      },
    },
    {
      id: "rocks",
      jp: "岩場のコート",
      ambient: "dust",
      light: { rays: "#fff0d0", raysAlpha: 0.16, warm: "#ffe0a0", tint: "#2a1a0a", vignette: 0.45 },
      field: { x: 60, y: 108, w: 840, h: 460 },
      build(a) {
        const g = a.ground.getContext("2d");
        g.drawImage(dirtGround(a.seed), 0, 0);
        markings(g, a.field, "#e8dcc0", 0.25);
        stands(g, a.seed, 0, 96);
        a.crowd = [U.canvas(W, 96), U.canvas(W, 96)];
        stands(a.crowd[0].getContext("2d"), a.seed, 0, 96);
        stands(a.crowd[1].getContext("2d"), a.seed, 1, 96);
        // Craters
        for (let i = 0; i < 6; i++) {
          const x = U.rand(150, W - 150), y = U.rand(180, H - 60), r = U.rand(16, 30);
          g.save();
          g.fillStyle = "rgba(30,18,8,0.35)";
          g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, TAU); g.fill();
          g.strokeStyle = "rgba(220,190,140,0.35)";
          g.beginPath(); g.ellipse(x + 1, y + 1, r, r * 0.6, 0, 0.2, Math.PI - 0.2); g.stroke();
          g.restore();
        }
        for (let i = 0; i < 9; i++) {
          const x = U.rand(a.field.x + 40, a.field.x + a.field.w - 40), y = U.rand(a.field.y + 40, a.field.y + a.field.h - 30);
          if (Math.abs(x - W / 2) < 120 && Math.abs(y - H / 2) < 90) continue;
          a.addProp(boulder(U.rand(12, 20), i * 11 + a.seed, U.chance(0.3)), x, y, 12, true, g);
        }
      },
    },
    {
      id: "crystal",
      jp: "クリスタルの洞窟",
      ambient: "sparkle",
      light: { rays: "#d8c8ff", raysAlpha: 0.07, warm: "#b38aff", tint: "#100828", vignette: 0.6, dark: 0.12 },
      field: { x: 60, y: 108, w: 840, h: 460 },
      build(a) {
        const g = a.ground.getContext("2d");
        g.drawImage(crystalFloor(a.seed), 0, 0);
        g.save();
        g.strokeStyle = "rgba(230,190,90,0.7)";
        g.lineWidth = 2;
        g.beginPath(); g.arc(W / 2, H / 2 + 20, 120, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(W / 2, a.field.y); g.lineTo(W / 2, a.field.y + a.field.h); g.stroke();
        g.beginPath(); g.arc(W / 2 + 230, H / 2 + 100, 40, 0, TAU); g.stroke();
        g.restore();
        stands(g, a.seed, 0, 96);
        a.crowd = [U.canvas(W, 96), U.canvas(W, 96)];
        stands(a.crowd[0].getContext("2d"), a.seed, 0, 96);
        stands(a.crowd[1].getContext("2d"), a.seed, 1, 96);
        a.glow = U.canvas(W / 4, H / 4);
        const gc = a.glow.getContext("2d");
        const spots = [[110, 150], [W - 110, 150], [110, H - 70], [W - 110, H - 70], [W / 2 - 250, H / 2 - 10], [W / 2 + 260, H / 2 - 40], [W / 2 - 60, H - 80]];
        spots.forEach(([x, y], i) => {
          const hue = i % 3 === 2 ? "cyan" : "purple";
          const c = crystal(U.rand(34, 46), i * 5 + a.seed, hue);
          a.addProp(c, x, y, 16, true, g);
          const rg = gc.createRadialGradient(x / 4, y / 4 - 6, 0, x / 4, y / 4 - 6, 22);
          rg.addColorStop(0, hue === "cyan" ? "rgba(120,220,255,0.9)" : "rgba(170,110,255,0.9)");
          rg.addColorStop(1, "rgba(0,0,0,0)");
          gc.fillStyle = rg;
          gc.fillRect(0, 0, W / 4, H / 4);
        });
      },
    },
  ];

  function create(id) {
    const def = DEFS.find((d) => d.id === id) || DEFS[0];
    const arena = {
      def,
      id: def.id,
      jp: def.jp,
      W, H,
      seed: U.randInt(1, 9999),
      field: def.field,
      light: def.light,
      ambient: def.ambient,
      ground: U.canvas(W, H),
      fg: U.canvas(W, H),
      props: [],
      platforms: [],
      crowd: null,
      glints: null,
      glow: null,
      canopy: null,
      lava: [],
      isWater: () => false,
      isLava: () => false,
      addProp(img, x, y, r, solid, shadowCtx) {
        if (shadowCtx) castShadow(shadowCtx, x, y - 2, img.width * 0.5, img.width * 0.2, 1.2, 0.36);
        this.props.push({ img, x, y, r, solid });
      },
    };
    def.build(arena);
    return arena;
  }

  return { DEFS, create, W, H };
})();
