// Builds the playable roster from ../pokeData and turns learnsets into real-time moves.
"use strict";

const Data = (() => {
  const LEVEL = 50;
  const DAMAGE_SCALE = 0.34;

  // Physical moves that are thrown or shot rather than delivered by contact.
  const RANGED_PHYSICAL = /shot|bomb|throw|blast|missile|spear|seed|bone|sting|needle|razor-leaf|rock-tomb|icicle|leaf-blade-x|arrow|dart|scale-shot|spike|egg|barrage|smack-down|gunk|grav-apple|apple-acid|dragon-darts|pyro-ball|bullet-seed|magnet-bomb|beat-up|thousand/;
  const STRIKE = /^(thunder|hurricane|stone-edge|rock-slide|draco-meteor|earth-power|fissure|meteor-beam|fire-spin|whirlpool|sand-tomb|twister|leaf-tornado|bleakwind-storm|wildbolt-storm|sandsear-storm|springtide-storm|blizzard|magma-storm|sky-attack|future-sight|doom-desire|precipice-blades|thousand-arrows|thousand-waves|diamond-storm|glacial-lance|astral-barrage|eruption|water-spout|dragon-energy|lumina-crash|bolt-beak|fishious-rend|triple-arrows|ceaseless-edge|stone-axe|rock-wrecker|razor-wind|aeroblast)$/;
  const BURST = /^(earthquake|bulldoze|magnitude|surf|muddy-water|discharge|explosion|self-destruct|misty-explosion|dazzling-gleam|boomburst|hyper-voice|heat-wave|lava-plume|sludge-wave|petal-blizzard|bug-buzz|parabolic-charge|sparkling-aria|snarl|dark-pulse|origin-pulse|mind-blown|clanging-scales|uproar|echoed-voice|round|disarming-voice|psychic|psyshock|extrasensory|expanding-force|freezing-glare|overdrive|torch-song|alluring-voice|stomping-tantrum|high-horsepower|bonemerang|earth-power-x|icy-wind|swift|chatter|relic-song|mystical-fire)$/;
  const BEAM = /beam|cannon|laser|hydro-pump|overheat|photon-geyser|spacial-rend|prismatic|eternabeam|fleur|steam-eruption|hydro-steam|blue-flare|fusion-flare|fusion-bolt|zap-cannon|dynamax|roar-of-time|light-of-ruin|core-enforcer|armor-cannon|electro-shot|mist-ball|luster-purge|focus-blast|frost-breath/;
  const STREAM = /^(flamethrower|water-gun|scald|powder-snow|dragon-breath|smog|sludge|acid|bubble|ember|flame-burst|inferno|fiery-dance|burning-jealousy|scorching-sands|bitter-blade-x|gust|fairy-wind|silver-wind|ominous-wind|air-cutter|razor-leaf-x|poison-gas|clear-smog|acid-spray|snipe-shot|octazooka|water-pulse-x|mud-shot|mud-slap|brine|aqua-cutter|hydro-cannon|blast-burn|frenzy-plant|chloroblast|mystical-fire-x|incinerate|flame-charge-x)$/;
  const BOLT = /^(thunderbolt|thunder-shock|shock-wave|electroweb|charge-beam-x|volt-switch|rising-voltage|thunder-cage|thunderclap|plasma-fists-x|aura-wheel)$/;
  const EXCLUDE = /^(struggle|focus-punch|fling|natural-gift|last-resort|belch|snore|dream-eater|sky-drop|present|spit-up|synchronoise|beat-up|steel-roller|hidden-power|trump-card|spit-up|counter|mirror-coat|metal-burst|bide|endeavor|final-gambit|super-fang|natures-madness|ruination|psywave|night-shade|seismic-toss|dragon-rage|sonic-boom|guillotine|horn-drill|sheer-cold|fissure)$/;

  // Status moves turned into real-time buffs.
  const BUFFS = {
    "swords-dance": { stat: "atk", mult: 1.6, label: "攻撃↑↑" },
    "dragon-dance": { stat: "atk", mult: 1.4, speed: 1.25, label: "攻撃・素早さ↑" },
    "bulk-up": { stat: "atk", mult: 1.35, def: 1.3, label: "攻撃・防御↑" },
    "nasty-plot": { stat: "spa", mult: 1.6, label: "特攻↑↑" },
    "calm-mind": { stat: "spa", mult: 1.35, def: 1.3, label: "特攻・特防↑" },
    "quiver-dance": { stat: "spa", mult: 1.4, speed: 1.25, label: "特攻・素早さ↑" },
    "shell-smash": { stat: "both", mult: 1.6, speed: 1.4, def: 0.75, label: "からをやぶる！" },
    agility: { speed: 1.5, label: "素早さ↑↑" },
    "rock-polish": { speed: 1.5, label: "素早さ↑↑" },
    "iron-defense": { def: 1.6, label: "防御↑↑" },
    "cosmic-power": { def: 1.4, label: "防御・特防↑" },
    recover: { heal: 0.35, label: "HP回復" },
    roost: { heal: 0.35, label: "HP回復" },
    "slack-off": { heal: 0.35, label: "HP回復" },
    synthesis: { heal: 0.3, label: "HP回復" },
    "moonlight": { heal: 0.3, label: "HP回復" },
    "morning-sun": { heal: 0.3, label: "HP回復" },
    "soft-boiled": { heal: 0.35, label: "HP回復" },
    rest: { heal: 0.6, label: "HP回復" },
    protect: { shield: 1.6, label: "まもる" },
    detect: { shield: 1.6, label: "みきり" },
    "kings-shield": { shield: 1.6, label: "キングシールド" },
    "spiky-shield": { shield: 1.6, label: "ニードルガード" },
    "baneful-bunker": { shield: 1.6, label: "トーチカ" },
    splash: { splash: true, label: "しかし なにも おこらない！" },
  };

  const FALLBACK_MOVE = {
    slug: "tackle", name: "Tackle", jpName: "たいあたり", type: "normal",
    category: "physical", power: 40, accuracy: 100,
  };

  let roster = [];

  function statAt(base, isHp) {
    const core = Math.floor(((2 * base + 31) * LEVEL) / 100);
    return isHp ? core + LEVEL + 10 : core + 5;
  }

  function shapeOf(m) {
    const s = m.slug;
    if (m.category === "status") return "buff";
    if (BOLT.test(s)) return "bolt";
    if (STRIKE.test(s)) return "strike";
    if (BURST.test(s)) return "burst";
    if (BEAM.test(s)) return "beam";
    if (STREAM.test(s)) return "stream";
    if (m.category === "physical") return RANGED_PHYSICAL.test(s) ? "projectile" : "dash";
    return "projectile";
  }

  function makeMove(m) {
    const shape = shapeOf(m);
    const power = m.power || 0;
    const move = {
      slug: m.slug,
      name: m.name,
      jp: m.jpName || m.name,
      type: TYPES[m.type] ? m.type : "normal",
      category: m.category,
      power,
      accuracy: m.accuracy || 100,
      shape,
      buff: BUFFS[m.slug] || null,
    };
    if (shape === "buff") move.cooldown = move.buff && move.buff.heal ? 12 : move.buff && move.buff.shield ? 7 : 10;
    else move.cooldown = +(0.7 + power / 30 + (shape === "beam" || shape === "strike" ? 0.6 : 0)).toFixed(2);
    move.big = power >= 110;
    return move;
  }

  function chooseMoves(entry, types, attackBias) {
    const all = [];
    const seen = new Set();
    const groups = entry.moves || {};
    for (const key of ["levelUp", "machine", "tutor", "egg"]) {
      for (const m of groups[key] || []) {
        if (seen.has(m.slug)) continue;
        seen.add(m.slug);
        all.push(m);
      }
    }
    const attacks = all.filter((m) => m.category !== "status" && m.power >= 20 && !EXCLUDE.test(m.slug) && TYPES[m.type]);
    const buffs = all.filter((m) => m.category === "status" && BUFFS[m.slug] && m.slug !== "splash");

    const score = (m) => {
      const stab = types.includes(m.type) ? 1.5 : 1;
      const catFit = m.category === attackBias ? 1.25 : 0.7;
      const acc = Math.min(m.accuracy || 100, 100) / 100;
      const pw = Math.min(m.power, 140);
      return pw * acc * stab * catFit;
    };
    attacks.sort((a, b) => score(b) - score(a));

    const chosen = [];
    const take = (pred) => {
      const m = attacks.find((x) => !chosen.includes(x) && pred(x));
      if (m) chosen.push(m);
      return m;
    };
    const shapes = () => chosen.map(shapeOf);

    // One light, quick move; a mid-power STAB move; a coverage move; a finisher.
    take((m) => m.power <= 65 && types.includes(m.type)) || take((m) => m.power <= 65);
    take((m) => m.power > 65 && m.power < 100 && types.includes(m.type) && !shapes().includes(shapeOf(m))) ||
      take((m) => m.power > 65 && types.includes(m.type));
    take((m) => !chosen.some((c) => c.type === m.type) && m.power >= 60 && m.power <= 100 && (m.type !== "normal" || types.includes("normal")));
    take((m) => m.power >= 100 && types.includes(m.type)) ||
      take((m) => m.power >= 100 && m.category === attackBias && m.type !== "normal") ||
      take((m) => m.power >= 100);
    while (chosen.length < 4 && take(() => true)) { /* fill */ }

    let moves = chosen.slice(0, 4).sort((a, b) => a.power - b.power);
    if (moves.length < 4 && buffs.length) moves.push(buffs[0]);
    if (moves.length < 4 && all.some((m) => m.slug === "splash")) moves.push(all.find((m) => m.slug === "splash"));
    if (!moves.some((m) => m.category !== "status")) moves.unshift(FALLBACK_MOVE);
    // A buff slot keeps fights dynamic for Pokémon whose learnset offers one.
    if (moves.length === 4 && buffs.length && moves[0].power <= 50 && U.hash(entry.dex, 3) < 0.5) {
      moves[0] = buffs[0];
    }
    return moves.slice(0, 4).map(makeMove);
  }

  function kindOf(entry) {
    return entry.category.startsWith("gen") ? "gen" : entry.category;
  }

  function build() {
    const byStem = window.POKE_DATA_BY_STEM || {};
    const manifest = window.POKE_SPRITE_MANIFEST;
    roster = Object.values(byStem)
      .filter((e) => e.sprite && e.baseStats)
      .map((e) => {
        const front = e.sprite;
        const back = e.backSprite || front;
        return {
          id: e.id,
          dex: e.dex,
          slug: e.slug,
          name: e.name,
          jp: e.jpName || e.name,
          kind: kindOf(e),
          types: (e.typeMatchups && e.typeMatchups.types) || ["normal"],
          stats: e.baseStats,
          bst: e.baseStatTotal,
          heightM: (e.height && e.height.meters) || 1,
          weightKg: (e.weight && e.weight.kilograms) || 30,
          defense: (e.typeMatchups && e.typeMatchups.defenseMultipliers) || {},
          isLegendary: e.isLegendary,
          sprites: {
            front,
            frontR: (manifest && manifest.reverseFor(front)) || front,
            back,
            backR: (manifest && manifest.reverseFor(back)) || back,
            icon: front.replace(/front\.gif$/, "front.png"),
          },
          raw: e,
          _moves: null,
        };
      })
      .sort((a, b) => a.dex - b.dex || a.id.localeCompare(b.id));
    return roster;
  }

  function movesFor(p) {
    if (!p._moves) {
      const bias = p.stats.attack >= p.stats.specialAttack ? "physical" : "special";
      p._moves = chooseMoves(p.raw, p.types, bias);
    }
    return p._moves;
  }

  function battleStats(p) {
    const s = p.stats;
    return {
      hp: statAt(s.hp, true),
      atk: statAt(s.attack),
      def: statAt(s.defense),
      spa: statAt(s.specialAttack),
      spd: statAt(s.specialDefense),
      spe: statAt(s.speed),
    };
  }

  // Classic level-50 damage formula, scaled for real-time pacing.
  function damage(attacker, defender, move, powerScale = 1) {
    const special = move.category === "special";
    const atk = (special ? attacker.stats.spa : attacker.stats.atk) * attacker.attackMult(special);
    const def = (special ? defender.stats.spd : defender.stats.def) * defender.defenseMult();
    const base = ((2 * LEVEL) / 5 + 2) * move.power * powerScale * (atk / def) / 50 + 2;
    const stab = attacker.species.types.includes(move.type) ? 1.5 : 1;
    const eff = defender.species.defense[move.type] ?? 1;
    const crit = U.chance(0.0625) ? 1.5 : 1;
    const roll = U.rand(0.85, 1);
    return {
      amount: Math.max(eff === 0 ? 0 : 1, Math.round(base * stab * eff * crit * roll * DAMAGE_SCALE)),
      eff,
      crit: crit > 1,
    };
  }

  // ---------- Shiny ----------
  // A shiny is a shallow copy of a roster entry (same id / stats / moves) whose sprites point at the
  // *-shiny files from pokeSprite/manifest.js. Battle sheets (pokeAnim) are recoloured at load time
  // from the front.png -> front-shiny.png palette, see Sprites.anim(). Only forms with a complete
  // shiny set in the manifest get one; shinyOf() returns the plain entry for the rest.
  const shinyCache = new Map();
  function shinyOf(p) {
    if (!p || p.shiny) return p;
    if (shinyCache.has(p)) return shinyCache.get(p);
    const manifest = window.POKE_SPRITE_MANIFEST;
    const s = p.sprites;
    const front = manifest && manifest.shinyFor(s.front);
    if (!front) { shinyCache.set(p, p); return p; }
    const sh = Object.assign(Object.create(Object.getPrototypeOf(p)), p, {
      shiny: true,
      base: p,
      jp: `✨${p.jp}`,
      sprites: {
        front,
        frontR: manifest.shinyFor(s.frontR) || manifest.reverseFor(front) || front,
        back: manifest.shinyFor(s.back) || s.back,
        backR: manifest.shinyFor(s.backR) || s.backR,
        icon: manifest.shinyFor(s.icon) || s.icon,
      },
      // Palette source for recolouring sheets: the still front sprites, normal and shiny.
      shinyPair: { normal: s.icon, shiny: manifest.shinyFor(s.icon) || s.icon },
      _profile: null,
    });
    shinyCache.set(p, sh);
    return sh;
  }
  const plainOf = (p) => (p && p.shiny ? p.base : p);
  const hasShiny = (p) => shinyOf(plainOf(p)) !== plainOf(p);

  const SPECIAL_KINDS = ["mega", "gigantamax"];
  const rootCache = new Map();

  // The ordinary form a Mega / Gigantamax form belongs to: the same-dex form with the longest matching slug prefix.
  function rootOf(p) {
    p = plainOf(p);
    if (!SPECIAL_KINDS.includes(p.kind)) return p;
    if (!rootCache.has(p)) {
      const plain = roster.filter((q) => q.dex === p.dex && !SPECIAL_KINDS.includes(q.kind));
      const hits = plain.filter((q) => p.slug.startsWith(q.slug + "-")).sort((a, b) => b.slug.length - a.slug.length);
      rootCache.set(p, hits[0] || plain[0] || p);
    }
    return rootCache.get(p);
  }

  // Forms a fighter can switch between in battle: { root, mega: [...], gigantamax: [...] }.
  // A shiny fighter gets the shiny copies of its forms (where the manifest has them).
  function formsOf(p) {
    const shiny = !!p.shiny;
    p = plainOf(p);
    const root = rootOf(p);
    // Forms named after the root (charizard -> charizard-mega-x), plus the picked form itself when its own root is missing.
    const same = roster.filter((q) => q.dex === p.dex && SPECIAL_KINDS.includes(q.kind) && (q === p || q.slug.startsWith(root.slug + "-")));
    const wrap = (q) => (shiny ? shinyOf(q) : q);
    return { root: wrap(root), mega: same.filter((q) => q.kind === "mega").map(wrap), gigantamax: same.filter((q) => q.kind === "gigantamax").map(wrap) };
  }

  // How height, weight and speed from pokeData shape a fighter on the field.
  function profileOf(p) {
    if (!p._profile) {
      const spe = statAt(p.stats.speed);
      // Height sets the drawn body size: 0.4m Pikachu ≈ 44px, 1.7m Charizard ≈ 68px, 8.8m Onix ≈ 110px.
      let bodyH = U.clamp(58 * Math.pow(p.heightM, 0.3), 30, 112);
      // Gigantamax heights (20m+) would all clamp; grow from the ordinary form instead.
      if (p.kind === "gigantamax") bodyH = U.clamp(profileOf(rootOf(p)).bodyH * 1.5, 110, 150);
      const kg = p.kind === "gigantamax" ? profileOf(rootOf(p)).weightKg * 2 : p.weightKg;
      p._profile = {
        bodyH,
        weightKg: kg,
        // Lighter Pokémon get knocked further; heavier ones push harder with contact moves.
        knockTaken: U.clamp(Math.pow(30 / Math.max(kg, 0.1), 0.2), 0.55, 1.6),
        push: U.clamp(Math.pow(kg / 30, 0.15), 0.8, 1.4),
        // Heavier bodies take longer to reach full speed or stop.
        grip: U.clamp(0.0005 * Math.pow(kg / 30, 0.6), 0.0001, 0.02),
        // Speed sets the tempo: move cooldowns, wind-ups, dodge recovery, animation rate.
        // Lv.50 speed runs ~25 (Shuckle) to ~250 (Regieleki): tempo ≈ 0.6 to 1.5.
        tempo: U.clamp(Math.pow(spe / 100, 0.5), 0.6, 1.5),
        runSpeed: 60 + spe * 0.8,
        // Larger bodies reach further with contact moves and sprays: Pikachu ≈ 0.9, Onix ≈ 1.25.
        bodyReach: U.clamp(Math.pow(bodyH / 68, 0.5), 0.8, 1.35),
      };
    }
    return p._profile;
  }

  // Attack (physical) or Sp. Atk (special) scales how big, far-reaching and forceful a move is.
  // Lv.50 stats run ~25 to ~250 (more with buffs): might ≈ 0.65 to 1.6.
  function mightOf(stat) {
    return U.clamp(Math.pow(stat / 105, 0.6), 0.65, 1.6);
  }

  function search(query, kind) {
    const q = query.trim().toLowerCase();
    const typeHit = Object.entries(TYPES).find(([k, t]) => q && (t.jp === q || k === q));
    return roster.filter((p) => {
      if (kind && p.kind !== kind) return false;
      if (!q) return true;
      if (typeHit) return p.types.includes(typeHit[0]);
      if (/^\d+$/.test(q)) return String(p.dex) === String(+q);
      return p.jp.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.slug.includes(q);
    });
  }

  function randomTeam(n = 3, kind = "") {
    // The menu's form filter: "" is every form, otherwise gen / mega / regional / gigantamax.
    const pool = roster.filter((p) => !kind || p.kind === kind);
    return U.shuffle(pool.slice()).slice(0, n);
  }

  return {
    build,
    movesFor,
    battleStats,
    damage,
    search,
    randomTeam,
    formsOf,
    profileOf,
    mightOf,
    shinyOf,
    plainOf,
    hasShiny,
    get roster() { return roster; },
    // "charizard" or "charizard*" (shiny).
    bySlug: (slug) => {
      const shiny = slug.endsWith("*");
      const p = roster.find((q) => q.slug === (shiny ? slug.slice(0, -1) : slug));
      return shiny ? shinyOf(p) : p;
    },
  };
})();
