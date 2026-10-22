// Shared helpers: math, randomness, colors and type metadata.
"use strict";

const TAU = Math.PI * 2;

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  chance: (p) => Math.random() < p,
  dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  angle: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeOutBack: (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
  // Distance from point to segment, used for beam hit tests.
  segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = U.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  },
  // Deterministic hash noise for procedural pixel art.
  hash(x, y, s = 0) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },
  smoothNoise(x, y, s = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = U.hash(xi, yi, s), b = U.hash(xi + 1, yi, s);
    const c = U.hash(xi, yi + 1, s), d = U.hash(xi + 1, yi + 1, s);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  },
  fbm(x, y, s = 0, oct = 4) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      v += U.smoothNoise(x * f, y * f, s + i * 17) * amp;
      f *= 2;
      amp *= 0.5;
    }
    return v;
  },
  hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  rgba(c, a) {
    const [r, g, b] = U.hex(c);
    return `rgba(${r},${g},${b},${a})`;
  },
  mix(c1, c2, t) {
    const a = U.hex(c1), b = U.hex(c2);
    const m = a.map((v, i) => Math.round(U.lerp(v, b[i], t)));
    return "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("");
  },
  canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  },
};

const TYPES = {
  normal:   { jp: "ノーマル", color: "#a8a77a", fx: ["#ffffff", "#e8e4cf", "#bdb99a"] },
  fire:     { jp: "ほのお",   color: "#ee8130", fx: ["#fff6b0", "#ffb52e", "#ff5a1f", "#c2260f"] },
  water:    { jp: "みず",     color: "#6390f0", fx: ["#ffffff", "#bfe6ff", "#5fb4ff", "#2a6fe0"] },
  electric: { jp: "でんき",   color: "#f7d02c", fx: ["#ffffff", "#fff59a", "#ffd51c", "#ffaa00"] },
  grass:    { jp: "くさ",     color: "#7ac74c", fx: ["#eaffb8", "#a6e85a", "#5cbf3a", "#2f8a2b"] },
  ice:      { jp: "こおり",   color: "#96d9d6", fx: ["#ffffff", "#e0fbff", "#a6ecff", "#6cc6f0"] },
  fighting: { jp: "かくとう", color: "#c22e28", fx: ["#fff1d6", "#ffb067", "#e8582c", "#9f2a1d"] },
  poison:   { jp: "どく",     color: "#a33ea1", fx: ["#f3c8ff", "#d27cf5", "#a33ea1", "#6a1f78"] },
  ground:   { jp: "じめん",   color: "#e2bf65", fx: ["#f6e2a8", "#d9b062", "#a87d3c", "#6e4f25"] },
  flying:   { jp: "ひこう",   color: "#a98ff3", fx: ["#ffffff", "#e3ddff", "#bfb2ff", "#8f7fe0"] },
  psychic:  { jp: "エスパー", color: "#f95587", fx: ["#ffe0ee", "#ff9cc3", "#f95587", "#b8285e"] },
  bug:      { jp: "むし",     color: "#a6b91a", fx: ["#f4ffb0", "#c9dc3a", "#a6b91a", "#6b7a10"] },
  rock:     { jp: "いわ",     color: "#b6a136", fx: ["#efe2b0", "#c8b26a", "#937c3e", "#5e4d27"] },
  ghost:    { jp: "ゴースト", color: "#735797", fx: ["#efe0ff", "#b493e8", "#735797", "#3a2659"] },
  dragon:   { jp: "ドラゴン", color: "#6f35fc", fx: ["#e6dcff", "#a985ff", "#6f35fc", "#3a19a1"] },
  dark:     { jp: "あく",     color: "#705746", fx: ["#d9c6ff", "#7b5ca8", "#3b2c4e", "#17111f"] },
  steel:    { jp: "はがね",   color: "#b7b7ce", fx: ["#ffffff", "#e3e8f2", "#aeb6c8", "#6e7891"] },
  fairy:    { jp: "フェアリー", color: "#d685ad", fx: ["#ffffff", "#ffd8ec", "#ff9ccf", "#e06aa8"] },
};

// Keys -> pressed state, shared by input handling and the game loop.
const Input = {
  down: new Set(),
  pressed: new Set(),
  init() {
    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k) && !/INPUT|SELECT/.test(e.target.tagName)) {
        e.preventDefault();
      }
      this.hold(k);
    });
    addEventListener("keyup", (e) => this.release(e.key.toLowerCase()));
    addEventListener("blur", () => this.down.clear());
  },
  // Touch controls use the same sets as the keyboard, so battle.js does not grow a second path.
  hold(key) {
    const k = String(key).toLowerCase();
    if (!this.down.has(k)) this.pressed.add(k);
    this.down.add(k);
  },
  release(key) { this.down.delete(String(key).toLowerCase()); },
  isDown(...keys) { return keys.some((k) => this.down.has(k)); },
  wasPressed(...keys) { return keys.some((k) => this.pressed.has(k)); },
  endFrame() { this.pressed.clear(); },
};
