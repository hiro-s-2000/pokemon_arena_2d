// A Pokémon on the field: movement, cooldowns, status, and its sprite rendering.
// Sprites are PMD sheet animations (8 facings; Idle/Walk loops plus one-shot moves, see
// playAnim), or the old GIFs for species the pokeAnim build has no art for.
"use strict";

// Where a missing one-shot animation falls back to. Ending on Idle (or nothing) means "no sheet".
// A few sets (Sirfetch'd, Jellicent, Mega Sceptile…) have no attack sheet at all; one quick
// step of Walk still reads as a lunge, where standing in Idle would look like nothing happened.
const ANIM_CHAIN = {
  Attack: ["Attack", "Walk"],
  Strike: ["Strike", "Attack", "Walk"],
  Shoot: ["Shoot", "SpAttack", "Attack", "Walk"],
  SpAttack: ["SpAttack", "Shoot", "Attack", "Walk"],
  Charge: ["Charge", "SpAttack", "Idle"],
  Hurt: ["Hurt", "Idle"],
  Faint: ["Faint", "Hurt"],
};
// When a fighter has no fitting sheet, the move still lands after this beat.
const NO_ANIM_HIT = 0.12;

class Fighter {
  constructor(species, side) {
    this.side = side;
    this.forms = Data.formsOf(species);
    this.formCd = 0;
    // Start loading the sheets of every form now so a transform never shows a blank frame.
    for (const f of [...this.forms.mega, ...this.forms.gigantamax, this.forms.root]) Sprites.anim(f.id, f.shiny ? f.shinyPair : null);
    this.setSpecies(species);
    this.hp = this.maxHp;
    this.dodgeCd = 0;
    this.reset();
  }

  setSpecies(species) {
    this.species = species;
    this.stats = Data.battleStats(species);
    this.profile = Data.profileOf(species);
    this.maxHp = this.stats.hp;
    this.moves = Data.movesFor(species);
    this.cooldowns = this.moves.map(() => 0);
    this.sprites = Sprites.preload(species);
    this.anim = Sprites.anim(species.id, species.shiny ? species.shinyPair : null);
    this.act = null;
    this.flying = species.types.includes("flying");
    this.swimmer = species.types.includes("water");
  }

  // Next form for a kind ("mega" / "gigantamax"): cycles through that kind's forms, then back to the ordinary form.
  nextForm(kind) {
    const list = this.forms[kind];
    if (!list.length) return null;
    const i = list.indexOf(this.species);
    return i < 0 ? list[0] : list[i + 1] || this.forms.root;
  }

  canTransform(kind) { return !!this.nextForm(kind) && this.formCd <= 0 && this.canAct(); }

  transform(kind, battle) {
    if (!this.canTransform(kind)) return false;
    const next = this.nextForm(kind);
    const ratio = this.hp / this.maxHp;
    const cds = this.cooldowns;
    this.setSpecies(next);
    this.hp = Math.max(1, Math.round(this.maxHp * ratio));
    this.cooldowns = this.moves.map((m, i) => Math.min(cds[i] || 0, this.cooldownOf(m)));
    this.formCd = 1.5;
    battle.onTransform(this, kind);
    return true;
  }

  // Switch this fighter between its normal and shiny colours mid-battle (HP, cooldowns and form
  // kept). Returns false when the current form has no shiny art.
  setShiny(on, battle) {
    const next = on ? Data.shinyOf(this.species) : Data.plainOf(this.species);
    if (next === this.species) return false;
    const hp = this.hp, cds = this.cooldowns, formCd = this.formCd;
    this.forms = Data.formsOf(next);
    for (const f of [...this.forms.mega, ...this.forms.gigantamax, this.forms.root]) Sprites.anim(f.id, f.shiny ? f.shinyPair : null);
    this.setSpecies(next);
    this.hp = hp; this.cooldowns = cds; this.formCd = formCd;
    if (battle) battle.onShiny(this);
    return true;
  }

  reset() {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.kx = 0; this.ky = 0;
    this.face = { x: this.side ? -1 : 1, y: 0 };
    this.state = "bench";
    this.active = false;
    this.stateT = 0;
    this.channelT = 0;
    this.dashT = 0; this.dashVX = 0; this.dashVY = 0;
    this.invuln = 0;
    this.shield = 0;
    this.buffs = [];
    this.status = {};
    this.hitFlash = 0;
    this.ghosts = [];
    this.ghostT = 0;
    this.lastMove = null;
    this.moveLabelT = 0;
    this.walkT = 0;
    this.animT = U.rand(0, 2);
    this.loopT = U.rand(0, 2);
    this.act = null;
    this.pendingHits = [];
    this.row = Sprites.dirRow(this.face.x, this.face.y);
    this.inWater = false;
    this.cooldowns = this.moves.map(() => 0);
  }

  get fainted() { return this.hp <= 0; }

  // The sprite is scaled so its height matches the Pokémon's real height (see Data.profileOf):
  // a sheet's measured body height, or the whole GIF canvas height.
  get spriteScale() {
    if (this.anim) return this.profile.bodyH / this.anim.bodyH;
    return this.gifScale;
  }
  get gifScale() {
    const rec = this.sprites[0];
    return this.profile.bodyH / (rec.ready ? rec.h : 80);
  }
  get bodyH() { return this.profile.bodyH; }
  // Still measured on the GIF so hitboxes stay the same whichever art is drawn.
  get radius() { const r = this.sprites[0]; return U.clamp((r.ready ? r.w : 80) * this.gifScale * 0.32, 8, 42); }
  // Every image a battle should wait for before it starts.
  get loadRecs() { return this.sprites.concat(Sprites.animRecs(this.anim)); }

  get tempo() { return this.profile.tempo; }
  // Faster Pokémon recover from moves and dodges sooner.
  cooldownOf(m) { return m.cooldown / this.tempo; }
  get dodgeMax() { return 1.4 / this.tempo; }
  might(move) {
    const special = move.category === "special";
    return Data.mightOf((special ? this.stats.spa : this.stats.atk) * this.attackMult(special));
  }
  // How far a move carries: stronger attackers throw further; big bodies add reach to close-range moves.
  reach(move) {
    const close = move.shape === "dash" || move.shape === "stream" || move.shape === "burst";
    return Math.pow(this.might(move), 0.6) * (close ? this.profile.bodyReach : 1);
  }
  // Wind-up before a move lands. Fast Pokémon fire sooner, but never so fast the telegraph is undodgeable.
  windup(t) { return t / Math.sqrt(this.tempo); }
  get weight() { return this.profile.weightKg; }

  facingAngle() { return Math.atan2(this.face.y, this.face.x); }
  faceAngle(a) { this.face.x = Math.cos(a); this.face.y = Math.sin(a); }

  canBeHit() { return this.active && this.state === "fight" && this.invuln <= 0; }
  canAct() { return this.state === "fight" && this.channelT <= 0 && this.dashT <= 0 && !this.status.freeze; }

  sendOut(x, y, fromX, fromY) {
    this.reset();
    this.x = x; this.y = y;
    this.state = "enter";
    this.active = true;
    this.ball = { fx: fromX, fy: fromY };
    // Opening cooldowns so nobody is hit the instant they appear.
    this.cooldowns = this.moves.map((m, i) => 0.4 + i * 0.25);
  }

  channel(t) { this.channelT = Math.max(this.channelT, t); }

  startDash(ang, speed, dur) {
    this.dashT = dur;
    this.dashVX = Math.cos(ang) * speed;
    this.dashVY = Math.sin(ang) * speed;
    this.faceAngle(ang);
  }
  endDash(recoil) {
    this.dashT = 0;
    this.kx = -this.dashVX * 0.25 * recoil;
    this.ky = -this.dashVY * 0.25 * recoil;
  }

  addBuff(bf, dur) {
    this.buffs = this.buffs.filter((b) => b.bf.label !== bf.label);
    this.buffs.push({ bf, t: dur });
  }

  attackMult(special) {
    let m = 1;
    for (const { bf } of this.buffs) {
      if (bf.stat === "both" || (bf.stat === "spa" && special) || (bf.stat === "atk" && !special)) m *= bf.mult || 1;
    }
    if (this.status.burn && !special) m *= 0.6;
    return m;
  }
  defenseMult() {
    let m = 1;
    for (const { bf } of this.buffs) m *= bf.def || 1;
    return m;
  }
  speedMult() {
    let m = 1;
    for (const { bf } of this.buffs) m *= bf.speed || 1;
    if (this.status.para) m *= 0.55;
    if (this.inWater && !this.swimmer && !this.flying) m *= 0.72;
    if (this.channelT > 0) m *= 0.15;
    return m;
  }

  get moveSpeed() { return this.profile.runSpeed * this.speedMult(); }

  takeDamage(amount, attacker) {
    if (this.shield > 0 && attacker) {
      FX.ring(this.x, this.y - this.bodyH * 0.4, this.radius + 10, this.radius + 22, "#9ff0ff", 0.25, 3);
      return 0;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 1;
    return amount;
  }

  dodge(dirX, dirY) {
    if (this.dodgeCd > 0 || !this.canAct()) return false;
    let dx = dirX, dy = dirY;
    if (!dx && !dy) { dx = -this.face.x; dy = -this.face.y; }
    const len = Math.hypot(dx, dy) || 1;
    this.startDash(Math.atan2(dy / len, dx / len), 430 * Math.sqrt(this.tempo), 0.2);
    this.invuln = 0.3;
    this.dodgeCd = this.dodgeMax;
    FX.dust(this.x, this.y, 6);
    return true;
  }

  update(dt, battle, intent) {
    this.stateT += dt;
    this.animT += dt * this.tempo;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.moveLabelT = Math.max(0, this.moveLabelT - dt);
    this.updateAnim(dt);

    if (this.state === "enter") {
      if (this.stateT > 1.05) { this.state = "fight"; this.stateT = 0; }
      return;
    }
    if (this.state === "faint") {
      this.pendingHits.length = 0;
      if (this.stateT > 1.1) { this.state = "out"; this.active = false; }
      return;
    }
    if (this.state !== "fight") return;

    // Moves waiting for their animation's hit frame. These run on battle time, not on the
    // drawn animation, so a Hurt or a freeze that cuts the swing short never drops the move.
    if (this.pendingHits.length) {
      for (const h of this.pendingHits) h.t -= dt;
      const due = this.pendingHits.filter((h) => h.t <= 0);
      this.pendingHits = this.pendingHits.filter((h) => h.t > 0);
      due.forEach((h) => h.fn());
    }

    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.formCd = Math.max(0, this.formCd - dt);
    this.channelT = Math.max(0, this.channelT - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.buffs.forEach((b) => (b.t -= dt));
    this.buffs = this.buffs.filter((b) => b.t > 0);
    this.updateStatus(dt, battle);

    // Movement
    let ax = 0, ay = 0;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashVX; this.vy = this.dashVY;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.035; this.ghosts.push({ x: this.x, y: this.y, t: 0, fr: this.currentFrame() }); }
    } else {
      if (this.canAct() || this.channelT > 0) {
        ax = intent.mx; ay = intent.my;
        const len = Math.hypot(ax, ay);
        if (len > 1) { ax /= len; ay /= len; }
      }
      const sp = this.status.freeze ? 0 : this.moveSpeed;
      const blend = 1 - Math.pow(this.profile.grip, dt);
      this.vx = U.lerp(this.vx, ax * sp, blend);
      this.vy = U.lerp(this.vy, ay * sp, blend);
      if (len2(ax, ay) > 0.01 && this.channelT <= 0) { this.face.x = ax; this.face.y = ay; }
    }
    this.kx *= Math.pow(0.004, dt);
    this.ky *= Math.pow(0.004, dt);
    const nx = this.x + (this.vx + this.kx) * dt;
    const ny = this.y + (this.vy + this.ky) * dt;
    [this.x, this.y] = battle.resolveMove(this, nx, ny);
    const moving = Math.hypot(this.vx, this.vy) > 20;
    this.walkT += dt * (moving ? 1 : 0.35);

    const wasInWater = this.inWater;
    this.inWater = !this.flying && battle.arena.isWater(this.x, this.y);
    if (this.inWater && (moving || !wasInWater) && U.chance(moving ? 0.25 : 0.02)) {
      FX.ring(this.x, this.y, this.radius * 0.6, this.radius * 1.6, "#d8f0ff", 0.6, 1.5);
    }
    if (!this.inWater && moving && !this.flying && U.chance(0.06)) FX.dust(this.x, this.y, 1);

    for (const g of this.ghosts) g.t += dt;
    this.ghosts = this.ghosts.filter((g) => g.t < 0.25);

    // Face the opponent when standing still, as fighters do in the reference footage.
    const foe = battle.opponentOf(this);
    if (foe && !moving && this.channelT <= 0) {
      const a = U.angle(this.x, this.y, foe.x, foe.y);
      this.face.x = U.lerp(this.face.x, Math.cos(a), 0.1);
      this.face.y = U.lerp(this.face.y, Math.sin(a), 0.1);
    }

    if (intent.form) this.transform(intent.form, battle);
    if (intent.dodge) this.dodge(intent.mx, intent.my);
    if (intent.move !== undefined && intent.move !== null) this.tryMove(intent.move, battle);
  }

  tryMove(i, battle) {
    const m = this.moves[i];
    if (!m || this.cooldowns[i] > 0 || !this.canAct()) return false;
    this.cooldowns[i] = this.cooldownOf(m);
    this.lastMove = m;
    this.moveLabelT = 1.4;
    const foe = battle.opponentOf(this);
    if (foe) this.faceAngle(U.angle(this.x, this.y, foe.x, foe.y));
    Moves.use(battle, this, m);
    battle.onMoveUsed(this, m);
    return true;
  }

  updateStatus(dt, battle) {
    const s = this.status;
    for (const k of Object.keys(s)) {
      s[k] -= dt;
      if (s[k] <= 0) delete s[k];
    }
    const tick = (Math.floor(this.stateT * 2) !== Math.floor((this.stateT - dt) * 2));
    if (s.burn) {
      if (U.chance(0.3)) FX.emit.fire(this.x + U.rand(-8, 8), this.y - this.bodyH * U.rand(0.2, 0.8), 1, 0.2);
      if (tick) this.takeDot(0.02, battle);
    }
    if (s.poison) {
      if (U.chance(0.15)) FX.emit.poison(this.x, this.y - this.bodyH * 0.6, 1);
      if (tick) this.takeDot(0.025, battle);
    }
    if (s.para && U.chance(0.12)) FX.emit.electric(this.x, this.y - this.bodyH * 0.5, 2, 0.3);
    if (battle.arena.isLava(this.x, this.y) && !this.flying && !this.species.types.includes("fire")) {
      if (U.chance(0.5)) FX.emit.fire(this.x, this.y, 1, 0.3);
      if (tick) this.takeDot(0.03, battle);
    }
  }

  takeDot(frac, battle) {
    const amt = Math.max(1, Math.round(this.maxHp * frac));
    this.hp = Math.max(0, this.hp - amt);
    FX.text(this.x, this.y - this.bodyH - 4, `${amt}`, { color: "#ffb0b0", size: 9, dur: 0.6 });
    if (this.hp <= 0) battle.onFaint(this);
  }

  // ---------- Animation ----------

  // Plays a one-shot sheet animation (Attack, Strike, Shoot, SpAttack, Charge, Hurt, Faint),
  // falling back along ANIM_CHAIN. onHit fires at the sheet's hit frame (55% through when it has
  // none). speed defaults to the fighter's tempo. Returns the animation's length in seconds.
  playAnim(name, { onHit, speed, hold } = {}) {
    // A move released by a timer after its user fainted must not replace the Faint pose.
    if ((this.state === "faint" || this.state === "out") && name !== "Faint") return 0;
    speed = speed || this.tempo;
    const a = this.findAnim(name);
    if (!a) {
      // No Faint or Hurt sheet: drop the swing in progress so the body squashes like a GIF.
      if (name === "Faint") this.act = null;
      // GIF fighters (or no fitting sheet): keep what is playing, land the hit after a short beat.
      if (onHit) this.pendingHits.push({ t: NO_ANIM_HIT, fn: onHit });
      return NO_ANIM_HIT;
    }
    // Faint keeps its last frame while the body fades.
    this.act = { a, t: 0, speed, hold: hold ?? name === "Faint" };
    if (onHit) {
      if (a.hitAt <= 0) onHit();
      else this.pendingHits.push({ t: a.hitAt / speed, fn: onHit });
    }
    return a.total / speed;
  }

  findAnim(name) {
    if (!this.anim) return null;
    for (const n of ANIM_CHAIN[name] || [name]) {
      if (n === "Idle") return null;
      const a = this.anim.anims[n];
      if (a && !a.rec.failed) return a;
    }
    return null;
  }

  // Name of the one-shot animation playing, or null while looping Idle/Walk.
  get animName() { return this.act ? this.act.a.name : null; }

  updateAnim(dt) {
    this.updateRow();
    // Frozen fighters stop mid-frame.
    if (this.status.freeze && this.state === "fight") return;
    const speed = Math.hypot(this.vx, this.vy);
    // Walk cycles keep pace with the actual running speed (slower when paralysed or wading).
    const pace = speed > 20 ? U.clamp(speed / this.profile.runSpeed, 0.6, 1.4) : 1;
    this.loopT += dt * this.tempo * pace;
    if (this.act) {
      this.act.t += dt * this.act.speed;
      if (!this.act.hold && this.act.t >= this.act.a.total) this.act = null;
    }
  }

  // Facing row from this.face, with a little hysteresis so a fighter tracking its foe near a
  // boundary between two rows doesn't flicker between them.
  updateRow() {
    const fx = this.face.x, fy = this.face.y;
    if (fx * fx + fy * fy < 1e-4) return;
    const center = Math.PI / 2 - this.row * Math.PI / 4;
    const off = Math.abs(((Math.atan2(fy, fx) - center) % TAU + TAU * 1.5) % TAU - Math.PI);
    if (off > Math.PI / 8 + 0.12) this.row = Sprites.dirRow(fx, fy);
  }

  // The frame to draw now: {img, sx, sy, sw, sh, ax, ay, sink, s, sheet}, or null while nothing is loaded.
  // (ax, ay) is the feet point in source pixels and s the draw scale.
  currentFrame() {
    const set = this.anim;
    if (set) {
      let a = null, t = this.loopT, loop = true;
      if (this.act && this.act.a.rec.ready) {
        a = this.act.a; t = this.act.t; loop = false;
      } else {
        const idle = set.anims.Idle, walk = set.anims.Walk;
        const moving = Math.hypot(this.vx, this.vy) > 20;
        if (moving && walk && walk.rec.ready) a = walk;
        // Some sheets have a single still Idle frame; stepping in place (as in PMD) reads better.
        else if (idle.frames <= 1 && walk && walk.rec.ready) { a = walk; t *= 0.6; }
        else if (idle.rec.ready) a = idle;
      }
      if (a) {
        const fr = Sprites.sheetFrame(set, a, this.row, t, loop);
        fr.s = this.profile.bodyH / set.bodyH;
        fr.sheet = true;
        return fr;
      }
    }
    const rec = this.currentSprite();
    if (!rec.ready) return null;
    const fr = Sprites.gifFrame(rec, this.animT);
    fr.s = this.profile.bodyH / rec.h;
    fr.sheet = false;
    return fr;
  }

  // On-screen body box used by the shield bubble and the waterline: the GIF canvas, or the
  // sheet's measured body widened a little to match the padding GIF canvases had.
  bodyBox(fr) {
    if (!fr.sheet) return { w: fr.sw * fr.s, h: fr.sh * fr.s };
    return { w: Math.max(this.anim.bodyW * fr.s * 1.25, this.profile.bodyH * 0.8), h: this.profile.bodyH };
  }

  // ---------- Rendering ----------

  currentSprite() {
    // front.gif faces left, front-reverse faces right; back.gif looks right, back-reverse looks left.
    const right = this.face.x >= 0;
    const away = this.face.y < -0.55;
    const [front, frontR, back, backR] = this.sprites;
    let rec = away ? (right ? back : backR) : (right ? frontR : front);
    if (!rec.ready) rec = this.sprites.find((r) => r.ready) || rec;
    return rec;
  }

  hover() {
    return this.flying ? 7 + Math.sin(this.walkT * 4) * 2.5 : 0;
  }

  drawShadow(ctx) {
    if (!this.active || this.state === "enter" && this.stateT < 0.6) return;
    const r = this.radius;
    const fade = this.state === "faint" ? 1 - this.stateT / 1.1 : 1;
    ctx.save();
    ctx.globalAlpha = (this.inWater ? 0.18 : 0.38) * fade;
    ctx.fillStyle = "#0a1018";
    const hs = 1 - this.hover() / 30;
    ctx.beginPath();
    ctx.ellipse(Math.round(this.x), Math.round(this.y), r * 1.1 * hs, r * 0.45 * hs, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Long cast shadow from the sun in the upper left.
    const fr = this.currentFrame();
    if (!fr || this.inWater) return;
    const s = fr.s;
    const sil = Sprites.tinted(fr, "#08121a");
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.26 * fade;
    ctx.translate(Math.round(this.x), Math.round(this.y));
    // Flip the silhouette onto the ground so it falls toward the lower right.
    ctx.transform(1, 0, -0.55, -0.38, 0, 0);
    ctx.drawImage(sil, 0, 0, fr.sw, fr.sh, -fr.ax * s, -fr.ay * s, fr.sw * s, fr.sh * s);
    ctx.restore();
  }

  draw(ctx, time) {
    if (!this.active) return;
    if (this.state === "enter") return this.drawEnter(ctx);
    const fr = this.currentFrame();
    if (!fr) return;
    const s = fr.s;
    const { w, h } = this.bodyBox(fr);
    let alpha = 1;
    let sy = 1;
    if (this.state === "faint") {
      const k = this.stateT / 1.1;
      alpha = 1 - k;
      // Sheets play their own Faint/Hurt; only still art needs squashing.
      if (!this.act) sy = 1 - k * 0.5;
    }
    // GIFs get a little breathing and a walk bob; sheets animate their own limbs.
    const moving = Math.hypot(this.vx, this.vy) > 20 && this.dashT <= 0;
    const breathe = fr.sheet ? 1 : 1 + Math.sin(time * 3 * this.tempo + this.side) * 0.015;
    const bob = !fr.sheet && moving ? Math.abs(Math.sin(this.walkT * 9 * this.tempo)) * 2 * Math.sqrt(this.bodyH / 60) : 0;
    const hov = this.hover();
    const dw = fr.sw * s, dh = fr.sh * s * sy * breathe;
    const dx = Math.round(this.x - fr.ax * s);
    const dy = Math.round(this.y - fr.ay * s * sy * breathe + fr.sink - bob - hov);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const ghostCol = TYPES[this.species.types[0]].fx[1];
    for (const g of this.ghosts) {
      const gf = g.fr;
      if (!gf) continue;
      ctx.globalAlpha = 0.35 * (1 - g.t / 0.25);
      ctx.drawImage(Sprites.tinted(gf, ghostCol), 0, 0, gf.sw, gf.sh,
        Math.round(g.x - gf.ax * gf.s), Math.round(g.y - gf.ay * gf.s + gf.sink - hov), gf.sw * gf.s, gf.sh * gf.s);
    }
    ctx.globalAlpha = alpha * (this.invuln > 0 && this.dashT <= 0 ? 0.6 : 1);

    const line = this.y - h * (this.swimmer ? 0.22 : 0.3);
    if (this.inWater) {
      // Submerge the lower part of the body below the waterline.
      ctx.beginPath();
      ctx.rect(dx - 4, Math.min(dy, line) - 20, dw + 8, line - (Math.min(dy, line) - 20));
      ctx.clip();
    }
    ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, dw, dh);
    if (this.status.freeze) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(Sprites.tinted(fr, "#bfefff"), 0, 0, fr.sw, fr.sh, dx, dy, dw, dh);
    }
    if (this.hitFlash > 0) {
      ctx.globalAlpha = this.hitFlash * alpha;
      ctx.drawImage(Sprites.tinted(fr, "#ffffff"), 0, 0, fr.sw, fr.sh, dx, dy, dw, dh);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if (this.inWater) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#e6f6ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(this.x, line + 1, w * 0.42, 3 + Math.sin(time * 6) * 0.6, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (this.shield > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35 + Math.sin(time * 20) * 0.1;
      ctx.strokeStyle = "#9ff0ff";
      ctx.fillStyle = "rgba(120,220,255,0.12)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - h * 0.45, w * 0.62, h * 0.62, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (this.buffs.length && U.chance(0.25)) {
      FX.particle({ x: this.x + U.rand(-w / 3, w / 3), y: this.y, z: U.rand(0, h * 0.6), vz: 40, life: 0.6, size: 2,
        colors: ["#fff6b0", "#ffd84a", "#ff9a2a"], add: true, shape: "twinkle", drag: 0.95 });
    }
  }

  drawEnter(ctx) {
    const t = this.stateT;
    const ball = Sprites.get("../pokeSprite/items/poke-ball.png");
    if (t < 0.6) {
      const k = t / 0.6;
      const bx = U.lerp(this.ball.fx, this.x, k);
      const by = U.lerp(this.ball.fy, this.y, k) - Math.sin(k * Math.PI) * 90;
      if (ball.ready) {
        ctx.save();
        ctx.translate(Math.round(bx), Math.round(by - 6));
        ctx.rotate(k * 12);
        ctx.drawImage(ball.img, -ball.w / 4, -ball.h / 4, ball.w / 2, ball.h / 2);
        ctx.restore();
      }
      ctx.fillStyle = "rgba(10,16,24,0.3)";
      ctx.beginPath();
      ctx.ellipse(U.lerp(this.ball.fx, this.x, k), U.lerp(this.ball.fy, this.y, k), 5, 2, 0, 0, TAU);
      ctx.fill();
      return;
    }
    const fr = this.currentFrame();
    if (!fr) return;
    const k = U.clamp((t - 0.6) / 0.35, 0, 1);
    const sc = fr.s * U.easeOutBack(k);
    const w = fr.sw * sc, h = fr.sh * sc;
    const dx = Math.round(this.x - fr.ax * sc), dy = Math.round(this.y - fr.ay * sc + fr.sink - this.hover());
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, w, h);
    ctx.globalAlpha = 1 - k;
    ctx.drawImage(Sprites.tinted(fr, "#ffffff"), 0, 0, fr.sw, fr.sh, dx, dy, w, h);
    ctx.restore();
  }
}

function len2(x, y) { return x * x + y * y; }
