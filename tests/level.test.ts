import { describe, expect, it } from 'vitest';
import { bfsDistances, generateLevel, raycast, toCell, wallsBetween, type RayHit } from '../src/game/level';
import { depthDef } from '../src/content/depths';

describe('level generation', () => {
  it('is deterministic for the same seed', () => {
    const a = generateLevel('abc#3', depthDef(3));
    const b = generateLevel('abc#3', depthDef(3));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.exit).toEqual(b.exit);
    expect(a.stalkers).toEqual(b.stalkers);
  });

  it('every exit, monster and stone is reachable on 600 seeds across depths', () => {
    for (let depth = 1; depth <= 6; depth++) {
      for (let i = 0; i < 100; i++) {
        const lvl = generateLevel(`seed${i}#${depth}`, depthDef(depth));
        const dist = bfsDistances(lvl, toCell(lvl.start.x), toCell(lvl.start.y));
        const reach = (p: { x: number; y: number }): boolean => dist[toCell(p.y) * lvl.w + toCell(p.x)] >= 0;
        expect(reach(lvl.exit)).toBe(true);
        for (const s of [...lvl.stalkers, ...lvl.listeners, ...lvl.stones]) expect(reach(s)).toBe(true);
        expect(lvl.stalkers.length).toBe(depthDef(depth).stalkers);
      }
    }
  });

  it('keeps the exit away from the start', () => {
    for (let i = 0; i < 100; i++) {
      const lvl = generateLevel(`far${i}#2`, depthDef(2));
      expect(Math.hypot(lvl.exit.x - lvl.start.x, lvl.exit.y - lvl.start.y)).toBeGreaterThan(6);
    }
  });

  it('spawns stalkers at a safe path distance from the start', () => {
    for (let i = 0; i < 100; i++) {
      const lvl = generateLevel(`safe${i}#2`, depthDef(2));
      const dist = bfsDistances(lvl, toCell(lvl.start.x), toCell(lvl.start.y));
      for (const s of lvl.stalkers) expect(dist[toCell(s.y) * lvl.w + toCell(s.x)]).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('raycast and occlusion', () => {
  const lvl = generateLevel('ray#1', depthDef(1));

  it('hits the border walls within the map', () => {
    const out: RayHit = { dist: 0, nx: 0, ny: 0, hit: false };
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      raycast(lvl, lvl.start.x, lvl.start.y, Math.cos(ang), Math.sin(ang), 100, out);
      expect(out.hit).toBe(true);
      expect(out.dist).toBeGreaterThan(0);
      expect(out.dist).toBeLessThan(lvl.w * 2 * 1.5);
      expect(Math.abs(out.nx) + Math.abs(out.ny)).toBe(1);
    }
  });

  it('counts walls between points', () => {
    expect(wallsBetween(lvl, lvl.start.x, lvl.start.y, lvl.start.x, lvl.start.y)).toBe(0);
    expect(wallsBetween(lvl, 1, 1, lvl.start.x, lvl.start.y)).toBeGreaterThanOrEqual(0);
  });
});
