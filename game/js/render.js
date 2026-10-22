// HD-2D renderer. The world is drawn at an integer pixel scale into a buffer, downsampled to the
// screen (crisp pixels without shimmer), then lit: dynamic glow, god rays, bloom, tilt-shift
// depth of field and a vignette — the look of the reference image.
"use strict";

const Renderer = (() => {
  let canvas, ctx, dpr = 1;
  let sw = 0, sh = 0;
  const world = U.canvas(4, 4);
  const wctx = world.getContext("2d");
  const lightC = U.canvas(4, 4), lctx = lightC.getContext("2d");
  const bloomA = U.canvas(4, 4), baCtx = bloomA.getContext("2d");
  const bloomB = U.canvas(4, 4), bbCtx = bloomB.getContext("2d");
  const tilt = U.canvas(4, 4), tCtx = tilt.getContext("2d");
  const cam = { x: 480, y: 300, z: 2, tz: 2, shakeX: 0, shakeY: 0 };
  let ambientT = 0;

  function init(c) {
    canvas = c;
    ctx = canvas.getContext("2d");
    resize();
    addEventListener("resize", resize);
    if (window.visualViewport) {
      visualViewport.addEventListener("resize", resize);
      visualViewport.addEventListener("scroll", resize);
    }
  }

  function resize() {
    const vv = window.visualViewport;
    const cssW = vv ? vv.width : innerWidth;
    const cssH = vv ? vv.height : innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    sw = Math.max(1, Math.floor(cssW * dpr));
    sh = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = sw;
    canvas.height = sh;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.left = `${vv ? vv.offsetLeft : 0}px`;
    canvas.style.top = `${vv ? vv.offsetTop : 0}px`;
    lightC.width = Math.ceil(sw / 4); lightC.height = Math.ceil(sh / 4);
    bloomA.width = Math.ceil(sw / 4); bloomA.height = Math.ceil(sh / 4);
    bloomB.width = Math.ceil(sw / 10); bloomB.height = Math.ceil(sh / 10);
    tilt.width = sw; tilt.height = sh;
  }

  function touchReservePx() {
    if (!document.body.classList.contains("touch-play")) return 0;
    const css = parseFloat(getComputedStyle(document.body).getPropertyValue("--touch-reserve")) || 0;
    return css * dpr;
  }

  function coverZoom(b) { return Math.max(sw / b.W, sh / b.H); }

  function updateCamera(b, dt, snap) {
    const live = b.active.filter((f) => f && f.active);
    const fld = b.arena.field;
    let tx = fld.x + fld.w / 2, ty = fld.y + fld.h / 2;
    const zc = coverZoom(b);
    let tz = zc;
    if (live.length && b.intro <= 0) {
      const xs = live.map((f) => f.x), ys = live.map((f) => f.y - f.bodyH * 0.4);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      tx = (minX + maxX) / 2;
      ty = (minY + maxY) / 2;
      const fit = Math.min(sw / (maxX - minX + 300), sh / (maxY - minY + 230));
      tz = U.clamp(fit, zc, zc * 2.6);
      if (b.koBanner > 0.8) tz = Math.min(zc * 2.3, tz * 1.12);
    }
    ty += touchReservePx() / (2 * Math.max(tz, 0.001));
    const k = snap ? 1 : 1 - Math.pow(0.04, dt);
    cam.z = U.lerp(cam.z, tz, snap ? 1 : 1 - Math.pow(0.15, dt));
    const halfW = sw / cam.z / 2, halfH = sh / cam.z / 2;
    cam.x = U.clamp(U.lerp(cam.x, tx, k), halfW, b.W - halfW);
    cam.y = U.clamp(U.lerp(cam.y, ty, k), halfH, b.H - halfH);
    const s = FX.shake;
    cam.shakeX = s ? U.rand(-s, s) : 0;
    cam.shakeY = s ? U.rand(-s, s) : 0;
  }

  function toScreen(x, y) {
    return [(x - cam.x) * cam.z + sw / 2, (y - cam.y) * cam.z + sh / 2];
  }

  // ---------- World pass ----------

  function drawWorld(b, time) {
    const k = Math.max(1, Math.ceil(cam.z));
    const vw = sw / cam.z, vh = sh / cam.z;
    const bw = Math.ceil(vw * k) + k * 2, bh = Math.ceil(vh * k) + k * 2;
    if (world.width !== bw || world.height !== bh) { world.width = bw; world.height = bh; }
    const left = cam.x - vw / 2 + cam.shakeX * 0.35, top = cam.y - vh / 2 + cam.shakeY * 0.35;
    // Snap the origin to whole art pixels so the background never swims.
    const ox = Math.floor(left), oy = Math.floor(top);
    const g = wctx;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.imageSmoothingEnabled = false;
    g.translate(-ox, -oy);
    const a = b.arena;
    g.drawImage(a.ground, 0, 0);

    if (a.glints) {
      const ph = (Math.sin(time * 0.8) + 1) / 2;
      g.globalAlpha = 0.35 * (1 - ph);
      g.drawImage(a.glints[0], Math.round(Math.sin(time * 0.3) * 6), 0);
      g.globalAlpha = 0.35 * ph;
      g.drawImage(a.glints[1], Math.round(Math.cos(time * 0.27) * 6), 0);
      g.globalAlpha = 1;
    }
    if (a.glow) {
      g.save();
      g.imageSmoothingEnabled = true;
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.35 + Math.sin(time * 1.7) * 0.12;
      g.drawImage(a.glow, 0, 0, a.W, a.H);
      g.restore();
    }
    if (a.canopy) {
      g.save();
      g.imageSmoothingEnabled = true;
      g.globalCompositeOperation = "multiply";
      g.drawImage(a.canopy, Math.sin(time * 0.05) * 14, Math.cos(time * 0.04) * 8, a.W, a.H);
      g.restore();
    }
    if (a.crowd && a.crowd.length) {
      const rate = b.crowdHype > 0 ? 8 : 1.5;
      // A negative time makes `%` return -1, and drawImage(undefined) stops the whole loop.
      const idx = ((Math.floor(time * rate) % a.crowd.length) + a.crowd.length) % a.crowd.length;
      if (a.crowd[idx]) g.drawImage(a.crowd[idx], 0, 0);
    }

    FX.drawItems(g, "ground");
    for (const f of b.active) if (f) f.drawShadow(g);

    // Depth-sorted props and fighters
    const list = a.props.map((p) => ({ y: p.y, p }));
    for (const team of b.teams) for (const f of team) if (f.active) list.push({ y: f.y, f });
    list.sort((p, q) => p.y - q.y);
    for (const it of list) {
      if (it.p) g.drawImage(it.p.img, Math.round(it.p.x - it.p.img.width / 2), Math.round(it.p.y - it.p.img.height));
      else it.f.draw(g, time);
    }

    for (const atk of b.attacks) {
      const fn = Moves.DRAW[atk.kind];
      if (fn) fn(g, atk);
    }
    FX.drawParticles(g, false);
    g.save();
    g.globalCompositeOperation = "lighter";
    FX.drawParticles(g, true);
    g.restore();
    FX.drawItems(g, "air");
    g.drawImage(a.fg, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);

    // Downsample to the screen; smoothing hides uneven pixel widths at fractional zoom.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const sx = (left - ox) * k, sy = (top - oy) * k;
    ctx.drawImage(world, sx, sy, vw * k, vh * k, 0, 0, sw, sh);
  }

  // ---------- Lighting & post ----------

  function drawLights(b, time) {
    const L = b.arena.light;
    const lw = lightC.width, lh = lightC.height;
    lctx.globalCompositeOperation = "source-over";
    lctx.fillStyle = "#000";
    lctx.fillRect(0, 0, lw, lh);
    lctx.globalCompositeOperation = "lighter";
    const s = 0.25;
    for (const l of FX.lights) {
      const [x, y] = toScreen(l.x, l.y);
      const r = l.r * cam.z * s;
      if (x * s + r < 0 || y * s + r < 0 || x * s - r > lw || y * s - r > lh) continue;
      const g = lctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, r);
      g.addColorStop(0, U.rgba(l.color, l.a));
      g.addColorStop(1, U.rgba(l.color, 0));
      lctx.fillStyle = g;
      lctx.fillRect(x * s - r, y * s - r, r * 2, r * 2);
    }
    // Lava and crystals glow into the air above them.
    if (b.arena.lava.length || b.arena.id === "crystal") {
      for (const p of b.arena.lava) {
        const [x, y] = toScreen(p.x, p.y);
        const r = p.r * 3 * cam.z * s;
        const g = lctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, r);
        g.addColorStop(0, `rgba(255,120,30,${0.45 + Math.sin(time * 2 + p.x) * 0.1})`);
        g.addColorStop(1, "rgba(255,80,0,0)");
        lctx.fillStyle = g;
        lctx.fillRect(x * s - r, y * s - r, r * 2, r * 2);
      }
      if (b.arena.id === "crystal") {
        for (const p of b.arena.props) {
          const [x, y] = toScreen(p.x, p.y - 20);
          const r = 90 * cam.z * s;
          const g = lctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, r);
          g.addColorStop(0, `rgba(160,110,255,${0.35 + Math.sin(time * 1.5 + p.x) * 0.08})`);
          g.addColorStop(1, "rgba(120,80,255,0)");
          lctx.fillStyle = g;
          lctx.fillRect(x * s - r, y * s - r, r * 2, r * 2);
        }
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = L.dark ? 0.9 : 0.6;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lightC, 0, 0, sw, sh);
    ctx.restore();
  }

  function colorGrade(b, time) {
    const L = b.arena.light;
    ctx.save();
    if (L.dark) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = U.rgba(L.tint, 1);
      ctx.globalAlpha = L.dark * 3;
      ctx.fillRect(0, 0, sw, sh);
    }
    // Warm key light from the upper left, cool shade toward the lower right.
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.4;
    const g = ctx.createLinearGradient(0, 0, sw, sh);
    g.addColorStop(0, L.warm);
    g.addColorStop(0.55, "rgba(128,128,128,0)");
    g.addColorStop(1, L.tint);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sw, sh);

    // God rays
    if (L.rays) {
      ctx.globalCompositeOperation = "lighter";
      const angle = 0.62;
      const diag = Math.hypot(sw, sh);
      for (let i = 0; i < 6; i++) {
        const sway = Math.sin(time * 0.25 + i * 1.7) * 0.06;
        const x = (-0.15 + i * 0.19 + sway) * sw - cam.x * cam.z * 0.08;
        const w = (0.04 + U.hash(i, 7) * 0.08) * sw;
        const a = L.raysAlpha * (0.5 + 0.5 * Math.sin(time * 0.4 + i * 2.1)) * (0.6 + U.hash(i, 3) * 0.6);
        ctx.save();
        ctx.translate(x, -sh * 0.1);
        ctx.rotate(-angle);
        // Soft edges across the ray, fading out along its length.
        const across = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        across.addColorStop(0, U.rgba(L.rays, 0));
        across.addColorStop(0.5, U.rgba(L.rays, a));
        across.addColorStop(1, U.rgba(L.rays, 0));
        ctx.fillStyle = across;
        ctx.fillRect(-w / 2, 0, w, diag * 0.45);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(-w / 2, diag * 0.45, w, diag * 0.3);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      // Sun haze in the corner
      const hz = ctx.createRadialGradient(0, 0, 0, 0, 0, sw * 0.6);
      hz.addColorStop(0, U.rgba(L.rays, L.raysAlpha * 1.4));
      hz.addColorStop(1, U.rgba(L.rays, 0));
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, sw, sh);
    }
    ctx.restore();
  }

  function bloom(strength) {
    const aw = bloomA.width, ah = bloomA.height;
    baCtx.globalCompositeOperation = "source-over";
    baCtx.imageSmoothingEnabled = true;
    baCtx.drawImage(canvas, 0, 0, aw, ah);
    // Multiplying the image by itself keeps the highlights and drops the mid-tones.
    baCtx.globalCompositeOperation = "multiply";
    baCtx.drawImage(bloomA, 0, 0);
    baCtx.drawImage(bloomA, 0, 0);
    baCtx.globalCompositeOperation = "source-over";
    bbCtx.imageSmoothingEnabled = true;
    bbCtx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = strength;
    ctx.drawImage(bloomB, 0, 0, sw, sh);
    ctx.globalAlpha = strength * 0.6;
    ctx.drawImage(bloomA, 0, 0, sw, sh);
    ctx.restore();
  }

  function tiltShift() {
    // Soft blur bands at the top and bottom give the miniature, shallow depth-of-field look.
    baCtx.globalCompositeOperation = "source-over";
    baCtx.drawImage(canvas, 0, 0, bloomA.width, bloomA.height);
    tCtx.globalCompositeOperation = "source-over";
    tCtx.clearRect(0, 0, sw, sh);
    tCtx.imageSmoothingEnabled = true;
    tCtx.drawImage(bloomA, 0, 0, sw, sh);
    tCtx.globalCompositeOperation = "destination-in";
    const g = tCtx.createLinearGradient(0, 0, 0, sh);
    g.addColorStop(0, "rgba(0,0,0,0.95)");
    g.addColorStop(0.22, "rgba(0,0,0,0)");
    g.addColorStop(0.8, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.9)");
    tCtx.fillStyle = g;
    tCtx.fillRect(0, 0, sw, sh);
    ctx.drawImage(tilt, 0, 0);
  }

  function vignette(strength) {
    const g = ctx.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.35, sw / 2, sh / 2, Math.hypot(sw, sh) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(4,6,14,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sw, sh);
  }

  // Floating motes, embers, sparkles or spray, depending on the arena.
  function ambient(b, dt) {
    ambientT += dt;
    const kind = b.arena.ambient;
    const vw = sw / cam.z, vh = sh / cam.z;
    const rate = { dust: 18, embers: 26, sparkle: 14, spray: 10 }[kind] || 0;
    let n = Math.floor(ambientT * rate);
    ambientT -= n / rate;
    while (n-- > 0) {
      const x = cam.x + U.rand(-vw / 2, vw / 2), y = cam.y + U.rand(-vh / 2, vh / 2);
      if (kind === "dust") {
        FX.particle({ x, y, z: U.rand(4, 40), vx: U.rand(4, 12), vy: U.rand(-2, 4), vz: U.rand(-2, 2), life: U.rand(2, 4), size: 1,
          color: "#fff4cc", add: true, drag: 1, shape: "sq" });
      } else if (kind === "embers") {
        FX.particle({ x, y: y + 40, z: 0, vx: U.rand(-6, 6), vy: U.rand(-4, 2), vz: U.rand(18, 40), life: U.rand(1.5, 3), size: U.rand(1, 2),
          colors: ["#fff0a0", "#ffb040", "#ff6020", "#a02008"], add: true, drag: 0.99 });
      } else if (kind === "sparkle") {
        FX.particle({ x, y, z: U.rand(0, 30), life: U.rand(0.6, 1.4), size: U.rand(1, 2.5), colors: ["#ffffff", "#d8c8ff", "#a080ff"], add: true, shape: "twinkle", drag: 1 });
      } else if (kind === "spray" && b.arena.isWater(x, y)) {
        FX.particle({ x, y, z: 0, vz: U.rand(20, 40), g: 120, life: 0.5, size: 1, color: "#e8f8ff", add: true, drag: 1 });
      }
    }
  }

  function frame(b, dt, time) {
    updateCamera(b, dt, false);
    ambient(b, dt);
    drawWorld(b, time);
    const L = b.arena.light;
    colorGrade(b, time);
    drawLights(b, time);
    bloom(L.dark ? 0.5 : 0.28);
    tiltShift();
    vignette(L.vignette);
    if (FX.flash > 0) {
      ctx.fillStyle = U.rgba(FX.flashColor, Math.min(0.85, FX.flash));
      ctx.fillRect(0, 0, sw, sh);
    }
  }

  // Menu backdrop: a slow pan over the arena with the same lighting.
  function idle(b, dt, time) {
    cam.z = coverZoom(b) * 1.15;
    const halfW = sw / cam.z / 2;
    cam.x = U.clamp(b.W / 2 + Math.sin(time * 0.08) * 120, halfW, b.W - halfW);
    cam.y = b.H / 2;
    cam.shakeX = cam.shakeY = 0;
    ambient(b, dt);
    drawWorld(b, time);
    colorGrade(b, time);
    drawLights(b, time);
    bloom(0.28);
    tiltShift();
    vignette(b.arena.light.vignette);
  }

  return {
    init, frame, idle, toScreen, updateCamera,
    get ctx() { return ctx; },
    get sw() { return sw; },
    get sh() { return sh; },
    get dpr() { return dpr; },
    get cam() { return cam; },
  };
})();
