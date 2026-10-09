import { BALANCE } from '../game/config';
import { hasLineOfSight, raycast, type RayHit } from '../game/level';
import type { Monster, SoundEvent, World } from '../game/types';
import { PALETTE, SHAPE, type Rgb } from './palette';
import type { PointCloud } from './pointcloud';

const H = BALANCE.world.wallHeight;
const SPEED = BALANCE.sound.waveSpeed;

interface Recipe {
  rays: number;
  wallPts: number; // points per wall hit (vertical column)
  floorStep: number; // m between floor points along a ray (0 = none)
  ceilStep: number;
  life: number; // s
  intensity: number;
  color: Rgb;
  size: number;
  /** Reveal monsters/exit/pickups within radius. */
  reveals: boolean;
  /** Max height of wall points (low sounds only light the bottom of walls). */
  maxH: number;
}

const R = (r: Partial<Recipe>): Recipe => ({
  rays: 120,
  wallPts: 3,
  floorStep: 0.9,
  ceilStep: 0,
  life: 2,
  intensity: 0.6,
  color: PALETTE.world,
  size: 1,
  reveals: true,
  maxH: H,
  ...r,
});

const RECIPES: Partial<Record<SoundEvent['kind'], Recipe>> = {
  step: R({ rays: 90, wallPts: 3, floorStep: 0.7, life: 2.0, intensity: 0.4, maxH: 1.4 }),
  sprintStep: R({ rays: 140, wallPts: 4, floorStep: 0.8, life: 2.4, intensity: 0.55, maxH: 2.0 }),
  pant: R({ rays: 40, wallPts: 1, floorStep: 0.6, life: 1.0, intensity: 0.22, maxH: 0.6, reveals: false }),
  sneakStep: R({ rays: 48, wallPts: 2, floorStep: 0.45, life: 1.4, intensity: 0.32, maxH: 0.6, reveals: false }),
  clap: R({ rays: 560, wallPts: 6, floorStep: 0.9, ceilStep: 1.8, life: 5.2, intensity: 0.75 }),
  clapEcho: R({ rays: 400, wallPts: 4, floorStep: 1.2, ceilStep: 2.4, life: 4.2, intensity: 0.45 }),
  stoneLand: R({ rays: 320, wallPts: 5, floorStep: 0.9, ceilStep: 2, life: 4.2, intensity: 0.65 }),
  throw: R({ rays: 24, wallPts: 1, floorStep: 0.5, life: 0.8, intensity: 0.25, reveals: false, maxH: 1 }),
  scream: R({ rays: 420, wallPts: 5, floorStep: 1.0, ceilStep: 2, life: 3.0, intensity: 0.75, color: PALETTE.danger, reveals: false }),
};

/** Turns sound events into point-cloud reveals. Pure presentation: reads the world, never mutates it. */
export class EchoPainter {
  private hit: RayHit = { dist: 0, nx: 0, ny: 0, hit: false };
  private seed = 1;
  echoLifeMul = 1;
  monsterRevealMul = 1;

  constructor(private cloud: PointCloud) {}

  private rnd(): number {
    // Cheap LCG — visual jitter only, deliberately separate from the simulation RNG.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  paint(world: World, s: SoundEvent, now: number): void {
    this.viewer.x = world.player.x;
    this.viewer.y = world.player.y;
    switch (s.kind) {
      case 'monsterStep':
      case 'growl':
      case 'breath': {
        const m = world.monsters.find((mo) => mo.id === s.monsterId);
        if (m) this.monsterBody(m, now, s.kind === 'growl' ? 0.9 : 0.5, 1.6 * this.monsterRevealMul, s.kind === 'monsterStep' ? 22 : 40);
        this.floorRing(s.x, s.y, s.kind === 'growl' ? 3 : 1.2, PALETTE.danger, 0.35, now, 1.2, s.kind === 'growl' ? 60 : 14);
        return;
      }
      case 'beacon':
        this.exitShape(world, now, 0.55, 1.5, 36);
        return;
    }
    const rec = RECIPES[s.kind];
    if (!rec) return;
    this.wave(world, s, rec, now);
    if (s.kind === 'stoneLand') this.burst(s.x, s.y, PALETTE.pickup, now, 24);
    if (rec.reveals) this.revealThings(world, s, now, rec);
  }

  private wave(world: World, s: SoundEvent, rec: Recipe, now: number): void {
    const { cloud } = this;
    const life = rec.life * this.echoLifeMul;
    const radius = s.radius;
    const offset = this.rnd() * Math.PI * 2;
    for (let i = 0; i < rec.rays; i++) {
      const a = offset + ((i + this.rnd() * 0.8) / rec.rays) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      raycast(world.level, s.x, s.y, dx, dy, radius, this.hit);
      const d = this.hit.dist;
      if (this.hit.hit) {
        const fall = 0.35 + 0.65 * (1 - d / radius);
        const hx = s.x + dx * d + this.hit.nx * 0.03;
        const hy = s.y + dy * d + this.hit.ny * 0.03;
        const tx = -this.hit.ny;
        const ty = this.hit.nx;
        for (let j = 0; j < rec.wallPts; j++) {
          const h = ((j + this.rnd()) / rec.wallPts) * rec.maxH;
          const t = (this.rnd() - 0.5) * 0.12;
          const bt = now + (Math.hypot(d, h - 1) / SPEED);
          cloud.add(hx + tx * t, h, hy + ty * t, rec.color, rec.intensity * fall, bt, life * (0.8 + 0.4 * this.rnd()), 1.15 * rec.size);
        }
      }
      if (rec.floorStep > 0) {
        let r = 0.35 + this.rnd() * rec.floorStep;
        while (r < d - 0.1) {
          const fall = 0.3 + 0.7 * (1 - r / radius);
          cloud.add(s.x + dx * r, 0.02, s.y + dy * r, rec.color === PALETTE.world ? PALETTE.floor : rec.color, rec.intensity * 0.55 * fall, now + r / SPEED, life * 0.8, 0.9 * rec.size);
          r += rec.floorStep * (0.8 + this.rnd() * 0.5);
        }
      }
      if (rec.ceilStep > 0) {
        let r = 0.8 + this.rnd() * rec.ceilStep;
        while (r < d - 0.1) {
          cloud.add(s.x + dx * r, H - 0.02, s.y + dy * r, PALETTE.floor, rec.intensity * 0.3 * (1 - r / radius), now + Math.hypot(r, 1.4) / SPEED, life * 0.7, 0.8);
          r += rec.ceilStep * (0.8 + this.rnd() * 0.5);
        }
      }
    }
  }

  private revealThings(world: World, s: SoundEvent, now: number, rec: Recipe): void {
    const lvl = world.level;
    for (const m of world.monsters) {
      const d = Math.hypot(m.x - s.x, m.y - s.y);
      if (d <= s.radius && hasLineOfSight(lvl, s.x, s.y, m.x, m.y)) {
        this.monsterBody(m, now + d / SPEED, 1.1, 3.2 * this.monsterRevealMul * Math.max(0.7, rec.life / 5), 90);
      }
    }
    const e = lvl.exit;
    const de = Math.hypot(e.x - s.x, e.y - s.y);
    if (de <= s.radius && hasLineOfSight(lvl, s.x, s.y, e.x, e.y)) this.exitShape(world, now + de / SPEED, 1, rec.life * 1.3 * this.echoLifeMul, 90);
    for (const p of world.pickups) {
      if (p.taken) continue;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d <= s.radius && hasLineOfSight(lvl, s.x, s.y, p.x, p.y)) {
        for (let i = 0; i < 9; i++) {
          const a = this.rnd() * Math.PI * 2;
          const r = this.rnd() * 0.18;
          this.cloud.add(p.x + Math.cos(a) * r, 0.06 + this.rnd() * 0.12, p.y + Math.sin(a) * r, PALETTE.pickup, 1.1, now + d / SPEED, rec.life * 1.2 * this.echoLifeMul, 2.6, SHAPE.ring);
        }
      }
    }
  }

  /** Where the player is — monsters' eyes turn toward this. Updated every frame by the renderer. */
  viewer = { x: 0, y: 0 };

  /**
   * Red silhouettes, drawn to unsettle: the stalker is too tall, its arms hang past its knees and
   * its head is cocked; the listener is a spider-thing with jointed legs and a ring of a mouth.
   * Points carry the "monster" shape, so the shader makes them twitch and glitch.
   */
  monsterBody(m: Monster, birth: number, intensity: number, life: number, count: number): void {
    const c = this.cloud;
    const R = PALETTE.danger;
    const add = (x: number, h: number, y: number, k: number, size = 1.6, l = life): void =>
      c.add(x, h, y, R, intensity * k * 1.25, birth + this.rnd() * 0.05, l * (0.8 + 0.4 * this.rnd()), size, SHAPE.cross);
    // Body frame facing the viewer: f = forward, s = side.
    let fx = this.viewer.x - m.x;
    let fy = this.viewer.y - m.y;
    const fl = Math.hypot(fx, fy) || 1;
    fx /= fl;
    fy /= fl;
    const sx = -fy;
    const sy = fx;
    const at = (side: number, fwd: number): [number, number] => [m.x + sx * side + fx * fwd, m.y + sy * side + fy * fwd];

    if (m.kind === 'stalker') {
      const headH = 2.2;
      const tilt = 0.12; // cocked head
      for (let i = 0; i < count; i++) {
        const u = this.rnd();
        if (u < 0.32) {
          // Legs: two thin columns, knees bent slightly forward.
          const side = this.rnd() < 0.5 ? -0.11 : 0.11;
          const h = this.rnd() * 1.0;
          const [x, y] = at(side + (this.rnd() - 0.5) * 0.05, Math.sin((h / 1.0) * Math.PI) * 0.08);
          add(x, h, y, 0.8 + 0.4 * this.rnd());
        } else if (u < 0.7) {
          // Narrow torso with ribs: points cluster on horizontal bands.
          let h = 1.0 + this.rnd() * 0.95;
          if (this.rnd() < 0.6) h = 1.15 + Math.round((h - 1.15) / 0.11) * 0.11;
          const a = this.rnd() * Math.PI * 2;
          const r = (0.13 + 0.08 * Math.sin(((h - 1) / 0.95) * Math.PI)) * (0.7 + 0.3 * this.rnd());
          const [x, y] = at(Math.cos(a) * r, Math.sin(a) * r * 0.6);
          add(x, h, y, 0.7 + 0.5 * this.rnd());
        } else if (u < 0.88) {
          // Head: small skull, tilted sideways, sitting on a long thin neck.
          const a = this.rnd() * Math.PI * 2;
          const b = Math.acos(this.rnd() * 2 - 1);
          const r = 0.12;
          const [x, y] = at(tilt + Math.sin(b) * Math.cos(a) * r, Math.sin(b) * Math.sin(a) * r);
          add(x, headH + Math.cos(b) * r * 1.3, y, 0.9 + 0.3 * this.rnd());
        } else {
          // Arms: too long, hanging below the knees, with long fingers.
          const side = this.rnd() < 0.5 ? -1 : 1;
          const t = this.rnd();
          const h = 1.85 - t * 1.6;
          const [x, y] = at(side * (0.24 + t * 0.12), 0.05 + t * 0.1);
          add(x, h, y, 0.75, 1.4);
          if (t > 0.85) {
            const [fx2, fy2] = at(side * (0.36 + (this.rnd() - 0.5) * 0.08), 0.15 + this.rnd() * 0.08);
            add(fx2, h - this.rnd() * 0.2, fy2, 0.9, 1.2);
          }
        }
      }
      // Neck.
      for (let i = 0; i < 8; i++) {
        const [x, y] = at(tilt * (i / 8), 0);
        add(x, 1.95 + (i / 8) * 0.14, y, 0.8, 1.3);
      }
      this.eyes(at, headH + 0.02, tilt, 0.05, birth, life);
    } else {
      // Listener: a low swollen body, eight jointed legs and a ring of a mouth turned at you.
      for (let i = 0; i < count * 0.55; i++) {
        const a = this.rnd() * Math.PI * 2;
        const r = 0.42 * Math.sqrt(this.rnd());
        const h = 0.35 + (1 - r / 0.42) * 0.35 * this.rnd();
        const [x, y] = at(Math.cos(a) * r, Math.sin(a) * r);
        add(x, h, y, 0.6 + 0.5 * this.rnd());
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (let j = 0; j <= 10; j++) {
          const t = j / 10;
          // Up to the knee, then down to the floor.
          const reach = 0.35 + t * 0.95;
          const h = t < 0.45 ? 0.45 + t * 1.3 : 1.03 - (t - 0.45) * 1.85;
          const [x, y] = at(ca * reach, sa * reach);
          add(x, Math.max(0.02, h), y, 0.85 - t * 0.3, 1.2);
        }
      }
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const [x, y] = at(Math.cos(a) * 0.17, 0.4);
        add(x, 0.55 + Math.sin(a) * 0.17, y, 1.2, 1.5);
      }
    }
  }

  /** Two hot points that look at the player. Bright enough to bloom white-red. */
  private eyes(at: (side: number, fwd: number) => [number, number], h: number, offset: number, spread: number, birth: number, life: number): void {
    for (const side of [-1, 1]) {
      const [x, y] = at(offset + side * spread, 0.11);
      for (let i = 0; i < 2; i++) this.cloud.add(x, h, y, PALETTE.danger, 2.4, birth, life * 1.1, 2.6, SHAPE.cross);
    }
  }

  /** Exit portal: a column of light and a ring on the floor. Gold, or green on a checkpoint depth. */
  exitShape(world: World, birth: number, intensity: number, life: number, count: number): void {
    const e = world.level.exit;
    const col = world.checkpoint ? PALETTE.save : PALETTE.exit;
    for (let i = 0; i < count; i++) {
      const a = this.rnd() * Math.PI * 2;
      if (i % 3 === 0) {
        this.cloud.add(e.x + Math.cos(a) * 0.9, 0.03, e.y + Math.sin(a) * 0.9, col, intensity * 0.9, birth, life, 2.2, SHAPE.diamond);
      } else {
        const r = 0.35 + this.rnd() * 0.15;
        this.cloud.add(e.x + Math.cos(a) * r, this.rnd() * H, e.y + Math.sin(a) * r, col, intensity * (0.6 + 0.6 * this.rnd()), birth + this.rnd() * 0.08, life, 2.0, SHAPE.diamond);
      }
    }
  }

  private floorRing(x: number, y: number, radius: number, color: Rgb, intensity: number, now: number, life: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = radius * Math.sqrt(this.rnd());
      this.cloud.add(x + Math.cos(a) * r, 0.03, y + Math.sin(a) * r, color, intensity, now + r / SPEED, life, 1.1);
    }
  }

  burst(x: number, y: number, color: Rgb, now: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = this.rnd() * 0.35;
      this.cloud.add(x + Math.cos(a) * r, 0.05 + this.rnd() * 0.5, y + Math.sin(a) * r, color, 1.4, now, 0.6 + this.rnd() * 0.4, 2.2);
    }
  }

  /** Debug helper: reveal the whole level once. */
  revealAll(world: World, now: number): void {
    const lvl = world.level;
    for (let y = 0; y < lvl.h; y++)
      for (let x = 0; x < lvl.w; x++) {
        if (lvl.cells[y * lvl.w + x] !== 0) continue;
        const cs = BALANCE.world.cellSize;
        this.wave(world, { id: 0, kind: 'clap', x: (x + 0.5) * cs, y: (y + 0.5) * cs, radius: 3, source: 'world', silent: true, time: 0 }, R({ rays: 24, wallPts: 4, floorStep: 1.4, life: 8, intensity: 0.5 }), now);
      }
    this.exitShape(world, now, 1, 8, 120);
    for (const m of world.monsters) this.monsterBody(m, now, 1, 8, 90);
  }
}
