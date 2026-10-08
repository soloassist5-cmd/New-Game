import { Rng } from '../core/rng';
import { BALANCE } from './config';
import type { DepthDef } from '../content/depths';

const CELL = BALANCE.world.cellSize;

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Spawn {
  x: number; // m
  y: number; // m
}

export interface Level {
  w: number; // cells
  h: number; // cells
  /** 1 = wall, 0 = floor. Index = cy * w + cx. */
  cells: Uint8Array;
  rooms: Room[];
  start: Spawn;
  exit: Spawn;
  stalkers: Spawn[];
  listeners: Spawn[];
  stones: Spawn[];
}

export const cellCenter = (c: number): number => (c + 0.5) * CELL;
export const toCell = (m: number): number => Math.floor(m / CELL);

export function isWallCell(level: Level, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return true;
  return level.cells[cy * level.w + cx] === 1;
}

export function isWallAt(level: Level, x: number, y: number): boolean {
  return isWallCell(level, toCell(x), toCell(y));
}

/** Procedural rooms + corridors. Guaranteed connected (spanning tree), with optional loops. */
export function generateLevel(seed: string, def: DepthDef): Level {
  const rng = new Rng(seed);
  const w = def.size;
  const h = def.size;
  const cells = new Uint8Array(w * h).fill(1);
  const rooms: Room[] = [];

  const carve = (x: number, y: number): void => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) cells[y * w + x] = 0;
  };

  for (let attempt = 0; attempt < 400 && rooms.length < def.rooms; attempt++) {
    const rw = rng.int(2, 4);
    const rh = rng.int(2, 4);
    const rx = rng.int(1, w - rw - 1);
    const ry = rng.int(1, h - rh - 1);
    const overlaps = rooms.some(
      (r) => rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y,
    );
    if (overlaps) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh });
    for (let yy = ry; yy < ry + rh; yy++) for (let xx = rx; xx < rx + rw; xx++) carve(xx, yy);
  }

  const center = (r: Room): [number, number] => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)];
  const corridor = (a: Room, b: Room): void => {
    let [x, y] = center(a);
    const [tx, ty] = center(b);
    const horizontalFirst = rng.chance(0.5);
    const stepX = (): void => {
      while (x !== tx) {
        x += Math.sign(tx - x);
        carve(x, y);
      }
    };
    const stepY = (): void => {
      while (y !== ty) {
        y += Math.sign(ty - y);
        carve(x, y);
      }
    };
    if (horizontalFirst) {
      stepX();
      stepY();
    } else {
      stepY();
      stepX();
    }
  };

  // Spanning tree: connect each room to its nearest already-connected room.
  for (let i = 1; i < rooms.length; i++) {
    const [cx, cy] = center(rooms[i]);
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const [ox, oy] = center(rooms[j]);
      const d = Math.abs(ox - cx) + Math.abs(oy - cy);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    corridor(rooms[i], rooms[best]);
  }
  // Loops.
  for (let i = 0; i < rooms.length; i++) {
    if (rng.chance(def.loopChance)) {
      const j = rng.int(0, rooms.length - 1);
      if (j !== i) corridor(rooms[i], rooms[j]);
    }
  }

  const level: Level = {
    w,
    h,
    cells,
    rooms,
    start: { x: 0, y: 0 },
    exit: { x: 0, y: 0 },
    stalkers: [],
    listeners: [],
    stones: [],
  };

  const [scx, scy] = center(rooms[0]);
  level.start = { x: cellCenter(scx), y: cellCenter(scy) };
  const dist = bfsDistances(level, scx, scy);

  // Exit: the room centre farthest from the start (by path length).
  let exitRoom = rooms[0];
  let far = -1;
  for (const r of rooms) {
    const [cx, cy] = center(r);
    const d = dist[cy * w + cx];
    if (d > far) {
      far = d;
      exitRoom = r;
    }
  }
  const [ex, ey] = center(exitRoom);
  level.exit = { x: cellCenter(ex), y: cellCenter(ey) };

  // Candidate floor cells for spawns, sorted deterministically.
  const floor: Array<[number, number, number]> = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = dist[y * w + x];
      if (cells[y * w + x] === 0 && d >= 0) floor.push([x, y, d]);
    }

  const used = new Set<number>([scy * w + scx, ey * w + ex]);
  const takeCell = (minDist: number, preferRooms: boolean): Spawn | null => {
    const pool = floor.filter(([x, y, d]) => {
      if (d < minDist || used.has(y * w + x)) return false;
      if (Math.abs(x - ex) + Math.abs(y - ey) <= 1) return false;
      if (preferRooms) return rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      return true;
    });
    if (pool.length === 0) return null;
    const [x, y] = rng.pick(pool);
    used.add(y * w + x);
    return { x: cellCenter(x), y: cellCenter(y) };
  };

  const maxD = Math.max(...floor.map((f) => f[2]));
  const safe = Math.min(def.safeDistance, Math.max(2, maxD - 2));
  for (let i = 0; i < def.stalkers; i++) {
    const s = takeCell(safe, true) ?? takeCell(safe, false);
    if (s) level.stalkers.push(s);
  }
  for (let i = 0; i < def.listeners; i++) {
    const s = takeCell(Math.max(3, safe - 2), false);
    if (s) level.listeners.push(s);
  }
  for (let i = 0; i < def.stones; i++) {
    const s = takeCell(1, false);
    if (s) level.stones.push(s);
  }
  return level;
}

/** BFS path length (in cells) from (sx, sy) to every cell; -1 = unreachable. */
export function bfsDistances(level: Level, sx: number, sy: number): Int32Array {
  const { w, h } = level;
  const dist = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  if (isWallCell(level, sx, sy)) return dist;
  dist[sy * w + sx] = 0;
  queue[tail++] = sy * w + sx;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const d = dist[i] + 1;
    const visit = (j: number): void => {
      if (level.cells[j] === 0 && dist[j] < 0) {
        dist[j] = d;
        queue[tail++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  return dist;
}

/** Next cell (index) to step into on a shortest path from `from` toward `to`; -1 if none. */
export function nextStepToward(level: Level, fx: number, fy: number, tx: number, ty: number): number {
  if (fx === tx && fy === ty) return fy * level.w + fx;
  const dist = bfsDistances(level, tx, ty);
  const here = dist[fy * level.w + fx];
  if (here < 0) return -1;
  const w = level.w;
  const i = fy * w + fx;
  const options = [i - 1, i + 1, i - w, i + w];
  for (const o of options) {
    if (o < 0 || o >= dist.length) continue;
    if (dist[o] === here - 1) return o;
  }
  return -1;
}

export interface RayHit {
  dist: number; // m
  /** Wall face normal in world (x, y). */
  nx: number;
  ny: number;
  hit: boolean;
}

/** Grid DDA (Amanatides & Woo). Direction must be normalised. */
export function raycast(level: Level, ox: number, oy: number, dx: number, dy: number, maxDist: number, out: RayHit): RayHit {
  let cx = toCell(ox);
  let cy = toCell(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / Math.abs(dx)) : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? (cy + 1) * CELL - oy : oy - cy * CELL) / Math.abs(dy)) : Infinity;
  let t = 0;
  let side = 0;
  while (t <= maxDist) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
      side = 0;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
      side = 1;
    }
    if (t > maxDist) break;
    if (isWallCell(level, cx, cy)) {
      out.dist = t;
      out.hit = true;
      out.nx = side === 0 ? -stepX : 0;
      out.ny = side === 1 ? -stepY : 0;
      return out;
    }
  }
  out.dist = maxDist;
  out.hit = false;
  out.nx = 0;
  out.ny = 0;
  return out;
}

/** Number of distinct wall cells crossed by the segment a→b (sound occlusion). */
export function wallsBetween(level: Level, ax: number, ay: number, bx: number, by: number): number {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-6) return 0;
  const steps = Math.ceil(len / (CELL * 0.25));
  let count = 0;
  let lastCell = -1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = toCell(ax + (bx - ax) * t);
    const cy = toCell(ay + (by - ay) * t);
    const idx = cy * level.w + cx;
    if (idx !== lastCell && isWallCell(level, cx, cy)) count++;
    lastCell = idx;
  }
  return count;
}

export function hasLineOfSight(level: Level, ax: number, ay: number, bx: number, by: number): boolean {
  return wallsBetween(level, ax, ay, bx, by) === 0;
}
