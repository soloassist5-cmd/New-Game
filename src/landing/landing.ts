import './landing.css';
import { BALANCE } from '../game/config';

/**
 * Landing hero: a 2D sonar of the game's look. A hidden corridor (blue), a figure at its end (red)
 * and the exit (gold) exist as points; a ping reveals the ones its ring passes. Click to clap;
 * idle visitors get an automatic ping every few seconds. Reduced motion: one static reveal.
 */

type Kind = 0 | 1 | 2; // world, monster, exit
interface Pt {
  x: number;
  y: number;
  k: Kind;
  lit: number; // time it was last revealed (s), -1 never
}

const COLORS: Record<Kind, [number, number, number]> = {
  0: [79, 195, 247],
  1: [255, 59, 59],
  2: [255, 201, 77],
};

const canvas = document.getElementById('sonar') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let pts: Pt[] = [];
let W = 0;
let H = 0;
let dpr = 1;
const pings: Array<{ x: number; y: number; t: number; r: number }> = [];
let claps = 0;
let lastInteraction = -10;
let seed = 7;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/** A one-point-perspective corridor, a stalker silhouette at its far end and an exit glow beyond. */
function build(): void {
  seed = 7;
  pts = [];
  const vx = W * 0.68;
  const vy = H * 0.5;
  const proj = (x: number, y: number, z: number): [number, number] => {
    const f = Math.min(W, H) * 0.9;
    return [vx + (x * f) / z, vy - (y * f) / z];
  };
  // Walls, floor and ceiling of a 4 m wide, 3 m tall corridor from z = 1.2 to 26 m.
  for (let i = 0; i < 2600; i++) {
    const z = 1.2 + Math.pow(rnd(), 0.7) * 25;
    const side = rnd();
    let x: number;
    let y: number;
    if (side < 0.32) {
      x = -2;
      y = rnd() * 3 - 1.6;
    } else if (side < 0.64) {
      x = 2;
      y = rnd() * 3 - 1.6;
    } else if (side < 0.88) {
      x = rnd() * 4 - 2;
      y = -1.6;
    } else {
      x = rnd() * 4 - 2;
      y = 1.4;
    }
    const [sx, sy] = proj(x, y, z);
    if (sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20) pts.push({ x: sx, y: sy, k: 0, lit: -1 });
  }
  // The stalker: too tall, arms too long, head cocked.
  const mz = 11;
  const body = (x: number, y: number): void => {
    const [sx, sy] = proj(x, y, mz);
    pts.push({ x: sx, y: sy, k: 1, lit: -1 });
  };
  for (let i = 0; i < 260; i++) {
    const u = rnd();
    if (u < 0.3) body((rnd() < 0.5 ? -0.11 : 0.11) + (rnd() - 0.5) * 0.04, -1.6 + rnd() * 1.0);
    else if (u < 0.65) {
      const h = -0.6 + rnd() * 0.95;
      body((rnd() - 0.5) * (0.26 + 0.12 * Math.sin(((h + 0.6) / 0.95) * Math.PI)), h);
    } else if (u < 0.82) {
      const a = rnd() * Math.PI * 2;
      body(0.1 + Math.cos(a) * 0.11 * Math.sqrt(rnd()), 0.6 + Math.sin(a) * 0.15 * Math.sqrt(rnd()));
    } else {
      const side = rnd() < 0.5 ? -1 : 1;
      const t = rnd();
      body(side * (0.24 + t * 0.12), 0.25 - t * 1.6);
    }
  }
  // Eyes.
  for (const ex of [0.05, 0.15]) for (let i = 0; i < 3; i++) body(ex, 0.62);
  // Exit glow at the far end.
  for (let i = 0; i < 70; i++) {
    const [sx, sy] = proj((rnd() - 0.5) * 0.7, -1.6 + rnd() * 3, 24 + rnd());
    pts.push({ x: sx, y: sy, k: 2, lit: -1 });
  }
}

function resize(): void {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  build();
}

const SPEED = 900; // px/s — the visible ring
const LIFE = 3.2; // s a point stays lit

function ping(x: number, y: number, now: number): void {
  const r = Math.hypot(Math.max(x, W - x), Math.max(y, H - y));
  pings.push({ x, y, t: now, r });
  claps++;
  const el = document.getElementById('ro-claps');
  if (el) el.textContent = String(claps);
}

function frame(ms: number): void {
  const now = ms / 1000;
  ctx.clearRect(0, 0, W, H);
  // Auto-ping for idle visitors, from where the "player" stands.
  if (!reduce && now - lastInteraction > 4.5 && (pings.length === 0 || now - pings[pings.length - 1].t > 4.2)) {
    ping(W * 0.18, H * 0.62, now);
  }
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i];
    const rad = (now - p.t) * SPEED;
    if (rad > p.r + 40) {
      pings.splice(i, 1);
      continue;
    }
    // Reveal points the ring has just crossed.
    const prev = rad - SPEED / 50;
    for (const q of pts) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= rad && d > prev - 2) q.lit = now;
    }
    ctx.strokeStyle = `rgba(79,195,247,${0.22 * Math.max(0, 1 - rad / p.r)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const q of pts) {
    if (q.lit < 0) continue;
    const age = now - q.lit;
    if (age > LIFE) continue;
    const a = Math.pow(1 - age / LIFE, 1.6) * (1 + 1.4 * Math.exp(-age * 10));
    const [r, g, b] = COLORS[q.k];
    const jitter = q.k === 1 ? (Math.random() - 0.5) * 1.6 : 0;
    const size = q.k === 0 ? 1.5 : 1.9;
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a * 0.85)})`;
    ctx.beginPath();
    ctx.arc(q.x + jitter, q.y + jitter, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  if (!reduce) requestAnimationFrame(frame);
}

resize();
window.addEventListener('resize', resize);
const hero = document.querySelector('.hero') as HTMLElement;
hero.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('a, button, video')) return;
  const r = canvas.getBoundingClientRect();
  lastInteraction = performance.now() / 1000;
  ping(e.clientX - r.left, e.clientY - r.top, lastInteraction);
  if (reduce) requestAnimationFrame(frame);
});

if (reduce) {
  // One still frame with everything revealed.
  for (const q of pts) q.lit = 0.01;
  requestAnimationFrame(() => frame(10));
} else {
  requestAnimationFrame(frame);
}

// Hearing scale, from the game's own balance numbers (metres).
const P = BALANCE.player;
const rows: Array<[string, number, boolean]> = [
  ['Красться', P.sneakStepRadius, false],
  ['Одышка после бега', BALANCE.stamina.pantRadius, false],
  ['Шаг', P.walkStepRadius, false],
  ['Бег', P.sprintStepRadius, true],
  ['Падение камня', BALANCE.stone.landRadius, true],
  ['Хлопок', P.clapRadius, true],
];
const max = 16;
const host = document.getElementById('scale-rows');
if (host) {
  host.innerHTML = rows
    .map(
      ([label, m, loud]) =>
        `<div class="scale-row${loud ? ' loud' : ''}"><div class="scale-label"><span>${label}</span><b>${String(m).replace('.', ',')} м</b></div><div class="scale-track"><div class="scale-bar" style="--v:${m / max}"></div></div></div>`,
    )
    .join('');
}
