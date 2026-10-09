import { describe, expect, it } from 'vitest';
import { PointCloud } from '../src/render/pointcloud';
import { EchoPainter } from '../src/render/echo';
import { createWorld, step } from '../src/game/sim';
import { EMPTY_COMMAND } from '../src/game/types';
import { SIM_DT } from '../src/core/loop';

/** CPU budgets that can be measured without a GPU. Generous limits: CI machines vary. */
describe('CPU cost', () => {
  it('painting a clap echo stays well under one frame', () => {
    const w = createWorld({ seed: 'perf', depth: 6 });
    const cloud = new PointCloud();
    const echo = new EchoPainter(cloud);
    const s = { id: 1, kind: 'clap' as const, x: w.player.x, y: w.player.y, radius: 16, source: 'player' as const, silent: false, time: 0 };
    for (let i = 0; i < 5; i++) echo.paint(w, s, i); // warm-up
    const n = 40;
    const before = cloud.written;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) echo.paint(w, s, i);
    const ms = (performance.now() - t0) / n;
    const pts = (cloud.written - before) / n;
    if (process.env.SIM_REPORT) console.log(`clap paint: ${ms.toFixed(2)} ms, ${pts.toFixed(0)} points`);
    expect(ms).toBeLessThan(6);
    expect(pts).toBeLessThan(20000);
  });

  it('a simulation tick at depth 8 costs well under 4 ms', () => {
    const w = createWorld({ seed: 'perf', depth: 8 });
    for (let i = 0; i < 60; i++) step(w, { ...EMPTY_COMMAND, forward: 1 }, SIM_DT);
    const n = 600;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step(w, { ...EMPTY_COMMAND, forward: 1, clap: i % 60 === 0, yawDelta: 0.01 }, SIM_DT);
    const ms = (performance.now() - t0) / n;
    if (process.env.SIM_REPORT) console.log(`sim tick: ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });
});
