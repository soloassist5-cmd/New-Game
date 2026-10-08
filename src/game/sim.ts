import { Rng } from '../core/rng';
import { clamp, wrapAngle } from '../core/math';
import { BALANCE } from './config';
import { generateLevel, isWallAt, type Level } from './level';
import { moveCircle } from './physics';
import { createListener, createStalker, monsterHear, proximity, resetMonsterIds, updateMonster } from './monsters';
import { emitSound } from './sound';
import type { PlayerCommand, World } from './types';
import { depthDef } from '../content/depths';
import { BASE_MODIFIERS, type Modifiers } from '../content/upgrades';

const P = BALANCE.player;

export interface WorldOptions {
  seed: string;
  depth: number;
  mods?: Modifiers;
  stones?: number;
  yaw?: number;
}

export function levelSeed(runSeed: string, depth: number): string {
  return `${runSeed}#${depth}`;
}

export function createWorld(opts: WorldOptions): World {
  const seed = levelSeed(opts.seed, opts.depth);
  const level: Level = generateLevel(seed, depthDef(opts.depth));
  const rng = new Rng(`${seed}:sim`);
  resetMonsterIds();
  const monsters = [
    ...level.stalkers.map((s) => createStalker(s.x, s.y)),
    ...level.listeners.map((s, i) => createListener(s.x, s.y, (i * 0.37) % 1)),
  ];
  // Face the most open direction so the first frame looks down a corridor, not into a wall.
  let yaw = opts.yaw ?? 0;
  if (opts.yaw === undefined) {
    let best = -1;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      let free = 0;
      while (free < 12 && !isWallAt(level, level.start.x + Math.cos(a) * free, level.start.y + Math.sin(a) * free)) free += 0.5;
      if (free > best) {
        best = free;
        yaw = a;
      }
    }
  }
  return {
    level,
    depth: opts.depth,
    rng,
    tick: 0,
    time: 0,
    player: {
      x: level.start.x,
      y: level.start.y,
      prevX: level.start.x,
      prevY: level.start.y,
      yaw,
      pitch: 0,
      vx: 0,
      vy: 0,
      stones: opts.stones ?? BALANCE.stone.startCount,
      stepAcc: 0,
      clapCd: 0,
      sneaking: false,
      moving: 0,
    },
    monsters,
    projectiles: [],
    pickups: level.stones.map((s) => ({ x: s.x, y: s.y, taken: false })),
    pending: [],
    mods: { ...(opts.mods ?? BASE_MODIFIERS) },
    events: [],
    tickSounds: [],
    nextSoundId: 1,
    beaconT: 1.2,
    status: 'playing',
    god: false,
    stats: { claps: 0, throws: 0, steps: 0, time: 0 },
  };
}

export const maxStones = (w: World): number => BALANCE.stone.maxCount + w.mods.maxStonesBonus;

/** Advance the world by one fixed step. Pure function of (world, cmd) — no DOM, audio or wall clock. */
export function step(world: World, cmd: PlayerCommand, dt: number): void {
  world.events.length = 0;
  world.tickSounds.length = 0;
  if (world.status !== 'playing') return;

  const p = world.player;
  const m = world.mods;
  p.prevX = p.x;
  p.prevY = p.y;

  // Look.
  p.yaw = wrapAngle(p.yaw + cmd.yawDelta);
  p.pitch = clamp(p.pitch + cmd.pitchDelta, -P.pitchLimit, P.pitchLimit);

  // Move: exponential smoothing toward the target velocity (no ice, no snapping).
  p.sneaking = cmd.sneak;
  const fx = Math.cos(p.yaw);
  const fy = Math.sin(p.yaw);
  let ix = fx * cmd.forward - fy * cmd.strafe;
  let iy = fy * cmd.forward + fx * cmd.strafe;
  const il = Math.hypot(ix, iy);
  if (il > 1) {
    ix /= il;
    iy /= il;
  }
  const speed = (cmd.sneak ? P.sneakSpeed : P.walkSpeed) * m.speedMul;
  const rate = il > 0.01 ? P.accel : P.decel;
  const k = 1 - Math.exp(-rate * dt);
  p.vx += (ix * speed - p.vx) * k;
  p.vy += (iy * speed - p.vy) * k;
  const moved = moveCircle(world.level, p, p.vx * dt, p.vy * dt, P.radius);
  if (moved < Math.hypot(p.vx, p.vy) * dt * 0.5) {
    // Bumped into a wall — bleed velocity so we don't keep "pushing".
    p.vx = (p.x - p.prevX) / dt;
    p.vy = (p.y - p.prevY) / dt;
  }
  p.moving = Math.min(1, moved / dt / P.walkSpeed);

  // Footsteps.
  p.stepAcc += moved;
  const stride = cmd.sneak ? P.sneakStride : P.walkStride;
  if (p.stepAcc >= stride) {
    p.stepAcc -= stride;
    world.stats.steps++;
    const r = cmd.sneak ? P.sneakStepRadius * m.sneakRadiusMul * m.stepRadiusMul : P.walkStepRadius * m.stepRadiusMul;
    emitSound(world, { kind: cmd.sneak ? 'sneakStep' : 'step', x: p.x, y: p.y, radius: r, source: 'player', silent: false });
  }
  if (il < 0.01 && moved < 1e-3) p.stepAcc = Math.min(p.stepAcc, stride * 0.5);

  // Clap.
  p.clapCd = Math.max(0, p.clapCd - dt);
  if (cmd.clap) {
    if (p.clapCd <= 0) {
      p.clapCd = P.clapCooldown * m.clapCooldownMul;
      world.stats.claps++;
      const r = P.clapRadius * m.clapRadiusMul;
      emitSound(world, { kind: 'clap', x: p.x, y: p.y, radius: r, source: 'player', silent: false });
      if (m.doubleClap) {
        world.pending.push({ at: world.time + 0.55, sound: { kind: 'clapEcho', x: p.x, y: p.y, radius: r * 0.9, source: 'world', silent: true } });
      }
    } else {
      world.events.push({ type: 'clapDenied' });
    }
  }

  // Throw.
  if (cmd.throw) {
    if (p.stones > 0) {
      p.stones--;
      world.stats.throws++;
      world.projectiles.push({ x: p.x + fx * 0.4, y: p.y + fy * 0.4, dx: fx, dy: fy, travelled: 0, range: BALANCE.stone.maxRange });
      emitSound(world, { kind: 'throw', x: p.x, y: p.y, radius: P.throwRadius, source: 'player', silent: false });
    } else {
      world.events.push({ type: 'throwDenied' });
    }
  }

  // Projectiles.
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const s = world.projectiles[i];
    const stepLen = BALANCE.stone.speed * dt;
    const nx = s.x + s.dx * stepLen;
    const ny = s.y + s.dy * stepLen;
    const hitWall = isWallAt(world.level, nx, ny);
    if (!hitWall) {
      s.x = nx;
      s.y = ny;
      s.travelled += stepLen;
    }
    if (hitWall || s.travelled >= s.range) {
      world.projectiles.splice(i, 1);
      emitSound(world, {
        kind: 'stoneLand',
        x: s.x,
        y: s.y,
        radius: BALANCE.stone.landRadius * m.stoneRadiusMul,
        source: 'world',
        silent: false,
      });
      // The stone can be picked up again where it lands.
      world.pickups.push({ x: s.x, y: s.y, taken: false });
    }
  }

  // Pickups.
  for (const pk of world.pickups) {
    if (pk.taken || p.stones >= maxStones(world)) continue;
    if (Math.hypot(pk.x - p.x, pk.y - p.y) <= P.pickupRadius) {
      pk.taken = true;
      p.stones++;
      world.events.push({ type: 'pickup', x: pk.x, y: pk.y, stones: p.stones });
    }
  }

  // Delayed sounds (double clap).
  for (let i = world.pending.length - 1; i >= 0; i--) {
    if (world.pending[i].at <= world.time) {
      emitSound(world, world.pending[i].sound);
      world.pending.splice(i, 1);
    }
  }

  // Exit beacon (audio + small gold reveal; monsters ignore it).
  world.beaconT -= dt;
  if (world.beaconT <= 0) {
    world.beaconT = BALANCE.exit.beaconInterval;
    emitSound(world, { kind: 'beacon', x: world.level.exit.x, y: world.level.exit.y, radius: 1.5, source: 'world', silent: true });
  }

  // Monsters: hear first (including sounds they emit this tick, e.g. a listener's scream), then act.
  for (let i = 0; i < world.tickSounds.length; i++) {
    const s = world.tickSounds[i];
    for (const mo of world.monsters) if (mo.id !== s.monsterId) monsterHear(world, mo, s);
  }
  // Sounds produced during monster updates (steps/growls/breath) are silent; nobody needs to hear them.
  for (const mo of world.monsters) updateMonster(world, mo, dt);

  // Death.
  if (!world.god) {
    for (const mo of world.monsters) {
      if (proximity(world, mo)) {
        world.status = 'dead';
        world.events.push({ type: 'death', killerId: mo.id, kind: mo.kind, x: mo.x, y: mo.y });
        break;
      }
    }
  }

  // Exit.
  if (world.status === 'playing' && Math.hypot(world.level.exit.x - p.x, world.level.exit.y - p.y) <= P.exitRadius) {
    world.status = 'escaped';
    world.events.push({ type: 'exit', x: world.level.exit.x, y: world.level.exit.y });
  }

  world.tick++;
  world.time += dt;
  world.stats.time += dt;
}

/** Stable hash of the simulation state — used by determinism tests and replay checks. */
export function worldHash(world: World): string {
  const q = (v: number): number => Math.round(v * 1000);
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };
  mix(world.tick);
  mix(q(world.player.x));
  mix(q(world.player.y));
  mix(q(world.player.yaw));
  mix(world.player.stones);
  for (const m of world.monsters) {
    mix(q(m.x));
    mix(q(m.y));
    mix(m.state.length);
  }
  mix(world.status.length);
  return (h >>> 0).toString(16);
}
