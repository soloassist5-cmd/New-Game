import { Rng } from '../core/rng';
import { BALANCE } from './config';
import { createWorld } from './sim';
import type { World } from './types';
import { BASE_MODIFIERS, UPGRADES, upgradeById, type Modifiers } from '../content/upgrades';

/** A run spans several depths. Only this state survives between levels. */
export interface Run {
  seed: string;
  daily: boolean;
  depth: number;
  mods: Modifiers;
  taken: Record<string, number>;
  stones: number;
  totals: { claps: number; throws: number; steps: number; time: number };
}

export function createRun(seed: string, daily = false, startDepth = 1): Run {
  return {
    seed,
    daily,
    depth: startDepth,
    mods: { ...BASE_MODIFIERS },
    taken: {},
    stones: BALANCE.stone.startCount,
    totals: { claps: 0, throws: 0, steps: 0, time: 0 },
  };
}

export function worldForRun(run: Run): World {
  return createWorld({ seed: run.seed, depth: run.depth, mods: run.mods, stones: run.stones });
}

/** Store the results of a finished level into the run. */
export function absorbWorld(run: Run, world: World): void {
  run.stones = world.player.stones;
  run.totals.claps += world.stats.claps;
  run.totals.throws += world.stats.throws;
  run.totals.steps += world.stats.steps;
  run.totals.time += world.stats.time;
}

/** Deterministic upgrade offer for the current depth. */
export function rollUpgrades(run: Run, count = 3): string[] {
  const rng = new Rng(`${run.seed}#${run.depth}:upgrades`);
  const pool = UPGRADES.filter((u) => (run.taken[u.id] ?? 0) < u.stack).map((u) => u.id);
  return rng.shuffle(pool).slice(0, count);
}

export function applyUpgrade(run: Run, id: string): void {
  const u = upgradeById(id);
  if (!u) return;
  u.apply(run.mods);
  run.taken[id] = (run.taken[id] ?? 0) + 1;
  if (u.stonesNow) run.stones = Math.min(BALANCE.stone.maxCount + run.mods.maxStonesBonus, run.stones + u.stonesNow);
}

export function dailySeed(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `daily-${y}-${m}-${d}`;
}

export function randomSeed(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
