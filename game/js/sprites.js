// Sprite loading. Canvas drawImage() only ever shows the first frame of an animated GIF, so
// when the page is served over http(s) the GIF bytes are fetched and decoded into frames.
// Opened straight from file://, fetch is blocked and the sprite stays a still image.
// PMD sprite sheets (pokeAnim) are plain PNGs cut up with drawImage, so they animate either way.
"use strict";

const GifDecoder = (() => {
  function lzw(minCode, data, pixelCount) {
    const out = new Uint8Array(pixelCount);
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
    const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    for (let i = 0; i < clear; i++) suffix[i] = i;
    let bits = 0, acc = 0, pos = 0, op = 0, old = -1, first = 0;
    while (op < pixelCount) {
      while (bits < size && pos < data.length) { acc |= data[pos++] << bits; bits += 8; }
      if (bits < size) break;
      let code = acc & mask;
      acc >>>= size; bits -= size;
      if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
      if (code === eoi) break;
      if (old === -1) { out[op++] = suffix[code]; old = first = code; continue; }
      const inCode = code;
      let sp = 0;
      if (code >= next) { stack[sp++] = first; code = old; }
      while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[sp++] = first;
      while (sp && op < pixelCount) out[op++] = stack[--sp];
      if (next < 4096) {
        prefix[next] = old; suffix[next] = first; next++;
        if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; }
      }
      old = inCode;
    }
    return out;
  }

  function decode(buf) {
    const b = new Uint8Array(buf);
    if (String.fromCharCode(b[0], b[1], b[2]) !== "GIF") throw new Error("not a gif");
    const W = b[6] | (b[7] << 8), H = b[8] | (b[9] << 8);
    let p = 13;
    let gct = null;
    if (b[10] & 0x80) { const n = 3 * (1 << ((b[10] & 7) + 1)); gct = b.subarray(p, p + n); p += n; }
    const frames = [];
    const canvas = U.canvas(W, H), ctx = canvas.getContext("2d");
    let gce = { delay: 10, trans: -1, disposal: 0 };
    let restore = null;
    while (p < b.length) {
      const block = b[p++];
      if (block === 0x3b) break;
      if (block === 0x21) {
        const label = b[p++];
        if (label === 0xf9) {
          const flags = b[p + 1];
          gce = { disposal: (flags >> 2) & 7, delay: b[p + 2] | (b[p + 3] << 8), trans: flags & 1 ? b[p + 4] : -1 };
        }
        while (b[p]) p += b[p] + 1;
        p++;
        continue;
      }
      if (block !== 0x2c) break;
      const fx = b[p] | (b[p + 1] << 8), fy = b[p + 2] | (b[p + 3] << 8);
      const fw = b[p + 4] | (b[p + 5] << 8), fh = b[p + 6] | (b[p + 7] << 8);
      const flags = b[p + 8];
      p += 9;
      let ct = gct;
      if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); ct = b.subarray(p, p + n); p += n; }
      const interlaced = flags & 0x40;
      const minCode = b[p++];
      const chunks = [];
      let len = 0;
      while (b[p]) { chunks.push(b.subarray(p + 1, p + 1 + b[p])); len += b[p]; p += b[p] + 1; }
      p++;
      const data = new Uint8Array(len);
      let o = 0;
      for (const c of chunks) { data.set(c, o); o += c.length; }
      const idx = lzw(minCode, data, fw * fh);

      if (gce.disposal === 3) restore = ctx.getImageData(0, 0, W, H);
      const img = ctx.getImageData(fx, fy, fw, fh);
      const rows = interlaced ? interlaceRows(fh) : null;
      for (let y = 0; y < fh; y++) {
        const dy = rows ? rows[y] : y;
        for (let x = 0; x < fw; x++) {
          const ci = idx[y * fw + x];
          if (ci === gce.trans || !ct) continue;
          const di = (dy * fw + x) * 4;
          img.data[di] = ct[ci * 3]; img.data[di + 1] = ct[ci * 3 + 1]; img.data[di + 2] = ct[ci * 3 + 2]; img.data[di + 3] = 255;
        }
      }
      ctx.putImageData(img, fx, fy);
      const snap = U.canvas(W, H);
      snap.getContext("2d").drawImage(canvas, 0, 0);
      frames.push({ canvas: snap, delay: Math.max(2, gce.delay || 10) / 100 });
      if (gce.disposal === 2) ctx.clearRect(fx, fy, fw, fh);
      else if (gce.disposal === 3 && restore) ctx.putImageData(restore, 0, 0);
      gce = { delay: 10, trans: -1, disposal: 0 };
    }
    return { W, H, frames };
  }

  function interlaceRows(h) {
    const rows = [];
    for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
    return rows;
  }

  return { decode };
})();

const Sprites = (() => {
  const cache = new Map();
  const canFetch = location.protocol.startsWith("http");
  let pool;

  function get(src) {
    if (cache.has(src)) return cache.get(src);
    pool = pool || document.getElementById("sprite-pool");
    const img = new Image();
    img.decoding = "async";
    const rec = { img, ready: false, w: 0, h: 0, failed: false, frames: null, total: 0 };
    img.onload = () => {
      rec.ready = true;
      rec.w = img.naturalWidth;
      rec.h = img.naturalHeight;
    };
    img.onerror = () => { rec.failed = true; };
    img.src = src;
    pool.appendChild(img);
    cache.set(src, rec);
    if (canFetch && /\.gif$/i.test(src)) {
      fetch(src)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const gif = GifDecoder.decode(buf);
          if (gif.frames.length > 1) {
            rec.frames = gif.frames;
            rec.total = gif.frames.reduce((s, f) => s + f.delay, 0);
          }
        })
        .catch(() => { /* keep the still image */ });
    }
    return rec;
  }

  // The frame to draw at time t (seconds); still images return the <img> itself.
  function frame(rec, t) {
    if (!rec.frames) return rec.img;
    let k = t % rec.total;
    for (const f of rec.frames) {
      if (k < f.delay) return f.canvas;
      k -= f.delay;
    }
    return rec.frames[rec.frames.length - 1].canvas;
  }

  function preload(species) {
    const s = species.sprites;
    return [s.front, s.frontR, s.back, s.backR, s.icon].map(get);
  }

  function whenReady(recs, timeout = 6000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (recs.every((r) => r.ready || r.failed) || performance.now() - t0 > timeout) resolve();
        else setTimeout(tick, 50);
      };
      tick();
    });
  }

  // Solid-color copy of the current frame, used for hit flashes and cast shadows. Takes a GIF record
  // (frame at time t) or a sheet frame {img, sx, sy, sw, sh}; the copy sits at (0, 0, sw, sh).
  const tintCanvas = U.canvas(256, 256);
  const tctx = tintCanvas.getContext("2d");
  function tinted(src, color, t = 0) {
    const fr = src.sw ? src : gifFrame(src, t);
    const w = fr.sw, h = fr.sh;
    if (tintCanvas.width < w || tintCanvas.height < h) {
      tintCanvas.width = Math.max(tintCanvas.width, w);
      tintCanvas.height = Math.max(tintCanvas.height, h);
    }
    tctx.globalCompositeOperation = "source-over";
    tctx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
    tctx.drawImage(fr.img, fr.sx, fr.sy, w, h, 0, 0, w, h);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = "source-over";
    return tintCanvas;
  }

  // A GIF frame in the same {img, sx, sy, sw, sh, ax, ay} shape as sheet frames; (ax, ay) is the
  // feet point. The old renderer let GIFs sink 2px below the feet, so that is kept.
  function gifFrame(rec, t) {
    return { img: frame(rec, t), sx: 0, sy: 0, sw: rec.w, sh: rec.h, ax: rec.w / 2, ay: rec.h, sink: 2 };
  }

  // ---------- Shiny recolouring ----------
  // pokeAnim has no shiny sheets, so a shiny fighter's sheets are recoloured on load: every colour
  // of the still front sprite (pokeSprite front.png) is paired with the same pixel of
  // front-shiny.png, and each sheet colour is shifted by the pair nearest to it (keeping its own
  // shading offset). Needs pixel access, so it only works when the page is served over http;
  // opened from file:// the canvas is tainted and the plain sheet is kept.
  const pairCache = new Map();
  const shinyRecCache = new Map();

  function pixels(img) {
    const c = U.canvas(img.naturalWidth, img.naturalHeight);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  // Resolves to [{ rgb, hsv, to (hsv of the shiny colour), frac }, …] (normal colour -> shiny colour,
  // frac = share of the sprite's pixels), or null when unavailable.
  function palettePairs(pair) {
    const key = pair.normal + "|" + pair.shiny;
    if (pairCache.has(key)) return pairCache.get(key);
    const a = get(pair.normal), b = get(pair.shiny);
    const p = whenReady([a, b]).then(() => {
      if (!a.ready || !b.ready || a.w !== b.w || a.h !== b.h) return null;
      const A = pixels(a.img).data, B = pixels(b.img).data;
      const votes = new Map();
      let total = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (A[i + 3] < 128 || B[i + 3] < 128) continue;
        const k = (A[i] << 16) | (A[i + 1] << 8) | A[i + 2];
        const v = (B[i] << 16) | (B[i + 1] << 8) | B[i + 2];
        let m = votes.get(k);
        if (!m) votes.set(k, (m = new Map()));
        m.set(v, (m.get(v) || 0) + 1);
        total++;
      }
      const out = [];
      for (const [k, m] of votes) {
        let best = 0, bv = 0, n = 0;
        for (const [v, c] of m) { n += c; if (c > best) { best = c; bv = v; } }
        const rgb = [k >> 16, (k >> 8) & 255, k & 255];
        out.push({ rgb, hsv: rgbToHsv(rgb), to: rgbToHsv([bv >> 16, (bv >> 8) & 255, bv & 255]), frac: n / total });
      }
      return out.length ? out : null;
    }).catch(() => null);
    pairCache.set(key, p);
    return p;
  }

  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h / 6 + 1) % 1;
    }
    return [h, max > 0 ? d / max : 0, max];
  }

  function hsvToRgb([h, s, v]) {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // Each sheet colour follows one palette pair: the nearest in RGB, with a pull towards pairs that
  // cover a similar share of pixels (so a body colour maps to the body, not to a flame or trim of a
  // similar hue). The pair's hue shift and saturation / value ratios are then applied, which keeps
  // the sheet's own shading. Outlines and near-black stay as they are.
  const PREVALENCE_WEIGHT = 1500;
  function recolour(data, pairs) {
    const counts = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
      total++;
    }
    const memo = new Map();
    for (const [k, n] of counts) {
      const r = k >> 16, g = (k >> 8) & 255, b = k & 255;
      if (Math.max(r, g, b) < 40) { memo.set(k, k); continue; }
      const frac = n / total;
      let bs = Infinity, bp = null;
      for (const p of pairs) {
        const [pr, pg, pb] = p.rgb;
        const lr = Math.log(Math.max(frac, 1e-4) / Math.max(p.frac, 1e-4));
        const s = (pr - r) * (pr - r) + (pg - g) * (pg - g) + (pb - b) * (pb - b) + PREVALENCE_WEIGHT * lr * lr;
        if (s < bs) { bs = s; bp = p; }
      }
      const [h, s, v] = rgbToHsv([r, g, b]);
      const [ph, ps, pv] = bp.hsv, [qh, qs, qv] = bp.to;
      const nh = ps > 0.1 && qs > 0.1 ? (h + (qh - ph) + 1) % 1 : qs > 0.1 ? qh : h;
      const ns = ps > 0.1 ? Math.min(1, s * (qs / ps)) : qs;
      const nv = pv > 0.05 ? Math.min(1, v * (qv / pv)) : qv;
      const [nr, ng, nb] = hsvToRgb([nh, ns, nv]);
      memo.set(k, (nr << 16) | (ng << 8) | nb);
    }
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const v = memo.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      data[i] = v >> 16; data[i + 1] = (v >> 8) & 255; data[i + 2] = v & 255;
    }
  }

  // A record like get()'s whose image is the sheet at `file` recoloured for `pair`.
  function shinyRec(file, pair) {
    const key = file + "|" + pair.normal + "|" + pair.shiny;
    if (shinyRecCache.has(key)) return shinyRecCache.get(key);
    const base = get(file);
    const rec = { img: base.img, ready: false, w: 0, h: 0, failed: false, frames: null, total: 0, plain: false };
    shinyRecCache.set(key, rec);
    Promise.all([whenReady([base]), palettePairs(pair)]).then(([, pairs]) => {
      if (base.failed) { rec.failed = true; return; }
      rec.w = base.w; rec.h = base.h;
      try {
        if (!pairs) throw new Error("no palette");
        const c = U.canvas(base.w, base.h);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(base.img, 0, 0);
        const im = ctx.getImageData(0, 0, c.width, c.height);
        recolour(im.data, pairs);
        ctx.putImageData(im, 0, 0);
        rec.img = c;
      } catch (e) {
        rec.plain = true; // tainted canvas (file://) or no palette: keep the normal colours
      }
      rec.ready = true;
    });
    return rec;
  }

  // ---------- PMD sprite sheets (../pokeAnim, see tools/build-anim.js) ----------
  // Sheets hold one animation each: columns are frames, rows the 8 facings in POKE_ANIM.dirs order.
  const animCache = new Map();
  const ANIM = window.POKE_ANIM || null;

  // The animation set for a roster id, or null when the build found no PMD art (GIF fallback).
  // With a shiny pair ({normal, shiny} still-sprite paths) the sheets come back recoloured.
  function anim(id, shinyPair = null) {
    const key = shinyPair ? `${id}|${shinyPair.normal}|${shinyPair.shiny}` : id;
    if (animCache.has(key)) return animCache.get(key);
    const meta = ANIM && ANIM.pokemon[id];
    let set = null;
    if (meta && meta.anims.Idle) {
      const idle = meta.anims.Idle;
      set = {
        id, bodyH: meta.bodyH || idle.fh, bodyW: meta.bodyW || idle.fw,
        // PMD frames share their centre point, so one feet offset (taken from Idle) places every
        // animation; per-sheet anchors would make lunges and recoils snap back to the ground.
        foot: idle.anchorY - idle.fh / 2,
        anims: {},
      };
      for (const [name, a] of Object.entries(meta.anims)) {
        const ends = [];
        let acc = 0;
        for (const d of a.durations) { acc += d / 60; ends.push(acc); }
        const hitAt = a.hit != null && a.hit > 0 ? ends[a.hit - 1] : a.hit === 0 ? 0 : acc * 0.55;
        const rec = shinyPair ? shinyRec(a.file, shinyPair) : get(a.file);
        set.anims[name] = { name, rec, fw: a.fw, fh: a.fh, frames: a.frames, rows: a.rows, ends, total: acc, hitAt };
      }
    }
    animCache.set(key, set);
    return set;
  }

  // Image records of a set's sheets, for whenReady().
  function animRecs(set) { return set ? Object.values(set.anims).map((a) => a.rec) : []; }

  // Frame index at time t (seconds) into an animation; loops, or holds the last frame.
  function frameIndex(a, t, loop) {
    if (loop) t %= a.total;
    for (let i = 0; i < a.ends.length; i++) if (t < a.ends[i]) return i;
    return a.ends.length - 1;
  }

  // The source rect of one sheet frame, anchored at the set's feet point.
  function sheetFrame(set, a, row, t, loop = true) {
    const i = frameIndex(a, t, loop);
    const r = a.rows > 1 ? row : 0;
    return { img: a.rec.img, sx: i * a.fw, sy: r * a.fh, sw: a.fw, sh: a.fh, ax: a.fw / 2, ay: a.fh / 2 + set.foot, sink: 0 };
  }

  // 8-way facing row (S, SE, E, NE, N, NW, W, SW) for a screen-space direction; y points down.
  function dirRow(x, y) {
    const a = Math.atan2(y, x);
    return ((Math.round((Math.PI / 2 - a) / (Math.PI / 4)) % 8) + 8) % 8;
  }

  return { get, frame, gifFrame, preload, whenReady, tinted, anim, animRecs, sheetFrame, frameIndex, dirRow, get animated() { return canFetch; } };
})();
