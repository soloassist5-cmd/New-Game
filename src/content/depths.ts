/** Level parameters per depth. Depths 1–4 are hand-tuned (onboarding), deeper ones follow a formula. */

export interface DepthDef {
  size: number; // grid cells per side
  rooms: number; // target room count
  stalkers: number;
  listeners: number;
  stones: number; // pickups on the floor
  /** Extra corridors beyond the spanning tree (0..1) — loops give escape routes. */
  loopChance: number;
  /** Minimum BFS distance (cells) from start for monster spawns. */
  safeDistance: number;
}

const HAND_TUNED: DepthDef[] = [
  // 1: no monsters, short — the first exit should be found within ~30 s.
  { size: 12, rooms: 4, stalkers: 0, listeners: 0, stones: 2, loopChance: 0.2, safeDistance: 0 },
  // 2: first stalker, far away.
  { size: 16, rooms: 6, stalkers: 1, listeners: 0, stones: 3, loopChance: 0.35, safeDistance: 8 },
  // 3: a listener teaches "walk softly".
  { size: 18, rooms: 7, stalkers: 1, listeners: 1, stones: 3, loopChance: 0.35, safeDistance: 7 },
  // 4: the combination.
  { size: 20, rooms: 8, stalkers: 2, listeners: 1, stones: 4, loopChance: 0.4, safeDistance: 7 },
];

export function depthDef(depth: number): DepthDef {
  if (depth <= HAND_TUNED.length) return HAND_TUNED[Math.max(0, depth - 1)];
  const k = depth - HAND_TUNED.length;
  return {
    size: Math.min(36, 20 + 2 * k),
    rooms: Math.min(16, 8 + k),
    stalkers: Math.min(6, 2 + Math.floor(k / 2)),
    listeners: Math.min(4, 1 + Math.floor((k + 1) / 3)),
    stones: 4 + Math.floor(k / 2),
    loopChance: 0.45,
    safeDistance: 7,
  };
}
