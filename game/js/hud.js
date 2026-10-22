// Screen-space HUD: team bars, move callouts, the move bar, captions and the K.O.! banner.
"use strict";

const HUD = (() => {
  const shownHp = new Map();
  let font = "sans-serif";

  function init() { font = getComputedStyle(document.body).fontFamily; }

  function outlined(ctx, text, x, y, size, fill, stroke = "#141826", weight = 900, align = "left") {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size * 0.24);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  function hpColor(k) { return k > 0.5 ? "#4ee06a" : k > 0.2 ? "#ffd23a" : "#ff4e3e"; }

  function teamBar(ctx, b, side, u, dt) {
    const sw = Renderer.sw;
    const f = b.active[side];
    const team = b.teams[side];
    const W = Math.min(520 * u, sw * 0.42), H = 64 * u;
    const pad = 14 * u;
    const x = side ? sw - W - pad : pad, y = pad;
    const dir = side ? -1 : 1;
    ctx.save();
    // Panel
    const g = ctx.createLinearGradient(x, y, x, y + H);
    g.addColorStop(0, "rgba(20,26,48,0.88)");
    g.addColorStop(1, "rgba(10,14,28,0.88)");
    ctx.fillStyle = g;
    roundRect(ctx, x, y, W, H, 12 * u);
    ctx.fill();
    ctx.strokeStyle = side ? "rgba(255,110,100,0.7)" : "rgba(110,170,255,0.7)";
    ctx.lineWidth = 2 * u;
    ctx.stroke();

    if (f) {
      // Portrait
      const pr = 26 * u;
      const px = side ? x + W - pr - 8 * u : x + pr + 8 * u, py = y + H / 2;
      ctx.fillStyle = TYPES[f.species.types[0]].color;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(px, py, pr - 3 * u, 0, TAU); ctx.fill();
      const icon = f.sprites[4];
      if (icon.ready) {
        ctx.save();
        ctx.beginPath(); ctx.arc(px, py, pr - 3 * u, 0, TAU); ctx.clip();
        ctx.imageSmoothingEnabled = false;
        const s = (pr * 2.3) / Math.max(icon.w, icon.h);
        if (side === 0) { ctx.translate(px, py); ctx.scale(-1, 1); ctx.translate(-px, -py); }
        ctx.drawImage(icon.img, px - (icon.w * s) / 2, py - (icon.h * s) / 2 + 4 * u, icon.w * s, icon.h * s);
        ctx.restore();
      }
      if (f.fainted) outlined(ctx, "K.O.", px, py, 14 * u, "#ff4e3e", "#fff", 900, "center");

      // Name, types, HP
      const tx = side ? px - pr - 12 * u : px + pr + 12 * u;
      const align = side ? "right" : "left";
      outlined(ctx, f.species.jp, tx, y + 17 * u, 17 * u, "#ffffff", "#0b0f1d", 900, align);
      ctx.font = `900 ${17 * u}px ${font}`;
      let cx = side ? tx - ctx.measureText(f.species.jp).width - 8 * u : tx + ctx.measureText(f.species.jp).width + 8 * u;
      for (const t of f.species.types) {
        ctx.font = `800 ${9 * u}px ${font}`;
        const label = TYPES[t].jp;
        const tw = ctx.measureText(label).width + 10 * u;
        const bx = side ? cx - tw : cx;
        ctx.fillStyle = TYPES[t].color;
        roundRect(ctx, bx, y + 10 * u, tw, 14 * u, 4 * u);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(label, bx + tw / 2, y + 17.5 * u);
        cx += dir * (tw + 4 * u);
      }

      const k = f.hp / f.maxHp;
      const prev = shownHp.get(f) ?? k;
      const lag = prev > k ? Math.max(k, prev - dt * 0.35) : k;
      shownHp.set(f, lag);
      const bw = W - pr * 2 - 40 * u, bh = 12 * u;
      const bx = side ? tx - bw : tx, by = y + 34 * u;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, bx - 2 * u, by - 2 * u, bw + 4 * u, bh + 4 * u, 5 * u);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      const lw = bw * lag;
      ctx.fillRect(side ? bx + bw - lw : bx, by, lw, bh);
      const hg = ctx.createLinearGradient(0, by, 0, by + bh);
      hg.addColorStop(0, U.mix(hpColor(k), "#ffffff", 0.35));
      hg.addColorStop(1, hpColor(k));
      ctx.fillStyle = hg;
      const kw = bw * k;
      ctx.fillRect(side ? bx + bw - kw : bx, by, kw, bh);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(side ? bx + bw - kw : bx, by, kw, bh * 0.35);
      outlined(ctx, `${Math.ceil(f.hp)} / ${f.maxHp}`, side ? bx : bx + bw, by + bh + 9 * u, 10 * u, "#e8ecff", "#0b0f1d", 800, side ? "left" : "right");

      // Status chips
      const st = Object.keys(f.status).map((s) => ({ burn: "やけど", para: "まひ", freeze: "こおり", poison: "どく" }[s]));
      if (f.buffs.length) st.push("↑");
      if (st.length) outlined(ctx, st.join(" "), side ? bx + bw : bx, by + bh + 9 * u, 9 * u, "#ffd84a", "#0b0f1d", 800, side ? "right" : "left");
    }

    // Remaining team as Poké Balls under the panel
    const ball = Sprites.get("../pokeSprite/items/poke-ball.png");
    team.forEach((m, i) => {
      const bx = side ? x + W - 20 * u - i * 20 * u : x + 6 * u + i * 20 * u;
      const by = y + H + 4 * u;
      ctx.globalAlpha = m.fainted ? 0.3 : 1;
      if (ball.ready) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ball.img, bx, by, 16 * u, 16 * u);
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  function callouts(ctx, b, u) {
    const sw = Renderer.sw;
    const perSide = [0, 0];
    for (const c of b.callouts.slice().reverse()) {
      const i = perSide[c.side]++;
      if (i > 1) continue;
      const k = c.t / c.dur;
      const pop = c.t < 0.15 ? U.easeOutBack(c.t / 0.15) : 1;
      const alpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      const size = 15 * u * pop;
      ctx.font = `900 ${size}px ${font}`;
      const tw = ctx.measureText(c.text).width + 22 * u;
      const h = 28 * u;
      const pad = 14 * u;
      const x = c.side ? sw - pad - tw - 10 * u : pad + 10 * u;
      const y = 104 * u + i * (h + 6 * u);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = U.mix(TYPES[c.type].color, "#000000", 0.25);
      roundRect(ctx, x, y, tw, h, h / 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      outlined(ctx, c.text, x + tw / 2, y + h / 2 + 1, size, "#ffffff", "#141826", 900, "center");
      ctx.restore();
    }
  }

  function touchReserve() {
    if (!document.body.classList.contains("touch-play")) return 0;
    const css = parseFloat(getComputedStyle(document.body).getPropertyValue("--touch-reserve")) || 0;
    return css * Math.min(devicePixelRatio || 1, 2);
  }

  function moveBar(ctx, b, u) {
    if (document.body.classList.contains("touch-play")) return;
    const f = b.active[0];
    if (!f || (b.mode !== "play" && b.mode !== "watch")) return;
    const sw = Renderer.sw, sh = Renderer.sh;
    const keys = ["Z", "X", "C", "V"];
    const slotW = 150 * u, slotH = 46 * u, gap = 8 * u;
    const play = b.mode === "play";
    const forms = [["mega", "M", "メガシンカ", "#ff8ad8"], ["gigantamax", "G", "キョダイマックス", "#ff3b5c"]].filter(([k]) => f.forms[k].length);
    const slots = f.moves.length + 2 + forms.length;
    const total = slots * (slotW * 0.86) + (slots - 1) * gap;
    let x = (sw - total) / 2;
    const y = sh - slotH - 14 * u;
    const draw = (label, key, color, cd, max, sub) => {
      const w = slotW * 0.86;
      ctx.save();
      ctx.fillStyle = "rgba(12,16,30,0.86)";
      roundRect(ctx, x, y, w, slotH, 10 * u);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x, y + slotH - 5 * u, w, 5 * u);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1.5 * u;
      roundRect(ctx, x, y, w, slotH, 10 * u);
      ctx.stroke();
      // Key cap
      ctx.fillStyle = "#e8ecff";
      roundRect(ctx, x + 6 * u, y + 6 * u, 26 * u, 18 * u, 4 * u);
      ctx.fill();
      ctx.fillStyle = "#141826";
      ctx.font = `900 ${10 * u}px ${font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(key, x + 19 * u, y + 15.5 * u);
      ctx.font = `900 ${12 * u}px ${font}`;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      let name = label;
      while (ctx.measureText(name).width > w - 44 * u && name.length > 2) name = name.slice(0, -1);
      ctx.fillText(name, x + 38 * u, y + 15.5 * u);
      ctx.font = `700 ${9 * u}px ${font}`;
      ctx.fillStyle = "#9aa3c4";
      ctx.fillText(sub, x + 8 * u, y + 33 * u);
      if (cd > 0.05) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        roundRect(ctx, x, y, w * (cd / max), slotH, 10 * u);
        ctx.fill();
        outlined(ctx, cd.toFixed(1), x + w - 18 * u, y + slotH / 2 + 6 * u, 12 * u, "#ffffff", "#000", 900, "center");
      }
      ctx.restore();
      x += w + gap;
    };
    f.moves.forEach((m, i) => {
      const sub = m.shape === "buff" ? "補助" : `${TYPES[m.type].jp} 威力${m.power}`;
      draw(m.jp, keys[i], TYPES[m.type].color, f.cooldowns[i], f.cooldownOf(m), sub);
    });
    draw("回避", "SPC", "#9aa3c4", f.dodgeCd, f.dodgeMax, "無敵ダッシュ");
    for (const [kind, key, label, color] of forms) {
      const back = f.nextForm(kind) === f.forms.root;
      draw(back ? "元に戻る" : label, key, color, f.formCd, 1.5, back ? "通常の姿へ" : f.nextForm(kind).jp);
    }
    draw("交代", "Q", "#ffcb05", b.switchCd[0], 6, "次のポケモン");
    if (play) {
      outlined(ctx, b.cpuAttack ? "CPUの攻撃：あり（T で切替）" : "練習モード：CPUは攻撃しない（T で切替）",
        14 * u, y - 12 * u, 11 * u, b.cpuAttack ? "#c8d0e0" : "#7dffb0", "#141826", 900, "left");
    }
  }

  function overheadBars(ctx, b, u) {
    for (const f of b.active) {
      if (!f || !f.active || f.state !== "fight") continue;
      const [x, y] = Renderer.toScreen(f.x, f.y - f.bodyH - f.hover() - 8);
      const w = 44 * u, h = 5 * u;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - w / 2 - u, y - u, w + 2 * u, h + 2 * u);
      ctx.fillStyle = hpColor(f.hp / f.maxHp);
      ctx.fillRect(x - w / 2, y, w * (f.hp / f.maxHp), h);
      ctx.fillStyle = f.side ? "#ff6e64" : "#6eaaff";
      ctx.fillRect(x - w / 2, y + h + u, w, 1.5 * u);
    }
  }

  function captions(ctx, b, u) {
    const sw = Renderer.sw, sh = Renderer.sh;
    const c = b.captions[b.captions.length - 1];
    if (!c) return;
    const k = c.t / c.dur;
    const alpha = c.t < 0.15 ? c.t / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    const reserve = touchReserve();
    const bar = !reserve && b.active[0] && (b.mode === "play" || b.mode === "watch");
    const y = sh - (bar ? 86 * u : 40 * u) - reserve;
    outlined(ctx, c.text, sw / 2, y, 22 * u, "#ffffff", "#141826", 900, "center");
    ctx.restore();
  }

  function koBanner(ctx, b, u) {
    if (b.koBanner <= 0) return;
    const t = 1.6 - b.koBanner;
    const sw = Renderer.sw, sh = Renderer.sh;
    const pop = t < 0.2 ? U.easeOutBack(t / 0.2) : 1;
    const alpha = b.koBanner < 0.3 ? b.koBanner / 0.3 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sw / 2, sh * 0.32);
    ctx.scale(pop, pop);
    ctx.rotate(-0.04);
    const size = 110 * u;
    ctx.font = `900 ${size}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = "#2a0d0d";
    ctx.strokeText("K.O.!", 0, 6 * u);
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = "#fff3c4";
    ctx.strokeText("K.O.!", 0, 0);
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, "#ff8a6a");
    g.addColorStop(0.5, "#ff3b2e");
    g.addColorStop(1, "#b5170f");
    ctx.fillStyle = g;
    ctx.fillText("K.O.!", 0, 0);
    ctx.restore();
  }

  function intro(ctx, b, u) {
    if (b.intro <= 0) return;
    const sw = Renderer.sw, sh = Renderer.sh;
    const t = 1.6 - b.intro;
    const alpha = b.intro < 0.4 ? b.intro / 0.4 : Math.min(1, t / 0.2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(8,10,20,0.55)";
    ctx.fillRect(0, sh * 0.4, sw, sh * 0.2);
    outlined(ctx, b.arena.jp, sw / 2, sh * 0.46, 18 * u, "#ffe46b", "#141826", 900, "center");
    outlined(ctx, "バトル開始！", sw / 2, sh * 0.53, 44 * u, "#ffffff", "#141826", 900, "center");
    ctx.restore();
  }

  function draw(b, dt) {
    const ctx = Renderer.ctx;
    const u = Math.min(Renderer.sw / 1280, Renderer.sh / 720);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    overheadBars(ctx, b, u);
    FX.drawTexts(ctx, Renderer.toScreen, Renderer.cam.z / 2.4);
    teamBar(ctx, b, 0, u, dt);
    teamBar(ctx, b, 1, u, dt);
    callouts(ctx, b, u);
    moveBar(ctx, b, u);
    captions(ctx, b, u);
    koBanner(ctx, b, u);
    intro(ctx, b, u);
    ctx.restore();
  }

  return { init, draw };
})();
