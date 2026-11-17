// utils.js — small math and random helpers shared by every system.
// No engine, no network: plain functions the game calls every frame.

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
// Frame-rate-independent exponential smoothing factor (camera-systems skill):
// same feel at 30 fps and 144 fps. rate ~ 5..12.
export function smoothFactor(rate, dt) { return 1 - Math.exp(-rate * dt); }
export function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
export function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
// Shortest signed turn from angle a toward angle b, in (-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
export function turnToward(a, b, maxStep) {
  const d = angleDiff(a, b);
  return a + clamp(d, -maxStep, maxStep);
}

// Deterministic seeded RNG (mulberry32) so a fixed seed replays the same city.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function randRange(rng, a, b) { return a + rng() * (b - a); }
// Unseeded range for purely cosmetic randomness (particles, spawns).
export function rr(a, b) { return a + Math.random() * (b - a); }
export function randInt(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }

// Circle vs axis-aligned box: push the circle out and report the hit normal.
export function circleVsBox(cx, cy, r, bx, by, bw, bh) {
  const nx = clamp(cx, bx, bx + bw), ny = clamp(cy, by, by + bh);
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const left = cx - bx, right = bx + bw - cx, top = cy - by, bottom = by + bh - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, depth: left + r };
  if (m === right) return { nx: 1, ny: 0, depth: right + r };
  if (m === top) return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
}

// Format money the way the HUD shows it.
export function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
