// CPU control: keeps a good range for its next move, strafes, sidesteps telegraphed attacks
// and dodges incoming projectiles. `skill` (0..1) scales reactions and decision quality.
"use strict";

class AIController {
  constructor(fighter, skill) {
    this.f = fighter;
    this.skill = skill;
    this.plan = 0;
    this.think = 0;
    this.strafe = U.chance(0.5) ? 1 : -1;
    this.strafeT = U.rand(1, 2.5);
    this.react = 0;
    this.wantFire = false;
    this.formT = 0;
    this.formAt = 0;
    this.formPick = null;
    this.lastF = null;
  }

  // Mega Evolution / Gigantamax on the CPU's own initiative: once per fighter, a few seconds after
  // it enters (sooner when it is losing), only from the ordinary form. Returns the kind or null.
  formIntent(dt, battle) {
    const f = this.f;
    if (f !== this.lastF) { this.lastF = f; this.formT = 0; this.formAt = U.rand(2, 5) / (0.6 + this.skill * 0.6); this.formPick = null; }
    if (f.species !== f.forms.root || this.formAt < 0) return null;
    this.formT += dt;
    const kinds = ["mega", "gigantamax"].filter((k) => f.forms[k].length);
    if (!kinds.length) return null;
    if (!this.formPick) this.formPick = U.pick(kinds);
    const losing = f.hp / f.maxHp < 0.5;
    if (this.formT < (losing ? Math.min(this.formAt, 1) : this.formAt)) return null;
    if (!f.canTransform(this.formPick)) return null;
    this.formAt = -1; // one transformation per fighter
    return this.formPick;
  }

  scoreMove(i, foe, dist) {
    const f = this.f;
    const m = f.moves[i];
    if (f.cooldowns[i] > 0) return -1;
    if (m.shape === "buff") {
      const bf = m.buff || {};
      if (bf.splash) return 1;
      if (bf.heal) return f.hp / f.maxHp < 0.45 ? 140 : -1;
      if (bf.shield) return 0;
      return f.buffs.length || f.hp / f.maxHp < 0.4 || dist < 120 ? -1 : 90;
    }
    const eff = foe.species.defense[m.type] ?? 1;
    const stab = f.species.types.includes(m.type) ? 1.5 : 1;
    const special = m.category === "special";
    const ratio = (special ? f.stats.spa : f.stats.atk) / 100;
    const inRange = dist <= Moves.maxRange(m, f) ? 1 : 0.45;
    return m.power * eff * stab * ratio * inRange + U.rand(0, 25 * (1.2 - this.skill));
  }

  intent(dt, battle) {
    const f = this.f;
    const foe = battle.opponentOf(f);
    const out = { mx: 0, my: 0, move: null, dodge: false, form: null };
    if (!foe || foe.state !== "fight" || f.state !== "fight") return out;
    const dist = U.dist(f.x, f.y, foe.x, foe.y);
    if (battle.cpuAttack) out.form = this.formIntent(dt, battle);

    this.think -= dt;
    if (this.think <= 0) {
      this.think = U.rand(0.25, 0.5) / (0.6 + this.skill * 0.5);
      let best = -1, bestScore = -1;
      f.moves.forEach((_, i) => {
        const s = this.scoreMove(i, foe, dist);
        if (s > bestScore) { bestScore = s; best = i; }
      });
      this.plan = best;
    }

    const plan = this.plan >= 0 ? f.moves[this.plan] : null;
    const desired = plan ? Moves.preferredRange(plan, f) : 190;
    const toFoe = U.angle(f.x, f.y, foe.x, foe.y);
    const radial = U.clamp((dist - desired) / 60, -1, 1);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = U.rand(0.8, 2.6); }
    let mx = Math.cos(toFoe) * radial + Math.cos(toFoe + Math.PI / 2) * this.strafe * 0.7;
    let my = Math.sin(toFoe) * radial + Math.sin(toFoe + Math.PI / 2) * this.strafe * 0.7;

    // Stay away from walls, lava and telegraphed impact zones.
    const fld = battle.arena.field;
    const margin = 60;
    if (f.x < fld.x + margin) mx += 1.2;
    if (f.x > fld.x + fld.w - margin) mx -= 1.2;
    if (f.y < fld.y + margin) my += 1.2;
    if (f.y > fld.y + fld.h - margin) my -= 1.2;
    for (const l of battle.arena.lava) {
      const d = U.dist(f.x, f.y, l.x, l.y);
      if (d < l.r + 40) { mx += (f.x - l.x) / d * 1.5; my += (f.y - l.y) / d * 1.5; }
    }
    if (!f.swimmer && !f.flying && battle.arena.platforms.length && U.chance(0.02)) {
      // Drift toward a dry platform now and then.
      const p = battle.arena.platforms.reduce((a, b) => (U.dist(f.x, f.y, a.x, a.y) < U.dist(f.x, f.y, b.x, b.y) ? a : b));
      this.platformPull = { x: p.x, y: p.y, t: 1 };
    }
    if (this.platformPull && this.platformPull.t > 0) {
      this.platformPull.t -= dt;
      const a = U.angle(f.x, f.y, this.platformPull.x, this.platformPull.y);
      mx += Math.cos(a) * 0.6; my += Math.sin(a) * 0.6;
    }

    let threatened = false;
    for (const d of battle.dangers) {
      if (d.owner === f) continue;
      const dd = U.dist(f.x, f.y, d.x, d.y);
      if (dd < d.r + f.radius + 10) {
        threatened = true;
        const a = U.angle(d.x, d.y, f.x, f.y);
        mx += Math.cos(a) * 2.5 * this.skill; my += Math.sin(a) * 2.5 * this.skill;
      }
    }
    for (const a of battle.attacks) {
      if (a.owner === f) continue;
      if (a.kind === "proj") {
        const rx = f.x - a.x, ry = f.y - f.bodyH * 0.35 - a.y;
        const sp = Math.hypot(a.vx, a.vy) || 1;
        const t = (rx * a.vx + ry * a.vy) / (sp * sp);
        if (t > 0 && t < 0.45) {
          const px = a.x + a.vx * t, py = a.y + a.vy * t;
          if (U.dist(px, py, f.x, f.y - f.bodyH * 0.35) < f.radius + a.r + 8) threatened = true;
        }
      } else if (a.kind === "beam" || a.kind === "stream") {
        threatened = true;
        const side = U.angle(a.owner.x, a.owner.y, f.x, f.y) + Math.PI / 2 * this.strafe;
        mx += Math.cos(side) * 1.5; my += Math.sin(side) * 1.5;
      }
    }

    this.react -= dt;
    if (threatened && this.react <= 0) {
      this.react = 0.5;
      if (U.chance(0.25 + this.skill * 0.5) && f.dodgeCd <= 0) {
        out.dodge = true;
        mx = Math.cos(toFoe + Math.PI / 2 * this.strafe);
        my = Math.sin(toFoe + Math.PI / 2 * this.strafe);
      }
    }

    out.mx = mx; out.my = my;
    if (plan && this.plan >= 0 && f.cooldowns[this.plan] <= 0 && (dist <= Moves.maxRange(plan, f) || plan.shape === "buff") && U.chance(0.35 + this.skill * 0.5)) {
      out.move = this.plan;
      this.think = 0;
    }
    return out;
  }
}
