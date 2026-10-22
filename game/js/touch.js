// On-screen stick and buttons for phones. They feed Input, the same path as the keyboard.
"use strict";

const Touch = (() => {
  const AXES = ["arrowleft", "arrowright", "arrowup", "arrowdown"];
  const MOVE_KEYS = ["z", "x", "c", "v"];
  const pointers = new Map();
  let root, stick, knob, moveButtons, utilButtons;
  let stickId = null;
  let origin = null;

  function wants() {
    const q = new URLSearchParams(location.search);
    if (q.get("touch") === "0") return false;
    if (q.get("touch") === "1") return true;
    return matchMedia("(pointer: coarse)").matches
      || matchMedia("(hover: none)").matches
      || navigator.maxTouchPoints > 0;
  }

  function setKey(key, down) {
    if (down) Input.hold(key);
    else Input.release(key);
  }

  function releaseOwned() {
    for (const rec of pointers.values()) if (rec.key) setKey(rec.key, false);
    pointers.clear();
    stickId = null;
    origin = null;
    AXES.forEach((k) => setKey(k, false));
    if (knob) knob.style.transform = "translate(0px, 0px)";
  }

  function bindPress(el) {
    const key = () => el.dataset.key;
    const down = (e) => {
      if (el.hidden || e.button > 0) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
      pointers.set(e.pointerId, { key: key(), el });
      setKey(key(), true);
      el.classList.add("is-down");
      e.preventDefault();
    };
    const up = (e) => {
      const rec = pointers.get(e.pointerId);
      if (!rec || rec.el !== el) return;
      pointers.delete(e.pointerId);
      setKey(rec.key, false);
      el.classList.remove("is-down");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function stickVector(e) {
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    const max = 42;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, max);
    knob.style.transform = `translate(${(dx / len) * clamped}px, ${(dy / len) * clamped}px)`;
    const dead = 12;
    const axis = (neg, pos, v) => {
      setKey(neg, v < -dead);
      setKey(pos, v > dead);
    };
    axis("arrowleft", "arrowright", dx);
    axis("arrowup", "arrowdown", dy);
  }

  function bindStick() {
    const down = (e) => {
      if (e.button > 0) return;
      try { stick.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
      stickId = e.pointerId;
      const r = stick.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stickVector(e);
      e.preventDefault();
    };
    const move = (e) => { if (e.pointerId === stickId) stickVector(e); };
    const up = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      AXES.forEach((k) => setKey(k, false));
      knob.style.transform = "translate(0px, 0px)";
    };
    stick.addEventListener("pointerdown", down);
    stick.addEventListener("pointermove", move);
    stick.addEventListener("pointerup", up);
    stick.addEventListener("pointercancel", up);
  }

  function label(el, name, sub) {
    const nm = el.querySelector(".nm");
    const cd = el.querySelector(".cd");
    if (nm && nm.textContent !== name) nm.textContent = name;
    if (cd && cd.textContent !== sub) cd.textContent = sub;
  }

  function init() {
    root = document.querySelector("#touch");
    if (!root || !wants()) return;
    stick = root.querySelector("#stick");
    knob = root.querySelector("#stick-knob");
    moveButtons = [...root.querySelectorAll("[data-move]")];
    utilButtons = [...root.querySelectorAll("[data-util]")];
    moveButtons.forEach(bindPress);
    utilButtons.forEach(bindPress);
    bindStick();
    document.body.classList.add("can-touch");
  }

  // active: the battle is accepting play input. Otherwise the pad hides and releases its keys.
  function sync(battle, active) {
    if (!root || !document.body.classList.contains("can-touch")) return;
    const show = !!(active && battle && battle.active && battle.active[0]);
    root.hidden = !show;
    document.body.classList.toggle("touch-play", show);
    if (!show) {
      releaseOwned();
      return;
    }
    const f = battle.active[0];
    const play = battle.mode === "play";
    stick.hidden = !play;
    moveButtons.forEach((el, i) => {
      const m = f.moves[i];
      el.hidden = !m;
      if (!m) return;
      const cd = f.cooldowns[i] > 0.05 ? f.cooldowns[i].toFixed(1) : "";
      label(el, m.jp, cd);
      el.style.setProperty("--type", (TYPES[m.type] && TYPES[m.type].color) || "#ffcb05");
    });
    const forms = f.forms || { mega: [], gigantamax: [] };
    const mega = root.querySelector('[data-key="m"]');
    const gmax = root.querySelector('[data-key="g"]');
    const cpu = root.querySelector('[data-key="t"]');
    if (mega) {
      mega.hidden = !forms.mega.length;
      const back = f.nextForm && f.nextForm("mega") === f.forms.root;
      label(mega, back ? "戻る" : "メガ", "");
    }
    if (gmax) {
      gmax.hidden = !forms.gigantamax.length;
      const back = f.nextForm && f.nextForm("gigantamax") === f.forms.root;
      label(gmax, back ? "戻る" : "キョダイ", "");
    }
    if (cpu) {
      cpu.hidden = !play;
      label(cpu, battle.cpuAttack ? "CPU攻" : "練習", "");
    }
  }

  return { init, sync };
})();
