// Battle state: teams, active fighters, attacks, damage resolution and the match flow.
"use strict";

class Battle {
  constructor({ teams, arenaId, mode, skill, cpuAttack = true }) {
    this.arena = Arenas.create(arenaId);
    this.mode = mode;
    this.teams = teams.map((t, side) => t.map((sp) => new Fighter(sp, side)));
    this.active = [null, null];
    this.controllers = [mode === "watch" ? new AIController(null, skill) : null, new AIController(null, skill)];
    this.skill = skill;
    // Practice: the CPU still moves and dodges but never uses a move.
    this.cpuAttack = cpuAttack;
    this.attacks = [];
    this.timers = [];
    this.dangers = [];
    this.time = 0;
    this.captions = [];
    this.callouts = [];
    this.koBanner = 0;
    this.over = false;
    this.winner = null;
    this.endT = 0;
    this.switchCd = [0, 0];
    this.crowdHype = 0;
    this.intro = 1.6;
    FX.reset();
  }

  get W() { return this.arena.W; }
  get H() { return this.arena.H; }

  spawnPoint(side) {
    const f = this.arena.field;
    const x = f.x + f.w * (side ? 0.72 : 0.28);
    const y = f.y + f.h * 0.55;
    if (this.arena.platforms.length) {
      // On the water field, start on the barrel nearest the usual spot.
      const p = this.arena.platforms.filter((q) => q.rx < 40).reduce((a, b) => (U.dist(x, y, a.x, a.y) < U.dist(x, y, b.x, b.y) ? a : b));
      return [p.x, p.y];
    }
    return [x, y];
  }

  sendNext(side, specific) {
    const team = this.teams[side];
    const next = specific || team.find((f) => !f.fainted && f.state !== "fight" && f !== this.active[side]);
    if (!next) return false;
    const [x, y] = this.spawnPoint(side);
    const fx = side ? this.W + 20 : -20;
    next.sendOut(x, y, fx, y - 40);
    this.active[side] = next;
    if (this.controllers[side]) this.controllers[side].f = next;
    this.schedule(0.6, () => {
      FX.addFlash(0.15);
      FX.ring(x, y - 10, 6, 46, "#ffffff", 0.4, 3);
      FX.emit.sparkle(x, y - 14, 14, ["#ffffff", "#fff6b0", "#ffd0d0"]);
      FX.light(x, y - 20, 120, "#ffffff", 1);
    });
    if (next.species.shiny) {
      // The shiny sparkle: a second, golden burst that drifts up once the Pokémon has landed.
      this.schedule(0.95, () => {
        FX.ring(x, y - 16, 10, 90, "#ffe66a", 0.6, 3);
        for (let i = 0; i < 26; i++) {
          FX.particle({ x: x + U.rand(-26, 26), y: y + U.rand(-8, 8), z: U.rand(0, next.bodyH), vx: U.rand(-12, 12), vz: U.rand(30, 70),
            life: U.rand(0.7, 1.3), size: U.rand(2, 3.5), colors: ["#ffffff", "#fff6b0", "#ffd84a"], add: true, shape: "twinkle", drag: 0.96 });
        }
        FX.light(x, y - 20, 150, "#ffe66a", 1);
      });
    }
    this.say(`${side === 0 && this.mode === "play" ? "ゆけっ！ " : ""}${next.species.shiny ? "色違いの " : ""}${next.species.jp}が バトルフィールドに 登場！`);
    return true;
  }

  start() {
    this.sendNext(0);
    this.schedule(0.5, () => this.sendNext(1));
  }

  opponentOf(f) {
    const o = this.active[1 - f.side];
    return o && o.active ? o : null;
  }

  schedule(delay, fn) { this.timers.push({ t: delay, fn }); }

  danger(x, y, r, dur, owner) { this.dangers.push({ x, y, r, t: dur, owner }); }

  say(text, dur = 2.6) {
    this.captions.push({ text, t: 0, dur });
    if (this.captions.length > 2) this.captions.shift();
  }

  onMoveUsed(f, m) {
    this.callouts.push({ side: f.side, text: `${m.jp}！`, type: m.type, t: 0, dur: 1.5 });
    if (this.callouts.length > 4) this.callouts.shift();
    if (m.big && U.chance(0.6)) this.say(`${f.species.jp}の ${m.jp}！`, 1.8);
  }

  // K toggles the blue side's active Pokémon between normal and shiny; L the red side's (watch mode).
  toggleShiny(side) {
    const f = this.active[side];
    if (!f || f.state !== "fight") return;
    if (!f.setShiny(!f.species.shiny, this)) this.say(`${f.species.jp}の この姿には 色違いの絵が ない…`, 1.6);
  }

  onShiny(f) {
    const x = f.x, y = f.y - f.bodyH * 0.5;
    FX.ring(x, y, 8, 70, "#ffe66a", 0.5, 3);
    FX.emit.sparkle(x, y, 22, ["#ffffff", "#fff6b0", "#ffd84a"]);
    FX.light(x, y, 140, "#ffe66a", 1);
    this.say(f.species.shiny ? `${f.species.jp}は 色違いに なった！` : `${f.species.jp}は 元の色に 戻った！`, 1.8);
  }

  onTransform(f, kind) {
    const x = f.x, y = f.y - f.bodyH * 0.5;
    const cols = kind === "mega" ? ["#ffffff", "#ffb8f0", "#9ad8ff"] : ["#ffffff", "#ff5a7a", "#ff2a4e"];
    FX.addFlash(0.25);
    FX.addShake(kind === "gigantamax" ? 8 : 5);
    FX.ring(x, y, 8, 70, cols[1], 0.45, 4);
    FX.emit.sparkle(x, y, 22, cols);
    FX.light(x, y, 160, cols[1], 1.2);
    const root = f.species === f.forms.root;
    const verb = root ? "元の姿に 戻った！" : kind === "mega" ? `${f.species.jp}に メガシンカした！` : `${f.species.jp}に なった！`;
    this.say(root ? `${f.species.jp}は ${verb}` : verb, 2);
  }

  inBounds(x, y, pad = 0) {
    const f = this.arena.field;
    return x > f.x - pad && x < f.x + f.w + pad && y > f.y - pad && y < f.y + f.h + pad;
  }

  blocked(x, y, r) {
    return this.arena.props.some((p) => p.solid && U.dist(x, y, p.x, p.y - 2) < p.r + r);
  }

  resolveMove(f, nx, ny) {
    const fld = this.arena.field;
    const r = f.radius * 0.7;
    nx = U.clamp(nx, fld.x + r, fld.x + fld.w - r);
    ny = U.clamp(ny, fld.y + r * 0.6, fld.y + fld.h - 4);
    for (const p of this.arena.props) {
      if (!p.solid) continue;
      const dx = nx - p.x, dy = (ny - (p.y - 2)) / 0.7;
      const d = Math.hypot(dx, dy);
      const min = p.r + r;
      if (d < min && d > 0.001) {
        nx = p.x + (dx / d) * min;
        ny = p.y - 2 + (dy / d) * min * 0.7;
      }
    }
    return [nx, ny];
  }

  hit(attacker, target, move, opts = {}) {
    if (!target.canBeHit()) return;
    const res = Data.damage(attacker, target, move, opts.powerScale || 1);
    const dealt = target.takeDamage(res.amount, attacker);
    const hx = target.x, hy = target.y - target.bodyH * 0.6;
    if (!dealt) return;
    const ang = opts.angle ?? U.angle(attacker.x, attacker.y, target.x, target.y);
    const knock = (40 + move.power * 1.4) * (opts.knock ?? 1) * (res.eff > 1 ? 1.3 : 1) *
      attacker.might(move) * attacker.profile.push * target.profile.knockTaken;
    target.kx += Math.cos(ang) * knock;
    target.ky += Math.sin(ang) * knock;
    target.channelT = Math.min(target.channelT, 0.05);
    if (target.hp > 0) target.playAnim("Hurt");
    FX.burst(move.type, hx, hy, opts.quiet ? 4 : 10, 0.8);
    FX.addShake(opts.quiet ? 1 : Math.min(10, (1.5 + move.power / 25) * attacker.might(move)) * (res.eff > 1 ? 1.4 : 1));
    if (!opts.quiet && (move.big || res.eff > 1 || res.crit)) FX.addHitstop(0.07);
    const col = res.eff > 1 ? "#ffd84a" : res.eff < 1 ? "#c8d0e0" : "#ffffff";
    FX.text(hx + U.rand(-8, 8), hy - 8, String(dealt), { color: col, size: res.eff > 1 || res.crit ? 15 : 11 });
    if (!opts.quiet) {
      if (res.crit) FX.text(hx, hy - 26, "きゅうしょ！", { color: "#ff9a6a", size: 9, dur: 1 });
      if (res.eff > 1) { this.say("効果は ばつぐんだ！", 1.6); this.crowdHype = 1.5; }
      else if (res.eff === 0) this.say(`${target.species.jp}には 効果が ないようだ…`, 1.6);
      else if (res.eff < 1 && U.chance(0.5)) this.say("効果は いまひとつのようだ…", 1.4);
      this.applyStatus(move, target);
    }
    if (target.hp <= 0) this.onFaint(target);
  }

  applyStatus(move, target) {
    const s = target.status;
    const immune = (t) => target.species.types.includes(t);
    if (move.type === "fire" && !immune("fire") && U.chance(0.12)) { s.burn = 4; this.say(`${target.species.jp}は やけどを 負った！`, 1.6); }
    if (move.type === "electric" && !immune("electric") && U.chance(0.15)) { s.para = 3; this.say(`${target.species.jp}は まひして 動きが 鈍った！`, 1.6); }
    if (move.type === "ice" && !immune("ice") && U.chance(0.1)) { s.freeze = 1.2; this.say(`${target.species.jp}は こおりついた！`, 1.6); }
    if (move.type === "poison" && !immune("poison") && !immune("steel") && U.chance(0.2)) { s.poison = 5; this.say(`${target.species.jp}は 毒を あびた！`, 1.6); }
  }

  onFaint(f) {
    if (f.state === "faint" || f.state === "out") return;
    f.hp = 0;
    f.state = "faint";
    f.stateT = 0;
    f.channelT = 0;
    f.dashT = 0;
    f.playAnim("Faint");
    this.attacks = this.attacks.filter((a) => a.owner !== f);
    this.koBanner = 1.6;
    this.crowdHype = 2.5;
    FX.addShake(10);
    FX.addHitstop(0.18);
    FX.addFlash(0.35);
    this.say(`${f.species.jp}は たおれた！`, 2.2);
    this.schedule(1.6, () => {
      if (this.over) return;
      const side = f.side;
      if (!this.sendNext(side)) this.finish(1 - side);
    });
  }

  finish(winner) {
    this.over = true;
    this.winner = winner;
    this.endT = 0;
    const names = this.teams[winner].filter((f) => !f.fainted).map((f) => f.species.jp).join("・");
    if (this.mode === "play") this.say(winner === 0 ? "勝負に 勝った！" : "目の前が 真っ暗に なった…", 4);
    else this.say(`${winner === 0 ? "青" : "赤"}チームの 勝利！ ${names}`, 4);
  }

  trySwitch(side) {
    const cur = this.active[side];
    if (!cur || cur.state !== "fight" || this.switchCd[side] > 0) return;
    const team = this.teams[side];
    const idx = team.indexOf(cur);
    for (let k = 1; k < team.length; k++) {
      const nxt = team[(idx + k) % team.length];
      if (!nxt.fainted) {
        this.switchCd[side] = 6;
        cur.state = "bench";
        cur.active = false;
        this.attacks = this.attacks.filter((a) => a.owner !== cur);
        FX.ring(cur.x, cur.y - 10, 40, 4, "#ff5a4e", 0.35, 3);
        this.say(`もどれ、${cur.species.jp}！`, 1.4);
        this.sendNext(side, nxt);
        return;
      }
    }
  }

  playerIntent() {
    const L = Input.isDown("a", "arrowleft"), R = Input.isDown("d", "arrowright");
    const Up = Input.isDown("w", "arrowup"), Dn = Input.isDown("s", "arrowdown");
    const keys = [["z", "1"], ["x", "2"], ["c", "3"], ["v", "4"]];
    let move = null;
    keys.forEach((ks, i) => { if (Input.isDown(...ks) && move === null) move = i; });
    return {
      mx: (R ? 1 : 0) - (L ? 1 : 0),
      my: (Dn ? 1 : 0) - (Up ? 1 : 0),
      move,
      dodge: Input.wasPressed(" "),
      form: Input.wasPressed("m") ? "mega" : Input.wasPressed("g") ? "gigantamax" : null,
    };
  }

  update(dt) {
    if (FX.hitstop > 0) {
      FX.hitstop = Math.max(0, FX.hitstop - dt);
      FX.update(dt * 0.15);
      return;
    }
    this.time += dt;
    this.intro = Math.max(0, this.intro - dt);
    this.koBanner = Math.max(0, this.koBanner - dt);
    this.crowdHype = Math.max(0, this.crowdHype - dt);
    this.switchCd = this.switchCd.map((v) => Math.max(0, v - dt));
    if (this.over) this.endT += dt;

    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    due.forEach((tm) => tm.fn());

    for (const d of this.dangers) d.t -= dt;
    this.dangers = this.dangers.filter((d) => d.t > 0);

    if ((this.mode === "play" || this.mode === "watch") && Input.wasPressed("q")) this.trySwitch(0);
    if (!this.over && Input.wasPressed("k")) this.toggleShiny(0);
    if (!this.over && this.mode === "watch" && Input.wasPressed("l")) this.toggleShiny(1);
    if (this.mode === "play" && Input.wasPressed("t")) {
      this.cpuAttack = !this.cpuAttack;
      this.say(this.cpuAttack ? "CPUが 攻撃してくるように なった！" : "練習モード： CPUは 攻撃してこない", 1.8);
    }

    for (let side = 0; side < 2; side++) {
      const f = this.active[side];
      if (!f) continue;
      let intent = { mx: 0, my: 0, move: null, dodge: false };
      if (!this.over && f.state === "fight") {
        intent = this.controllers[side] ? this.controllers[side].intent(dt, this) : this.playerIntent();
        if (this.mode === "play" && side === 1 && !this.cpuAttack) intent.move = null;
        // Watch mode keeps movement on the CPU. The blue side still takes the player's
        // moves, dodge, switch, mega evolution and Gigantamax.
        if (this.mode === "watch" && side === 0) {
          const hand = this.playerIntent();
          if (hand.move !== null) {
            intent.move = hand.move;
            if (!hand.dodge) intent.dodge = false;
          }
          if (hand.dodge) {
            intent.dodge = true;
            intent.move = null;
            // The CPU may be winding up a move. A commanded dodge cancels that windup.
            f.channelT = 0;
          }
          if (hand.form) intent.form = hand.form;
        }
      }
      f.update(dt, this, intent);
    }
    // Bench fighters that are fading out still need their timers.
    for (const team of this.teams) for (const f of team) if (f.state === "faint" && !this.active.includes(f)) f.update(dt, this, {});

    this.attacks = this.attacks.filter((a) => {
      const fn = Moves.UPDATE[a.kind];
      return fn ? fn(this, a, dt) : false;
    });

    // Fighters bump each other apart.
    const [a, b] = this.active;
    if (a && b && a.state === "fight" && b.state === "fight") {
      const d = U.dist(a.x, a.y, b.x, b.y), min = (a.radius + b.radius) * 0.8;
      if (d < min && d > 0.01) {
        // The heavier fighter gives way less.
        const overlap = min - d, share = b.weight / (a.weight + b.weight);
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        [a.x, a.y] = this.resolveMove(a, a.x - nx * overlap * share, a.y - ny * overlap * share);
        [b.x, b.y] = this.resolveMove(b, b.x + nx * overlap * (1 - share), b.y + ny * overlap * (1 - share));
      }
    }

    for (const c of this.captions) c.t += dt;
    this.captions = this.captions.filter((c) => c.t < c.dur);
    for (const c of this.callouts) c.t += dt;
    this.callouts = this.callouts.filter((c) => c.t < c.dur);

    FX.update(dt);
  }
}
