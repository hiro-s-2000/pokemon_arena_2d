// Boot, game loop and screen flow (menu → battle → result).
"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  let battle = null;
  let backdrop = null;
  let lastConfig = null;
  let state = "loading";
  let last = performance.now();
  let time = 0;

  function boot() {
    if (!window.POKE_DATA_BY_STEM || !window.POKE_SPRITE_MANIFEST) {
      $("#loading-text").textContent = "pokeData / pokeSprite が見つかりません。game フォルダを pokemon_arena_sample の中に置いてください。";
      return;
    }
    Input.init();
    Touch.init();
    Renderer.init($("#screen"));
    HUD.init();
    const roster = Data.build();
    $("#loading-text").textContent = `${roster.length} 体のポケモンを読み込みました`;
    // An empty "battle" so the menu can reuse the battle renderer as its backdrop.
    const arena = Arenas.create("crystal");
    backdrop = { arena, W: arena.W, H: arena.H, active: [], teams: [], attacks: [], crowdHype: 0 };
    Menu.init(startBattle);
    setTimeout(() => {
      $("#loading").classList.add("hidden");
      if (autostart()) return;
      Menu.show();
      state = "menu";
    }, 300);
    requestAnimationFrame(loop);

    document.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      if (act === "resume") setPaused(false);
      if (act === "menu") toMenu();
      // Keep a practice toggle made with T during the last battle.
      if (act === "again" && lastConfig) startBattle({ ...lastConfig, cpuAttack: battle ? battle.cpuAttack : lastConfig.cpuAttack });
    }));
  }

  // Testing shortcut that skips the menu: index.html?autostart=charizard*+venusaur,pikachu
  // (slugs, "*" after a slug makes it shiny; "+" joins a team (URLSearchParams reads it as a space), "," splits the two sides)
  // with optional &arena=<id>, &mode=play|watch, &shiny=<odds 0..1 for the others>. Defaults match the menu: watch, crystal cave, CPU skill 1, no random shinies.
  function autostart() {
    const q = new URLSearchParams(location.search);
    if (!q.get("autostart")) return false;
    const odds = +(q.get("shiny") || 0);
    const roll = (p) => (p && !p.shiny && Math.random() < odds ? Data.shinyOf(p) : p);
    const teams = q.get("autostart").split(",").map((side) => side.split(/[+ ]/).map(Data.bySlug).map(roll).filter(Boolean));
    if (teams.length < 2 || !teams[0].length || !teams[1].length) return false;
    startBattle({ teams, arenaId: q.get("arena") || "crystal", mode: q.get("mode") || "watch", skill: +(q.get("level") || 1), cpuAttack: true });
    return true;
  }

  async function startBattle(cfg) {
    lastConfig = cfg;
    Menu.hide();
    $("#result").classList.add("hidden");
    $("#pause").classList.add("hidden");
    $("#loading").classList.remove("hidden");
    $("#loading-text").textContent = "フィールドを準備中…";
    await new Promise((r) => setTimeout(r, 30));
    battle = new Battle(cfg);
    const recs = battle.teams.flat().flatMap((f) => f.loadRecs);
    recs.push(Sprites.get("../pokeSprite/items/poke-ball.png"));
    await Sprites.whenReady(recs);
    $("#loading").classList.add("hidden");
    Renderer.updateCamera(battle, 0, true);
    battle.start();
    state = "battle";
  }

  function toMenu() {
    battle = null;
    state = "menu";
    $("#pause").classList.add("hidden");
    $("#result").classList.add("hidden");
    FX.reset();
    Menu.show();
  }

  function setPaused(p) {
    if (!battle) return;
    state = p ? "paused" : "battle";
    $("#pause").classList.toggle("hidden", !p);
  }

  function showResult() {
    state = "result";
    const win = battle.winner;
    const play = battle.mode === "play";
    $("#result-title").textContent = play ? (win === 0 ? "勝利！" : "敗北…") : `${win === 0 ? "青" : "赤"}チームの勝利！`;
    $("#result-sub").textContent = battle.teams[win].filter((f) => !f.fainted).map((f) => `${f.species.jp} 残りHP ${f.hp}/${f.maxHp}`).join(" ・ ");
    $("#result").classList.remove("hidden");
  }

  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;

    Touch.sync(battle, state === "battle");

    if (state === "battle" || state === "result") {
      if (Input.wasPressed("escape") && state === "battle") setPaused(true);
      battle.update(dt);
      Renderer.frame(battle, dt, time);
      HUD.draw(battle, dt);
      if (battle.over && battle.endT > 3 && state === "battle") showResult();
    } else if (state === "paused") {
      if (Input.wasPressed("escape")) setPaused(false);
      Renderer.frame(battle, 0, time);
      HUD.draw(battle, 0);
    } else if (backdrop) {
      FX.update(dt);
      Renderer.idle(backdrop, dt, time);
    }
    Input.endFrame();
    requestAnimationFrame(loop);
  }

  // Handy for inspecting a match from the browser console.
  window.ArenaDebug = { get battle() { return battle; } };

  boot();
})();
