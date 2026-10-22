// Real-time move behaviours. Each move shape spawns an "attack" that lives in battle.attacks and
// handles its own movement, visuals and hit tests.
"use strict";

const Moves = (() => {
  const TARGETED_BURST = /^(psychic|psyshock|extrasensory|expanding-force|freezing-glare|mystical-fire|dark-pulse|snarl|swift|icy-wind|bonemerang|stomping-tantrum|high-horsepower)$/;

  function aimAt(owner, target, speed) {
    if (!target) return owner.facingAngle();
    const d = U.dist(owner.x, owner.y, target.x, target.y);
    const lead = speed ? (d / speed) * 0.6 : 0;
    return U.angle(owner.x, owner.y, target.x + target.vx * lead, target.y + target.vy * lead);
  }

  function hits(target, x, y, r) {
    return target && target.canBeHit() && U.dist(x, y, target.x, target.y - target.bodyH * 0.35) < r + target.radius;
  }

  // ---------- Body animations (PMD sprite sheets, see fighter.playAnim) ----------
  // Slashing and chopping contact moves swing (Strike) instead of lunging (Attack).
  const SLASHING = /slash|cut|scissor|blade|sword|claw|chop|hammer|axe|cleave|kowtow|sacred-sword|razor-shell|false-swipe|fury-swipes|scratch|wing|whip|iron-tail|dragon-tail|aqua-tail|poison-tail|night-daze/;
  // Big contact moves that are still a full-body charge, so they keep the lunge.
  const BODY_CHARGE = /tackle|blitz|brave-bird|double-edge|take-down|head|bash|charge|rush|rollout|wave-crash|giga-impact|wild|collision|spin|roll|drive|dive|outrage|thrash|petal-dance|last-respects|bolt-strike|v-create/;
  // Physical projectiles that are fired or spat (Shoot); everything else physical is thrown (Strike).
  const FIRED_PHYSICAL = /seed|needle|missile|sting|dart|arrow|spike|shot|bullet|scale|pin|gunk|icicle-spear/;
  // Special moves spat or breathed from the mouth (Shoot); other special moves are cast (SpAttack).
  const SPIT = /water-gun|ember|sludge|acid|smog|bubble|scald|flamethrower|fire-blast|flame|inferno|incinerate|mud|octazooka|breath|powder-snow|poison-gas|hydro-pump|hydro-cannon|steam-eruption|snipe-shot|brine|water-pulse|venoshock|blast-burn|spit|burning-jealousy|scorching-sands|fiery-dance|pyro/;
  // Moves that used to fire instantly may now wait up to INSTANT for the hit frame, and nothing waits longer
  // than LATE past its scheduled moment (in case the animation is interrupted).
  const INSTANT = 0.08, LATE = 0.14;

  // Which animation a move releases with (cached on the move).
  function animOf(move) {
    if (move._anim) return move._anim;
    const s = move.slug, physical = move.category === "physical";
    let a;
    switch (move.shape) {
      case "dash": a = SLASHING.test(s) || (move.big && !BODY_CHARGE.test(s)) ? "Strike" : "Attack"; break;
      case "projectile": a = physical ? (FIRED_PHYSICAL.test(s) ? "Shoot" : "Strike") : SPIT.test(s) ? "Shoot" : "SpAttack"; break;
      case "stream": case "beam": a = SPIT.test(s) ? "Shoot" : physical ? "Strike" : "SpAttack"; break;
      case "strike": case "burst": a = physical ? "Strike" : "SpAttack"; break;
      case "buff": a = "Charge"; break;
      default: a = "SpAttack";
    }
    return (move._anim = a);
  }

  // Seconds (at speed 1) from an animation's start to its hit frame, and its full length, as the fighter
  // will play it. Without a sheet (GIF fighters) the hit lands after a fixed beat whatever the speed.
  function animTiming(owner, name) {
    const a = typeof owner.findAnim === "function" ? owner.findAnim(name) : null;
    return a ? { hit: a.hitAt, total: a.total, sheet: true } : { hit: 0.12, total: 0, sheet: false };
  }

  function canAnimate(owner) { return typeof owner.playAnim === "function"; }

  // Plays a one-shot animation sped up so that it lasts about `len` seconds (filler such as Charge).
  function playFor(owner, name, len) {
    if (!canAnimate(owner) || len <= 0.05) return;
    const t = animTiming(owner, name);
    if (!t.sheet) return;
    owner.playAnim(name, { speed: U.clamp(t.total / len, owner.tempo * 0.6, owner.tempo * 2.5) });
  }

  // Plays `name` so its hit frame lands `at` seconds from now, and runs fn on that frame. Wind-ups keep their
  // current length: if the hit frame is later the animation plays faster, and fn never fires before `at`
  // (telegraphs keep their full dodge window) nor more than LATE after it (in case the animation is cut short).
  // With `charge`, a Charge animation fills the time before the release animation starts.
  function release(b, owner, name, at, fn, charge) {
    if (!canAnimate(owner)) { b.schedule(at, fn); return; }
    const t = animTiming(owner, name);
    const speed = Math.min(Math.max(owner.tempo, t.hit / (at > 0 ? at : INSTANT)), owner.tempo * 4);
    let fired = false, hit = false, ready = at <= 0;
    const go = () => { if (!fired) { fired = true; fn(); } };
    const start = Math.max(0, at - (t.sheet ? t.hit / speed : t.hit));
    if (charge) playFor(owner, "Charge", start);
    const play = () => {
      if (!owner.active || owner.fainted) return;
      owner.playAnim(name, { speed, onHit: () => { hit = true; if (ready) go(); } });
    };
    if (start > 0) b.schedule(start, play); else play();
    if (!ready) b.schedule(at, () => { ready = true; if (hit) go(); });
    b.schedule(at + LATE, go);
  }

  // ---------- Projectile ----------
  function projectile(b, owner, target, move) {
    const physical = move.category === "physical";
    const multi = physical && move.power <= 40 ? 3 : 1;
    const speed = (physical ? 330 : move.big ? 250 : 300) * Math.sqrt(owner.tempo);
    const size = owner.might(move);
    const reach = owner.reach(move);
    // The first shot leaves on the throw/shoot frame; volleys follow it.
    release(b, owner, animOf(move), 0, () => {
      for (let i = 0; i < multi; i++) {
        b.schedule(i * 0.11, () => {
          if (!owner.active || owner.fainted) return;
          const ang = aimAt(owner, target, speed) + (multi > 1 ? U.rand(-0.12, 0.12) : 0);
          const ox = owner.x + Math.cos(ang) * owner.radius, oy = owner.y - owner.bodyH * 0.35 + Math.sin(ang) * owner.radius * 0.6;
          b.attacks.push({
            kind: "proj", owner, move, x: ox, y: oy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
            r: (move.big ? 9 : physical ? 4 : 6 + move.power / 40) * size, life: 1.8 * reach, t: 0, spin: U.rand(TAU),
            blast: 70 * size,
            powerScale: 1 / multi + (multi > 1 ? 0.12 : 0),
          });
          FX.burst(move.type, ox, oy, 4, 0.4);
        });
      }
    });
  }

  function updateProjectile(b, a, dt) {
    a.t += dt;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.spin += dt * 12;
    if (U.chance(0.75)) FX.burst(a.move.type, a.x, a.y, 1, 0.25);
    FX.light(a.x, a.y, a.r * 7, TYPES[a.move.type].fx[2], 0.7);
    const target = b.opponentOf(a.owner);
    if (hits(target, a.x, a.y, a.r)) {
      explode(b, a, target);
      return false;
    }
    if (b.blocked(a.x, a.y + 10, a.r) || a.t > a.life || !b.inBounds(a.x, a.y, -30)) {
      FX.burst(a.move.type, a.x, a.y, 8, 0.6);
      if (a.move.big) explode(b, a, null);
      return false;
    }
    return true;
  }

  function explode(b, a, direct) {
    const target = b.opponentOf(a.owner);
    const big = a.move.big;
    FX.burst(a.move.type, a.x, a.y, big ? 36 : 14, big ? 1.8 : 1);
    if (big) {
      FX.wave(a.x, a.y + 10, a.blast, a.move.type, 0.5);
      FX.addShake(6);
      FX.light(a.x, a.y, 160, TYPES[a.move.type].fx[1], 1);
      if (a.move.type === "fire") daimonji(a.x, a.y);
    }
    if (direct) b.hit(a.owner, direct, a.move, { powerScale: a.powerScale, angle: Math.atan2(a.vy, a.vx) });
    else if (big && target && U.dist(a.x, a.y, target.x, target.y) < a.blast) b.hit(a.owner, target, a.move, { angle: U.angle(a.x, a.y, target.x, target.y) });
  }

  // Fire Blast's iconic five-pointed flame burst.
  function daimonji(x, y) {
    for (let arm = 0; arm < 5; arm++) {
      const ang = -Math.PI / 2 + (arm * TAU) / 5;
      for (let i = 0; i < 9; i++) {
        const s = 40 + i * 22;
        FX.particle({ x, y, z: 10, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.7, life: 0.55, size: 6 - i * 0.4, grow: -4,
          colors: TYPES.fire.fx, add: true, drag: 0.86 });
      }
    }
  }

  function drawProjectile(ctx, a) {
    const c = TYPES[a.move.type].fx;
    const r = a.r;
    const physical = a.move.category === "physical";
    if (physical || a.move.type === "rock" || a.move.type === "ground") {
      ctx.save();
      ctx.translate(Math.round(a.x), Math.round(a.y));
      ctx.rotate(a.spin);
      ctx.fillStyle = c[2]; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = c[1]; ctx.fillRect(-r, -r, r, r);
      ctx.fillStyle = c[3] || c[2]; ctx.fillRect(0, 0, r, r);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [rm, col, al] of [[2.2, c[3] || c[2], 0.25], [1.5, c[2], 0.6], [1, c[1], 0.9], [0.5, "#ffffff", 1]]) {
      ctx.globalAlpha = al;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(Math.round(a.x), Math.round(a.y), r * rm, 0, TAU);
      ctx.fill();
    }
    if (a.move.type === "electric" && U.chance(0.4)) FX.bolt(a.x, a.y, a.x + U.rand(-20, 20), a.y + U.rand(-20, 20), c[2], 0.06, 1);
    if (a.move.type === "ghost" || a.move.type === "dark") {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#1a1028";
      ctx.beginPath(); ctx.arc(a.x, a.y, r * 0.8, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Beam ----------
  function beam(b, owner, target, move) {
    const dur = move.big ? 0.9 : 0.6;
    const charge = owner.windup(0.25);
    owner.channel(dur + charge);
    FX.ring(owner.x, owner.y - owner.bodyH * 0.35, 30, 4, TYPES[move.type].fx[1], charge, 2);
    release(b, owner, animOf(move), charge, () => {
      if (!owner.active || owner.fainted) return;
      owner.channel(dur);
      const ang = aimAt(owner, target, 0);
      b.attacks.push({ kind: "beam", owner, move, ang, t: 0, dur, ticks: 0, nextTick: 0,
        len: (move.big ? 460 : 360) * owner.reach(move), w: (move.big ? 16 : 10) * owner.might(move) });
      FX.addShake(move.big ? 5 : 2);
    });
  }

  function beamEnds(a) {
    const o = a.owner;
    const x1 = o.x + Math.cos(a.ang) * o.radius * 0.8, y1 = o.y - o.bodyH * 0.35 + Math.sin(a.ang) * o.radius * 0.5;
    return [x1, y1, x1 + Math.cos(a.ang) * a.len, y1 + Math.sin(a.ang) * a.len];
  }

  function updateBeam(b, a, dt) {
    a.t += dt;
    const target = b.opponentOf(a.owner);
    if (target && target.active) {
      // Beams sweep slowly toward the target, so sidestepping works.
      const want = U.angle(a.owner.x, a.owner.y, target.x, target.y);
      let diff = ((want - a.ang + Math.PI * 3) % TAU) - Math.PI;
      a.ang += U.clamp(diff, -1.1 * dt, 1.1 * dt);
    }
    a.owner.faceAngle(a.ang);
    const [x1, y1, x2, y2] = beamEnds(a);
    const w = a.w;
    FX.burst(a.move.type, x2 - Math.cos(a.ang) * 6, y2, 2, 0.6);
    const ticks = 4;
    if (a.t >= a.nextTick && a.ticks < ticks) {
      a.nextTick += a.dur / ticks;
      a.ticks++;
      if (target && target.canBeHit() && U.segDist(target.x, target.y - target.bodyH * 0.35, x1, y1, x2, y2) < w * 0.6 + target.radius) {
        b.hit(a.owner, target, a.move, { powerScale: 1 / ticks + 0.08, angle: a.ang, quiet: a.ticks > 1 });
        FX.burst(a.move.type, target.x, target.y - target.bodyH * 0.35, 8, 1);
      }
    }
    return a.t < a.dur && a.owner.active && !a.owner.fainted;
  }

  function drawBeam(ctx, a) {
    const [x1, y1, x2, y2] = beamEnds(a);
    const w = a.w;
    const c = TYPES[a.move.type].fx;
    const k = a.t / a.dur;
    const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
    const len = Math.hypot(x2 - x1, y2 - y1) * Math.min(1, a.t / 0.08);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(a.ang);
    ctx.globalCompositeOperation = "lighter";
    const wob = Math.sin(a.t * 70) * 1.5;
    for (const [wm, col, al] of [[2.4, c[3] || c[2], 0.3], [1.4, c[2], 0.7], [0.75, c[1], 0.95], [0.32, "#fff", 1]]) {
      const ww = w * wm + wob;
      ctx.globalAlpha = al * fade;
      ctx.fillStyle = col;
      ctx.fillRect(0, -ww / 2, len, ww);
      ctx.beginPath(); ctx.arc(0, 0, ww * 0.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(len, 0, ww * 0.7, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 10; i++) {
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillRect((a.t * 1100 + i * 83) % Math.max(1, len), (U.hash(i, 3) - 0.5) * w * 1.2, 12, 1);
    }
    ctx.restore();
    FX.light(x1, y1, w * 7, c[2], 0.8 * fade);
    FX.light((x1 + x2) / 2, (y1 + y2) / 2, len * 0.45, c[2], 0.45 * fade);
    FX.light(x1 + Math.cos(a.ang) * len, y1 + Math.sin(a.ang) * len, w * 8, c[1], 0.8 * fade);
  }

  // ---------- Stream (cone spray) ----------
  function stream(b, owner, target, move) {
    const dur = 0.75;
    owner.channel(dur);
    // The spray starts on the animation's hit frame; the channel restarts then so it still lasts `dur`.
    release(b, owner, animOf(move), 0, () => {
      if (!owner.active || owner.fainted) return;
      owner.channel(dur);
      b.attacks.push({ kind: "stream", owner, move, ang: aimAt(owner, target, 0), t: 0, dur, nextTick: 0.05, ticks: 0,
        range: 170 * owner.reach(move), cone: 0.34 * Math.sqrt(owner.might(move)) });
    });
  }

  function updateStream(b, a, dt) {
    a.t += dt;
    const o = a.owner;
    const target = b.opponentOf(o);
    if (target && target.active) {
      const want = U.angle(o.x, o.y, target.x, target.y);
      const diff = ((want - a.ang + Math.PI * 3) % TAU) - Math.PI;
      a.ang += U.clamp(diff, -1.6 * dt, 1.6 * dt);
    }
    o.faceAngle(a.ang);
    const ox = o.x + Math.cos(a.ang) * o.radius, oy = o.y - o.bodyH * 0.35 + Math.sin(a.ang) * o.radius * 0.5;
    const range = a.range;
    const spread = a.cone / 0.34;
    const c = TYPES[a.move.type].fx;
    // A bright additive core with solid, type-coloured puffs around it keeps the stream readable.
    for (let i = 0; i < 4; i++) {
      const core = i === 0;
      const ang = a.ang + U.rand(-0.22, 0.22) * spread * (core ? 0.4 : 1);
      const s = U.rand(260, 380);
      FX.particle({ x: ox, y: oy, z: 0, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life: range / s, size: core ? 2.5 : U.rand(3, 5),
        grow: (core ? 2 : 7) * spread, colors: core ? c.slice(0, 2) : c.slice(1), add: core, drag: 0.97, shape: a.move.type === "poison" ? "bubble" : "sq" });
    }
    FX.light(ox + Math.cos(a.ang) * range * 0.35, oy + Math.sin(a.ang) * range * 0.35, range * 0.53, c[2], 0.45);
    const ticks = 5;
    if (a.t >= a.nextTick && a.ticks < ticks) {
      a.nextTick += a.dur / ticks;
      a.ticks++;
      if (target && target.canBeHit()) {
        const d = U.dist(ox, oy, target.x, target.y - target.bodyH * 0.35);
        const ang = U.angle(ox, oy, target.x, target.y - target.bodyH * 0.35);
        const off = Math.abs(((ang - a.ang + Math.PI * 3) % TAU) - Math.PI);
        if (d < range + target.radius && off < a.cone + target.radius / Math.max(d, 1)) {
          b.hit(o, target, a.move, { powerScale: 1 / ticks + 0.06, angle: a.ang, quiet: a.ticks > 1, knock: 0.4 });
        }
      }
    }
    return a.t < a.dur && o.active && !o.fainted;
  }

  // ---------- Bolt (instant lightning with a short dodge window) ----------
  function bolt(b, owner, target, move) {
    if (!target) return;
    const delay = owner.windup(0.22);
    const r = 28 * owner.might(move);
    owner.channel(delay + 0.08);
    const tx = target.x, ty = target.y;
    FX.telegraph(tx, ty, r - 2, TYPES[move.type].fx[2], delay);
    b.danger(tx, ty, r, delay, owner);
    FX.emit.electric(owner.x, owner.y - owner.bodyH * 0.5, 8, 0.6);
    release(b, owner, animOf(move), delay, () => {
      if (!owner.active || owner.fainted) return;
      const sx = owner.x, sy = owner.y - owner.bodyH * 0.5;
      for (let i = 0; i < 3; i++) FX.bolt(sx, sy, tx + U.rand(-6, 6), ty - 8 + U.rand(-6, 6), TYPES[move.type].fx[2], 0.22, 2.5 - i * 0.6);
      FX.emit.electric(tx, ty - 8, 16, 1);
      FX.addFlash(0.12, "#fff8c0");
      if (target.canBeHit() && U.dist(tx, ty, target.x, target.y) < r + target.radius) {
        b.hit(owner, target, move, { angle: U.angle(sx, sy, tx, ty) });
      }
    });
  }

  // ---------- Strike (telegraphed area at the target) ----------
  function strike(b, owner, target, move) {
    if (!target) return;
    owner.channel(0.35);
    const lead = 0.35;
    const x = U.clamp(target.x + target.vx * lead, b.arena.field.x, b.arena.field.x + b.arena.field.w);
    const y = U.clamp(target.y + target.vy * lead, b.arena.field.y, b.arena.field.y + b.arena.field.h);
    const r = (move.big ? 64 : 46) * owner.might(move);
    const delay = owner.windup(move.big ? 0.95 : 0.75);
    const vortex = /fire-spin|whirlpool|sand-tomb|magma-storm|leaf-tornado|twister|hurricane|bleakwind|springtide|wildbolt|sandsear/.test(move.slug);
    FX.telegraph(x, y, r, TYPES[move.type].fx[2], delay);
    b.danger(x, y, r, vortex ? delay + 1.4 : delay, owner);
    FX.burst(move.type, owner.x, owner.y - owner.bodyH * 0.6, 8, 0.6);
    // The user charges and launches while it stands still; the impact itself keeps the telegraph's timing.
    release(b, owner, animOf(move), Math.min(0.3, delay), () => {}, true);
    if (vortex) {
      b.schedule(delay * 0.5, () => b.attacks.push({ kind: "vortex", owner, move, x, y, r, t: 0, dur: 1.4, nextTick: delay * 0.5, ticks: 0 }));
      return;
    }
    // Falling objects (rocks, meteors, lightning) arrive while the marker fills.
    const falling = /rock|ground|steel|dragon/.test(move.type) || /meteor|draco/.test(move.slug);
    if (falling) {
      for (let i = 0; i < (move.big ? 6 : 4); i++) {
        b.schedule(delay - 0.35 + i * 0.05, () => {
          FX.particle({ x: x + U.rand(-r * 0.6, r * 0.6), y: y + U.rand(-r * 0.3, r * 0.3), z: 220, vz: -620, g: 0, life: 0.34,
            size: U.rand(6, 10), colors: TYPES[move.type].fx.slice(1), shape: move.type === "dragon" ? "sq" : "chunk", add: move.type === "dragon", drag: 1, rot: U.rand(TAU), vr: 6 });
        });
      }
    }
    b.schedule(delay, () => {
      if (move.type === "electric") {
        for (let i = 0; i < 3; i++) FX.bolt(x + U.rand(-8, 8), y - 260, x + U.rand(-10, 10), y, "#fff59a", 0.3, 3 - i * 0.7);
        FX.addFlash(0.3, "#fff6c0");
      } else if (move.type === "ice") {
        for (let i = 0; i < 7; i++) FX.emit.ice(x + U.rand(-r, r) * 0.6, y + U.rand(-r, r) * 0.4, 6, 1);
      } else {
        FX.pillar(x, y, move.type, 0.55, r * 0.6, move.big ? 170 : 120);
      }
      FX.burst(move.type, x, y, move.big ? 40 : 24, move.big ? 2 : 1.4);
      FX.wave(x, y, r * 1.2, move.type, 0.5);
      FX.addShake(move.big ? 9 : 5);
      FX.light(x, y - 30, r * 3, TYPES[move.type].fx[1], 1);
      if (target.canBeHit() && U.dist(x, y, target.x, target.y) < r + target.radius * 0.5) {
        b.hit(owner, target, move, { angle: U.angle(x, y, target.x, target.y) });
      }
    });
  }

  function updateVortex(b, a, dt) {
    a.t += dt;
    const c = TYPES[a.move.type].fx;
    for (let i = 0; i < 6; i++) {
      const ang = a.t * 9 + i * (TAU / 6);
      const rr = a.r * (0.4 + 0.6 * ((a.t * 2 + i / 6) % 1));
      FX.particle({ x: a.x + Math.cos(ang) * rr, y: a.y + Math.sin(ang) * rr * 0.6, z: ((a.t * 80 + i * 13) % 70), vz: 50,
        life: 0.3, size: U.rand(2, 5), colors: c, add: a.move.type !== "ground", drag: 0.9 });
    }
    FX.light(a.x, a.y - 20, a.r * 2.5, c[2], 0.6);
    const target = b.opponentOf(a.owner);
    const ticks = 4;
    if (a.t >= a.nextTick && a.ticks < ticks) {
      a.nextTick += a.dur / ticks;
      a.ticks++;
      if (target && target.canBeHit() && U.dist(a.x, a.y, target.x, target.y) < a.r + target.radius * 0.5) {
        b.hit(a.owner, target, a.move, { powerScale: 1 / ticks + 0.1, angle: U.rand(TAU), quiet: a.ticks > 1, knock: 0.2 });
      }
    }
    return a.t < a.dur;
  }

  // ---------- Burst (area around the user, or around the target for psychic-like moves) ----------
  function burst(b, owner, target, move) {
    const atTarget = TARGETED_BURST.test(move.slug) && target;
    const r = (move.big ? 170 : 130) * owner.reach(move);
    owner.channel(owner.windup(0.35));
    if (atTarget) {
      const x = target.x, y = target.y;
      const tr = 42 * owner.might(move);
      const delay = owner.windup(0.4);
      FX.telegraph(x, y, tr - 2, TYPES[move.type].fx[2], delay);
      b.danger(x, y, tr, delay, owner);
      FX.emit.psychic(owner.x, owner.y - owner.bodyH * 0.5, 2);
      release(b, owner, animOf(move), delay, () => {
        FX.burst(move.type, x, y - 10, 22, 1.4);
        for (let i = 0; i < 4; i++) FX.ring(x, y - 10, 6, (40 + i * 14) * tr / 42, TYPES[move.type].fx[1 + (i % 2)], 0.35 + i * 0.08, 3);
        FX.addShake(4);
        if (target.canBeHit() && U.dist(x, y, target.x, target.y) < tr + target.radius * 0.5) b.hit(owner, target, move, { angle: U.angle(owner.x, owner.y, x, y) });
      }, true);
      return;
    }
    FX.ring(owner.x, owner.y, 40, 6, TYPES[move.type].fx[1], 0.3, 3);
    const delay = owner.windup(0.3);
    b.danger(owner.x, owner.y, r, delay + 0.3, owner);
    release(b, owner, animOf(move), delay, () => {
      if (!owner.active || owner.fainted) return;
      b.attacks.push({ kind: "burst", owner, move, x: owner.x, y: owner.y, r, t: 0, dur: 0.55, done: false });
      FX.wave(owner.x, owner.y, r, move.type, 0.6);
      FX.addShake(move.type === "ground" ? 10 : 5);
      if (move.type === "ground") FX.dust(owner.x, owner.y, 24, "#c8a878");
      if (move.type === "electric") for (let i = 0; i < 6; i++) FX.bolt(owner.x, owner.y - 10, owner.x + Math.cos(i) * r, owner.y + Math.sin(i) * r * 0.6, "#fff59a", 0.3, 2);
      if (move.type === "water") FX.emit.water(owner.x, owner.y, 40, 2.5);
      if (/explosion|self-destruct|misty-explosion|mind-blown/.test(move.slug)) {
        FX.addFlash(0.6, "#fff4d0");
        FX.burst("fire", owner.x, owner.y, 60, 3);
        owner.takeDamage(Math.ceil(owner.maxHp * (move.slug === "mind-blown" ? 0.5 : 1)), null);
      }
    }, true);
  }

  function updateBurst(b, a, dt) {
    a.t += dt;
    const k = a.t / a.dur;
    const front = a.r * U.easeOut(k);
    if (U.chance(0.8)) {
      const ang = U.rand(TAU);
      FX.burst(a.move.type, a.x + Math.cos(ang) * front, a.y + Math.sin(ang) * front * 0.62, 2, 0.5);
    }
    const target = b.opponentOf(a.owner);
    if (!a.done && target && target.canBeHit()) {
      const d = Math.hypot(target.x - a.x, (target.y - a.y) / 0.62);
      if (d < front + target.radius) {
        a.done = true;
        b.hit(a.owner, target, a.move, { angle: U.angle(a.x, a.y, target.x, target.y) });
      }
    }
    return a.t < a.dur;
  }

  // ---------- Dash (contact moves) ----------
  function dash(b, owner, target, move) {
    if (!target) return;
    const ang = aimAt(owner, target, 600);
    const dur = (move.big ? 0.32 : 0.24) * owner.reach(move);
    const speed = (move.big ? 640 : 560) * Math.sqrt(owner.tempo);
    owner.startDash(ang, speed, dur);
    // Contact decides the hit, so the lunge/swing is timed to reach its hit frame on the expected contact.
    if (canAnimate(owner)) {
      const gap = U.dist(owner.x, owner.y, target.x, target.y) - owner.radius - target.radius - 8;
      const contact = U.clamp(gap / speed, 0.06, dur);
      const name = animOf(move);
      owner.playAnim(name, { speed: U.clamp(animTiming(owner, name).hit / contact, owner.tempo * 0.7, owner.tempo * 3) });
    }
    b.attacks.push({ kind: "dash", owner, move, t: 0, dur: dur + 0.05, done: false, ang });
    FX.dust(owner.x, owner.y, 6);
  }

  function updateDash(b, a, dt) {
    a.t += dt;
    const o = a.owner;
    const c = TYPES[a.move.type].fx;
    FX.burst(a.move.type, o.x, o.y - o.bodyH * 0.4, 2, 0.3);
    if (a.move.type === "fire" || a.move.type === "electric" || a.move.big) FX.light(o.x, o.y - o.bodyH * 0.4, 70, c[2], 0.6);
    const target = b.opponentOf(o);
    if (!a.done && target && target.canBeHit() && U.dist(o.x, o.y, target.x, target.y) < o.radius + target.radius + 8) {
      a.done = true;
      o.endDash(0.4);
      const ix = (o.x + target.x) / 2, iy = (o.y + target.y) / 2 - target.bodyH * 0.4;
      FX.emit.impact(ix, iy, 10, c);
      FX.burst(a.move.type, ix, iy, a.move.big ? 26 : 12, a.move.big ? 1.6 : 1);
      if (a.move.big) FX.wave(ix, target.y, 60, a.move.type, 0.4);
      b.hit(o, target, a.move, { angle: a.ang, knock: a.move.big ? 1.6 : 1.2 });
    }
    return a.t < a.dur && !a.done;
  }

  // ---------- Buffs ----------
  function buff(b, owner, target, move) {
    const bf = move.buff || {};
    const c = TYPES[move.type].fx;
    owner.channel(0.3);
    playFor(owner, animOf(move), 0.45);
    FX.emit.sparkle(owner.x, owner.y - owner.bodyH * 0.5, 14, c);
    FX.ring(owner.x, owner.y, 8, 46, c[1], 0.5, 3);
    if (bf.splash) {
      FX.emit.water(owner.x, owner.y, 10, 0.6);
      b.say(`${owner.species.jp}の はねる！ しかし なにも おこらない！`);
      return;
    }
    if (bf.heal) {
      const amt = Math.round(owner.maxHp * bf.heal);
      owner.hp = Math.min(owner.maxHp, owner.hp + amt);
      FX.text(owner.x, owner.y - owner.bodyH - 10, `+${amt}`, { color: "#7dff8a", size: 13 });
      FX.emit.sparkle(owner.x, owner.y - owner.bodyH * 0.5, 20, ["#ffffff", "#c8ffc8", "#7dff8a"]);
      return;
    }
    if (bf.shield) {
      owner.shield = bf.shield;
      return;
    }
    owner.addBuff(bf, 10);
    FX.text(owner.x, owner.y - owner.bodyH - 10, bf.label || "能力アップ", { color: "#ffe066", size: 11 });
  }

  const USE = { projectile, beam, stream, bolt, strike, burst, dash, buff };
  const UPDATE = { proj: updateProjectile, beam: updateBeam, stream: updateStream, vortex: updateVortex, burst: updateBurst, dash: updateDash };
  const DRAW = { proj: drawProjectile, beam: drawBeam };

  function use(b, owner, move) {
    const target = b.opponentOf(owner);
    (USE[move.shape] || projectile)(b, owner, target, move);
  }

  // Ideal distance for the AI to fight from with a given move.
  function preferredRange(move, owner) {
    const k = owner && move.shape !== "buff" ? owner.reach(move) : 1;
    return baseRange(move) * k;
  }

  function baseRange(move) {
    switch (move.shape) {
      case "dash": return 40;
      case "stream": return 110;
      case "burst": return TARGETED_BURST.test(move.slug) ? 240 : 90;
      case "beam": return 220;
      case "bolt": return 200;
      case "strike": return 230;
      case "buff": return 260;
      default: return 210;
    }
  }

  function maxRange(move, owner) {
    const k = owner && move.shape !== "buff" ? owner.reach(move) : 1;
    return baseMaxRange(move) * k;
  }

  function baseMaxRange(move) {
    switch (move.shape) {
      case "dash": return 230;
      case "stream": return 175;
      case "burst": return TARGETED_BURST.test(move.slug) ? 360 : 125;
      case "beam": return move.big ? 440 : 340;
      case "bolt": return 330;
      case "strike": return 380;
      case "buff": return 9999;
      default: return 400;
    }
  }

  return { use, UPDATE, DRAW, preferredRange, maxRange };
})();
