// Team selection screen backed by the full roster from ../pokeData.
"use strict";

const Menu = (() => {
  const TEAM_SIZE = 3;
  const teams = [[], []];
  let activeSide = 0;
  let onStart = null;
  const $ = (s) => document.querySelector(s);

  function typeChips(types) {
    return types.map((t) => `<span class="type-chip" style="background:${TYPES[t].color}">${TYPES[t].jp}</span>`).join("");
  }

  function renderGrid() {
    const list = Data.search($("#search").value, $("#filter-kind").value);
    const grid = $("#grid");
    const frag = document.createDocumentFragment();
    for (const p of list) {
      const card = document.createElement("button");
      card.className = "card";
      const s = p.stats;
      card.title = `${p.jp} (${p.name})\nHP ${s.hp} / こうげき ${s.attack} / ぼうぎょ ${s.defense} / とくこう ${s.specialAttack} / とくぼう ${s.specialDefense} / すばやさ ${s.speed}\n高さ ${p.heightM}m ・ 重さ ${p.weightKg}kg`;
      card.innerHTML = `<img loading="lazy" src="${p.sprites.icon}" alt=""><div class="no">No.${String(p.dex).padStart(4, "0")}</div><div class="nm">${p.jp}</div><div class="types">${typeChips(p.types)}</div>`;
      card.addEventListener("click", () => add(p));
      frag.appendChild(card);
    }
    grid.replaceChildren(frag);
  }

  function renderTeams() {
    document.querySelectorAll(".team").forEach((el) => {
      const side = +el.dataset.side;
      el.classList.toggle("active", side === activeSide);
      const slots = el.querySelector(".slots");
      slots.replaceChildren();
      for (let i = 0; i < TEAM_SIZE; i++) {
        const p = teams[side][i];
        const s = document.createElement("div");
        s.className = "slot";
        if (p) {
          s.classList.toggle("shiny", !!p.shiny);
          s.innerHTML = `<img src="${p.sprites.icon}" alt=""><span class="nm">${Data.plainOf(p).jp}</span>`;
          s.title = "クリックで外す";
          s.addEventListener("click", (e) => {
            e.stopPropagation();
            teams[side].splice(i, 1);
            renderTeams();
          });
          // Per-slot shiny toggle; forms without shiny art show it disabled.
          const star = document.createElement("button");
          star.type = "button";
          star.className = "shiny-btn";
          star.textContent = "✨";
          if (Data.hasShiny(p)) {
            star.title = p.shiny ? "通常の色に戻す" : "色違いにする";
            star.addEventListener("click", (e) => {
              e.stopPropagation();
              teams[side][i] = p.shiny ? Data.plainOf(p) : Data.shinyOf(p);
              renderTeams();
            });
          } else {
            star.disabled = true;
            star.title = "この姿の色違い画像はありません";
          }
          s.appendChild(star);
        }
        slots.appendChild(s);
      }
    });
    $("#start").disabled = !teams[0].length || !teams[1].length;
  }

  function add(p) {
    const t = teams[activeSide];
    if (t.length >= TEAM_SIZE) t.pop();
    t.push(p);
    if (t.length >= TEAM_SIZE && teams[1 - activeSide].length < TEAM_SIZE) activeSide = 1 - activeSide;
    renderTeams();
  }

  function init(startCb) {
    onStart = startCb;
    const arenaSel = $("#opt-arena");
    arenaSel.innerHTML = `<option value="random">ランダム</option>` + Arenas.DEFS.map((d) => `<option value="${d.id}">${d.jp}</option>`).join("");
    arenaSel.value = "crystal";
    document.querySelectorAll(".team").forEach((el) => el.addEventListener("click", () => { activeSide = +el.dataset.side; renderTeams(); }));
    document.querySelectorAll("[data-random]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const side = +btn.dataset.random;
      teams[side] = Data.randomTeam(TEAM_SIZE, $("#filter-kind").value);
      renderTeams();
    }));
    let timer;
    $("#search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(renderGrid, 120); });
    $("#filter-kind").addEventListener("change", renderGrid);
    $("#start").addEventListener("click", () => {
      let arena = arenaSel.value;
      if (arena === "random") arena = U.pick(Arenas.DEFS).id;
      // Slots left in their normal colour roll for a shiny at the chosen odds (per Pokémon, both teams).
      const odds = +$("#opt-shiny").value;
      const roll = (p) => (!p.shiny && odds > 0 && Math.random() < odds ? Data.shinyOf(p) : p);
      onStart({
        teams: [teams[0].map(roll), teams[1].map(roll)],
        arenaId: arena,
        mode: $("#opt-mode").value,
        skill: +$("#opt-level").value,
        cpuAttack: $("#opt-cpu-attack").value === "1",
      });
    });

    // A ready-to-go default matchup like the reference footage.
    teams[0] = ["charizard", "pikachu", "lucario-mega"].map(Data.bySlug).filter(Boolean);
    teams[1] = ["blastoise", "gyarados", "venusaur"].map(Data.bySlug).filter(Boolean);
    renderGrid();
    renderTeams();
  }

  function show() { $("#menu").classList.remove("hidden"); }
  function hide() { $("#menu").classList.add("hidden"); }

  return { init, show, hide };
})();
