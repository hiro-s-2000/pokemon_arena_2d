// Particles and transient visual effects. Positions are in world units; particles with a z
// value hover above the ground (splashes, debris) and are drawn offset upward.
"use strict";

const FX = (() => {
  let parts = [];
  let items = [];
  let texts = [];
  let lights = [];
  let shake = 0;
  let flash = 0, flashColor = "#ffffff";
  let hitstop = 0;

  function reset() {
    parts = []; items = []; texts = []; lights = [];
    shake = 0; flash = 0; hitstop = 0;
  }

  function p(o) {
    parts.push(Object.assign({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0.9, life: 0.6, t: 0,
      size: 2, grow: 0, color: "#fff", colors: null, shape: "sq", add: false, rot: 0, vr: 0,
    }, o));
  }

  function light(x, y, r, color, a = 0.8) { lights.push({ x, y, r, color, a }); }

  // ---------- Type flavoured emitters ----------

  const emit = {
    fire(x, y, n = 10, spread = 1) {
      const c = TYPES.fire.fx;
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU), s = U.rand(10, 60) * spread;
        p({ x: x + U.rand(-4, 4), y, z: U.rand(0, 6), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: U.rand(20, 70),
          life: U.rand(0.3, 0.7), size: U.rand(2, 4), grow: -3, colors: c, add: true, drag: 0.88 });
      }
      if (U.chance(0.5)) p({ x, y, z: 8, vz: 25, vx: U.rand(-10, 10), life: 0.9, size: 5, grow: 6, color: "rgba(60,40,40,0.35)", shape: "smoke", drag: 0.95 });
    },
    water(x, y, n = 12, spread = 1) {
      const c = TYPES.water.fx;
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU), s = U.rand(20, 90) * spread;
        p({ x, y, z: 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: U.rand(40, 130), g: 340,
          life: U.rand(0.4, 0.8), size: U.rand(1.5, 3), colors: c, drag: 0.97 });
      }
    },
    electric(x, y, n = 10, spread = 1) {
      const c = TYPES.electric.fx;
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU), s = U.rand(60, 160) * spread;
        p({ x, y, z: U.rand(0, 10), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: U.rand(0.12, 0.3), size: U.rand(1, 2.5),
          colors: c, shape: "spark", add: true, drag: 0.8 });
      }
      if (U.chance(0.6)) bolt(x, y, x + U.rand(-30, 30), y + U.rand(-30, 30), "#fff59a", 0.12, 1);
    },
    grass(x, y, n = 8, spread = 1) {
      const c = TYPES.grass.fx;
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU), s = U.rand(20, 80) * spread;
        p({ x, y, z: U.rand(2, 12), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, vz: U.rand(10, 50), g: 60,
          life: U.rand(0.6, 1.1), size: U.rand(2, 3.5), colors: c, shape: "leaf", rot: U.rand(TAU), vr: U.rand(-8, 8), drag: 0.93 });
      }
    },
    ice(x, y, n = 10, spread = 1) {
      const c = TYPES.ice.fx;
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU), s = U.rand(30, 110) * spread;
        p({ x, y, z: U.rand(0, 8), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, vz: U.rand(20, 90), g: 220,
          life: U.rand(0.4, 0.9), size: U.rand(2, 4), colors: c, shape: "shard", rot: a, drag: 0.92, add: U.chance(0.3) });
      }
    },
    psychic(x, y, n = 3) {
      for (let i = 0; i < n; i++) ring(x, y, U.rand(10, 18), U.rand(30, 46), TYPES.psychic.fx[U.randInt(1, 2)], 0.45 + i * 0.1, 2);
      emit.sparkle(x, y, 6, TYPES.psychic.fx);
    },
    ghost(x, y, n = 8) {
      for (let i = 0; i < n; i++) {
        p({ x: x + U.rand(-8, 8), y: y + U.rand(-6, 6), z: U.rand(0, 10), vx: U.rand(-20, 20), vy: U.rand(-10, 10), vz: U.rand(10, 40),
          life: U.rand(0.6, 1.1), size: U.rand(4, 7), grow: 5, colors: TYPES.ghost.fx, shape: "smoke", drag: 0.94, add: U.chance(0.5) });
      }
    },
    dark(x, y, n = 8) {
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU);
        p({ x, y, z: 6, vx: Math.cos(a) * 70, vy: Math.sin(a) * 50, life: U.rand(0.3, 0.6), size: U.rand(3, 6), grow: 4,
          colors: TYPES.dark.fx, shape: "smoke", drag: 0.86 });
      }
    },
    rock(x, y, n = 10, spread = 1, typeKey = "rock") {
      const c = TYPES[typeKey].fx;
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU), s = U.rand(30, 120) * spread;
        p({ x, y, z: 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: U.rand(60, 160), g: 420,
          life: U.rand(0.5, 0.9), size: U.rand(2, 4), colors: c, shape: "chunk", rot: U.rand(TAU), vr: U.rand(-10, 10), drag: 0.97 });
      }
      dust(x, y, 5, c[0]);
    },
    poison(x, y, n = 8) {
      for (let i = 0; i < n; i++) {
        p({ x: x + U.rand(-10, 10), y: y + U.rand(-6, 6), z: U.rand(0, 6), vz: U.rand(15, 40), vx: U.rand(-15, 15),
          life: U.rand(0.5, 1), size: U.rand(2, 4), grow: 2, colors: TYPES.poison.fx, shape: "bubble", drag: 0.95 });
      }
    },
    impact(x, y, n = 6, colors = TYPES.normal.fx) {
      for (let i = 0; i < n; i++) {
        const a = U.rand(TAU);
        p({ x, y, z: 8, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, life: 0.18, size: 2, colors, shape: "spark", add: true, drag: 0.75 });
      }
      p({ x, y, z: 8, life: 0.16, size: 14, grow: 90, color: colors[0], shape: "star", add: true });
    },
    sparkle(x, y, n = 6, colors = TYPES.fairy.fx) {
      for (let i = 0; i < n; i++) {
        p({ x: x + U.rand(-14, 14), y: y + U.rand(-10, 10), z: U.rand(4, 24), vz: U.rand(-5, 15),
          life: U.rand(0.4, 0.9), size: U.rand(2, 4), colors, shape: "twinkle", add: true, drag: 0.9 });
      }
    },
    wind(x, y, n = 6, dir = 0) {
      for (let i = 0; i < n; i++) {
        const a = dir + U.rand(-0.5, 0.5), s = U.rand(120, 220);
        p({ x, y: y + U.rand(-8, 8), z: U.rand(4, 18), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: U.rand(0.2, 0.4),
          size: 1.5, colors: TYPES.flying.fx, shape: "streak", add: true, drag: 0.9 });
      }
    },
  };

  const TYPE_EMIT = {
    fire: (x, y, n, s) => emit.fire(x, y, n, s),
    water: (x, y, n, s) => emit.water(x, y, n, s),
    electric: (x, y, n, s) => emit.electric(x, y, n, s),
    grass: (x, y, n, s) => emit.grass(x, y, n, s),
    ice: (x, y, n, s) => emit.ice(x, y, n, s),
    psychic: (x, y, n) => emit.psychic(x, y, Math.ceil(n / 5)),
    ghost: (x, y, n) => emit.ghost(x, y, n),
    dark: (x, y, n) => emit.dark(x, y, n),
    rock: (x, y, n, s) => emit.rock(x, y, n, s, "rock"),
    ground: (x, y, n, s) => emit.rock(x, y, n, s, "ground"),
    poison: (x, y, n) => emit.poison(x, y, n),
    fairy: (x, y, n) => emit.sparkle(x, y, n, TYPES.fairy.fx),
    dragon: (x, y, n, s) => { emit.fire(x, y, Math.ceil(n / 2), s); emit.sparkle(x, y, Math.ceil(n / 2), TYPES.dragon.fx); },
    steel: (x, y, n) => emit.impact(x, y, n, TYPES.steel.fx),
    fighting: (x, y, n) => emit.impact(x, y, n, TYPES.fighting.fx),
    flying: (x, y, n) => emit.wind(x, y, n, U.rand(TAU)),
    bug: (x, y, n) => emit.sparkle(x, y, n, TYPES.bug.fx),
    normal: (x, y, n) => emit.impact(x, y, Math.ceil(n / 2), TYPES.normal.fx),
  };

  function burst(type, x, y, n = 10, spread = 1) {
    (TYPE_EMIT[type] || TYPE_EMIT.normal)(x, y, n, spread);
  }

  function dust(x, y, n = 6, color = "#d8c8a8") {
    for (let i = 0; i < n; i++) {
      const a = U.rand(TAU);
      p({ x, y, z: 1, vx: Math.cos(a) * U.rand(10, 40), vy: Math.sin(a) * U.rand(5, 20), vz: U.rand(4, 14),
        life: U.rand(0.4, 0.8), size: U.rand(3, 5), grow: 6, color: U.rgba(color, 0.45), shape: "smoke", drag: 0.9 });
    }
  }

  // ---------- Shaped effects ----------

  function ring(x, y, r0, r1, color, dur = 0.4, width = 3, flat = 0.62) {
    items.push({ kind: "ring", x, y, r0, r1, color, dur, width, flat, t: 0 });
  }

  function bolt(x1, y1, x2, y2, color, dur = 0.2, width = 2) {
    items.push({ kind: "bolt", x1, y1, x2, y2, color, dur, width, t: 0, seed: U.rand(1000) });
  }

  function beam(x1, y1, x2, y2, type, dur = 0.5, width = 10) {
    items.push({ kind: "beam", x1, y1, x2, y2, type, dur, width, t: 0 });
  }

  function telegraph(x, y, r, color, dur) {
    const it = { kind: "tele", x, y, r, color, dur, t: 0 };
    items.push(it);
    return it;
  }

  function pillar(x, y, type, dur = 0.6, w = 26, h = 120) {
    items.push({ kind: "pillar", x, y, type, dur, w, h, t: 0 });
  }

  function wave(x, y, r1, type, dur = 0.7) {
    items.push({ kind: "wave", x, y, r1, type, dur, t: 0 });
  }

  function text(x, y, str, opts = {}) {
    texts.push(Object.assign({ x, y, str, t: 0, dur: 0.9, color: "#fff", size: 12, vy: -38, stroke: "#1a1a2a" }, opts));
  }

  function addShake(v) { shake = Math.min(14, shake + v); }
  function addFlash(v, color = "#ffffff") { flash = Math.max(flash, v); flashColor = color; }
  function addHitstop(v) { hitstop = Math.max(hitstop, v); }

  // ---------- Update / draw ----------

  function update(dt) {
    shake *= Math.pow(0.0015, dt);
    if (shake < 0.05) shake = 0;
    flash = Math.max(0, flash - dt * 3);
    lights = [];
    for (const q of parts) {
      q.t += dt;
      const d = Math.pow(q.drag, dt * 60);
      q.vx *= d; q.vy *= d;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vz -= q.g * dt;
      q.z += q.vz * dt;
      if (q.z < 0 && q.g) { q.z = 0; q.vz *= -0.3; q.vx *= 0.6; q.vy *= 0.6; }
      q.size = Math.max(0.5, q.size + q.grow * dt);
      q.rot += q.vr * dt;
    }
    parts = parts.filter((q) => q.t < q.life);
    if (parts.length > 2600) parts.splice(0, parts.length - 2600);
    for (const it of items) it.t += dt;
    items = items.filter((it) => it.t < it.dur);
    for (const tx of texts) { tx.t += dt; tx.y += tx.vy * dt; tx.vy *= Math.pow(0.08, dt); }
    texts = texts.filter((tx) => tx.t < tx.dur);
  }

  function partColor(q) {
    if (!q.colors) return q.color;
    const k = q.t / q.life;
    return q.colors[Math.min(q.colors.length - 1, Math.floor(k * q.colors.length))];
  }

  function drawParticle(ctx, q, alphaScale = 1) {
    const k = q.t / q.life;
    const x = Math.round(q.x), y = Math.round(q.y - q.z);
    const s = q.size;
    ctx.globalAlpha = (q.shape === "smoke" ? (1 - k) * 0.8 : k > 0.7 ? (1 - k) / 0.3 : 1) * alphaScale;
    ctx.fillStyle = partColor(q);
    switch (q.shape) {
      case "spark":
      case "streak": {
        const len = q.shape === "streak" ? 0.06 : 0.035;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - q.vx * len, y - q.vy * len);
        ctx.stroke();
        break;
      }
      case "smoke":
      case "bubble":
        ctx.beginPath();
        ctx.arc(x, y, s, 0, TAU);
        if (q.shape === "bubble") { ctx.lineWidth = 1; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); }
        else ctx.fill();
        break;
      case "shard":
      case "leaf":
      case "chunk":
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(q.rot);
        if (q.shape === "shard") ctx.fillRect(-s, -s * 0.35, s * 2, s * 0.7);
        else if (q.shape === "leaf") { ctx.fillRect(-s, -s * 0.5, s * 2, s); ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(-s, 0, s * 2, s * 0.5); }
        else { ctx.fillRect(-s / 2, -s / 2, s, s); ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(0, 0, s / 2, s / 2); }
        ctx.restore();
        break;
      case "star": {
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-s / 2, -1, s, 2);
        }
        ctx.restore();
        break;
      }
      case "twinkle":
        ctx.fillRect(x - s, y, s * 2 + 1, 1);
        ctx.fillRect(x, y - s, 1, s * 2 + 1);
        break;
      default:
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), Math.ceil(s), Math.ceil(s));
    }
  }

  // Particles flagged additive glow; the renderer draws them with "lighter".
  function drawParticles(ctx, additive) {
    for (const q of parts) {
      if (q.add !== additive) continue;
      drawParticle(ctx, q, additive ? 0.85 : 1);
      if (additive && q.size > 2.5 && U.chance(0.06)) light(q.x, q.y - q.z, q.size * 5, partColor(q), 0.2);
    }
    ctx.globalAlpha = 1;
  }

  function zigzag(it, segs = 9, amp = 12) {
    const pts = [[it.x1, it.y1]];
    const dx = it.x2 - it.x1, dy = it.y2 - it.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = (Math.random() - 0.5) * amp * 2 * Math.sin(t * Math.PI);
      pts.push([it.x1 + dx * t + nx * off, it.y1 + dy * t + ny * off]);
    }
    pts.push([it.x2, it.y2]);
    return pts;
  }

  const GROUND_ITEMS = new Set(["ring", "tele", "wave"]);

  // layer "ground" draws markers beneath fighters; "air" draws bolts, beams and pillars above them.
  function drawItems(ctx, layer) {
    for (const it of items) {
      if (GROUND_ITEMS.has(it.kind) !== (layer === "ground")) continue;
      const k = it.t / it.dur;
      ctx.save();
      switch (it.kind) {
        case "ring": {
          const r = U.lerp(it.r0, it.r1, U.easeOut(k));
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = it.color;
          ctx.lineWidth = it.width * (1 - k * 0.6);
          ctx.beginPath();
          ctx.ellipse(it.x, it.y, r, r * it.flat, 0, 0, TAU);
          ctx.stroke();
          break;
        }
        case "bolt": {
          ctx.globalCompositeOperation = "lighter";
          const pts = zigzag(it, 10, 10 + Math.hypot(it.x2 - it.x1, it.y2 - it.y1) * 0.05);
          for (const [w, col, a] of [[it.width * 4, it.color, 0.25], [it.width * 2, it.color, 0.7], [it.width * 0.8, "#ffffff", 1]]) {
            ctx.globalAlpha = a * (1 - k * 0.5);
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.lineJoin = "miter";
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
          }
          light(it.x2, it.y2, 60, it.color, 0.8);
          light((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, 80, it.color, 0.5);
          break;
        }
        case "beam": {
          const c = TYPES[it.type].fx;
          const grow = Math.min(1, it.t / 0.08);
          const fade = k > 0.75 ? (1 - k) / 0.25 : 1;
          const ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
          const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1) * grow;
          ctx.translate(it.x1, it.y1);
          ctx.rotate(ang);
          ctx.globalCompositeOperation = "lighter";
          const wob = Math.sin(it.t * 60) * 1.5;
          const layers = [[it.width * 2.2 + wob, c[3] || c[2], 0.35], [it.width * 1.3 + wob, c[2], 0.75], [it.width * 0.7, c[1], 0.95], [it.width * 0.3, "#ffffff", 1]];
          for (const [w, col, a] of layers) {
            ctx.globalAlpha = a * fade;
            ctx.fillStyle = col;
            ctx.fillRect(0, -w / 2, len, w);
            ctx.beginPath(); ctx.arc(0, 0, w * 0.75, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(len, 0, w * 0.6, 0, TAU); ctx.fill();
          }
          // Bright pixel streaks running along the beam
          ctx.fillStyle = "#ffffff";
          for (let i = 0; i < 8; i++) {
            const sx = ((it.t * 900 + i * 97) % Math.max(1, len));
            ctx.globalAlpha = 0.8 * fade;
            ctx.fillRect(sx, (U.hash(i, 1) - 0.5) * it.width, 10, 1);
          }
          light(it.x1, it.y1, it.width * 6, c[2], 0.7 * fade);
          light(it.x1 + Math.cos(ang) * len, it.y1 + Math.sin(ang) * len, it.width * 7, c[2], 0.8 * fade);
          light(it.x1 + Math.cos(ang) * len / 2, it.y1 + Math.sin(ang) * len / 2, it.width * 8, c[2], 0.5 * fade);
          break;
        }
        case "tele": {
          const pulse = 0.5 + Math.sin(it.t * 20) * 0.2;
          ctx.globalAlpha = 0.25 + pulse * 0.3;
          ctx.strokeStyle = it.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.ellipse(it.x, it.y, it.r, it.r * 0.62, 0, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = it.color;
          ctx.beginPath(); ctx.ellipse(it.x, it.y, it.r * k, it.r * 0.62 * k, 0, 0, TAU); ctx.fill();
          break;
        }
        case "pillar": {
          const c = TYPES[it.type].fx;
          const up = Math.min(1, it.t / 0.12);
          const fade = k > 0.6 ? (1 - k) / 0.4 : 1;
          ctx.globalCompositeOperation = "lighter";
          for (const [wm, col, a] of [[1.4, c[3] || c[2], 0.3], [1, c[2], 0.7], [0.5, c[1], 0.9], [0.2, "#fff", 1]]) {
            ctx.globalAlpha = a * fade;
            ctx.fillStyle = col;
            const w = it.w * wm * (1 + Math.sin(it.t * 40) * 0.05);
            ctx.fillRect(it.x - w / 2, it.y - it.h * up, w, it.h * up);
            ctx.beginPath(); ctx.ellipse(it.x, it.y, w * 0.8, w * 0.4, 0, 0, TAU); ctx.fill();
          }
          light(it.x, it.y - it.h / 2, it.h, c[2], 0.9 * fade);
          break;
        }
        case "wave": {
          const c = TYPES[it.type].fx;
          const r = it.r1 * U.easeOut(k);
          ctx.globalAlpha = (1 - k) * 0.9;
          for (let i = 0; i < 3; i++) {
            const rr = Math.max(1, r - i * 9);
            ctx.strokeStyle = c[Math.min(c.length - 1, i + 1)];
            ctx.lineWidth = 7 - i * 2;
            ctx.beginPath(); ctx.ellipse(it.x, it.y, rr, rr * 0.62, 0, 0, TAU); ctx.stroke();
          }
          ctx.globalAlpha = (1 - k) * 0.25;
          ctx.fillStyle = c[2];
          ctx.beginPath(); ctx.ellipse(it.x, it.y, r, r * 0.62, 0, 0, TAU); ctx.fill();
          light(it.x, it.y, r * 1.2, c[2], 0.35 * (1 - k));
          break;
        }
      }
      ctx.restore();
    }
  }

  function drawTexts(ctx, toScreen, scale) {
    for (const tx of texts) {
      const k = tx.t / tx.dur;
      const [sx, sy] = toScreen(tx.x, tx.y);
      const pop = tx.t < 0.12 ? U.easeOutBack(tx.t / 0.12) : 1;
      const size = Math.round(tx.size * scale * pop);
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `900 ${size}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = tx.stroke;
      ctx.lineJoin = "round";
      ctx.strokeText(tx.str, sx, sy);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.str, sx, sy);
      ctx.restore();
    }
  }

  return {
    reset, update, burst, dust, emit, ring, bolt, beam, telegraph, pillar, wave, text, light,
    addShake, addFlash, addHitstop, drawParticles, drawItems, drawTexts, particle: p,
    get shake() { return shake; },
    get flash() { return flash; },
    get flashColor() { return flashColor; },
    get lights() { return lights; },
    get hitstop() { return hitstop; },
    set hitstop(v) { hitstop = v; },
  };
})();
