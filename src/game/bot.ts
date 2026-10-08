import { wrapAngle } from '../core/math';
import { bfsDistances, cellCenter, toCell } from './level';
import { EMPTY_COMMAND, type PlayerCommand, type World } from './types';

/**
 * Headless player for balance simulations. It "knows" the map (BFS to the exit) and plays
 * a cautious human-like policy: sneak when something is near, throw a stone away when hunted,
 * clap occasionally when it feels safe. Used by tests/balance.test.ts; never shipped to players' logic.
 */
export interface BotMemory {
  field: Int32Array | null;
  lastClap: number;
  pendingThrow: boolean;
}

export const newBotMemory = (): BotMemory => ({ field: null, lastClap: -10, pendingThrow: false });

export function botCommand(world: World, mem: BotMemory): PlayerCommand {
  const p = world.player;
  const lvl = world.level;
  if (!mem.field) mem.field = bfsDistances(lvl, toCell(lvl.exit.x), toCell(lvl.exit.y));
  const cmd: PlayerCommand = { ...EMPTY_COMMAND };

  let nearest = Infinity;
  let hunter: { x: number; y: number } | null = null;
  for (const m of world.monsters) {
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    nearest = Math.min(nearest, d);
    if (m.kind === 'stalker' && (m.state === 'hunt' || m.state === 'notice') && d < 6) hunter = m;
  }

  if (mem.pendingThrow) {
    mem.pendingThrow = false;
    cmd.throw = true;
    return cmd;
  }
  if (hunter && p.stones > 0) {
    // Turn away from the hunter, throw next tick.
    const away = Math.atan2(p.y - hunter.y, p.x - hunter.x) + Math.PI * 0.5;
    cmd.yawDelta = wrapAngle(away - p.yaw);
    mem.pendingThrow = true;
    return cmd;
  }

  // A stalker is closing in (heard us, or wandering close — a human would hear its steps): slip away quietly.
  for (const m of world.monsters) {
    if (m.kind !== 'stalker') continue;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    const toTarget = Math.hypot(m.targetX - p.x, m.targetY - p.y);
    const threatening =
      ((m.state === 'investigate' || m.state === 'hunt') && d < 9 && toTarget < 2.5) ||
      ((m.state === 'wander' || m.state === 'idle') && d < 4.5);
    if (!threatening) continue;
    const away = Math.atan2(p.y - m.y, p.x - m.x);
    let bestYaw = away;
    let bestFree = -1;
    for (const off of [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const a = away + off;
      let free = 0;
      while (free < 4 && lvl.cells[toCell(p.y + Math.sin(a) * free) * lvl.w + toCell(p.x + Math.cos(a) * free)] === 0) free += 0.5;
      if (free > bestFree) {
        bestFree = free;
        bestYaw = a;
      }
    }
    cmd.yawDelta = wrapAngle(bestYaw - p.yaw);
    cmd.forward = 1;
    cmd.sneak = true;
    return cmd;
  }

  // Path to exit.
  const w = lvl.w;
  const cx = toCell(p.x);
  const cy = toCell(p.y);
  const f = mem.field;
  const here = f[cy * w + cx];
  let gx = lvl.exit.x;
  let gy = lvl.exit.y;
  if (here > 0) {
    const i = cy * w + cx;
    for (const o of [i - 1, i + 1, i - w, i + w]) {
      if (f[o] >= 0 && f[o] < here) {
        gx = cellCenter(o % w);
        gy = cellCenter(Math.floor(o / w));
      }
    }
  }
  const desired = Math.atan2(gy - p.y, gx - p.x);
  cmd.yawDelta = wrapAngle(desired - p.yaw);
  cmd.forward = 1;
  cmd.sneak = nearest < 7;

  if (nearest > 11 && world.time - mem.lastClap > 8 && p.clapCd <= 0) {
    mem.lastClap = world.time;
    cmd.clap = true;
  }
  return cmd;
}
