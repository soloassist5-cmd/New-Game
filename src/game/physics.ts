import { isWallAt, type Level } from './level';

/** True if a circle of radius r centred at (x, y) overlaps any wall cell (checked at 8 rim points). */
export function circleHitsWall(level: Level, x: number, y: number, r: number): boolean {
  const d = r * 0.7071;
  return (
    isWallAt(level, x + r, y) ||
    isWallAt(level, x - r, y) ||
    isWallAt(level, x, y + r) ||
    isWallAt(level, x, y - r) ||
    isWallAt(level, x + d, y + d) ||
    isWallAt(level, x - d, y + d) ||
    isWallAt(level, x + d, y - d) ||
    isWallAt(level, x - d, y - d)
  );
}

/**
 * Axis-separated move with sliding. Large moves are sub-stepped so nothing tunnels.
 * Returns the distance actually travelled.
 */
export function moveCircle(level: Level, body: { x: number; y: number }, dx: number, dy: number, r: number): number {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;
  const ox = body.x;
  const oy = body.y;
  for (let i = 0; i < steps; i++) {
    if (!circleHitsWall(level, body.x + sx, body.y, r)) body.x += sx;
    if (!circleHitsWall(level, body.x, body.y + sy, r)) body.y += sy;
  }
  return Math.hypot(body.x - ox, body.y - oy);
}
