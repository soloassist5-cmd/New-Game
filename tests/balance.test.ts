import { describe, expect, it } from 'vitest';
import { createWorld, step } from '../src/game/sim';
import { botCommand, newBotMemory } from '../src/game/bot';
import { SIM_DT } from '../src/core/loop';

/**
 * Headless balance simulation: the bot plays N levels per depth.
 * `npm run sim` prints the report; the assertions guard against regressions in the difficulty curve.
 */
interface DepthReport {
  depth: number;
  escaped: number;
  died: number;
  timeout: number;
  avgTime: number;
  avgClaps: number;
}

function simulate(depth: number, n: number, maxSeconds = 240): DepthReport {
  let escaped = 0;
  let died = 0;
  let timeout = 0;
  let time = 0;
  let claps = 0;
  for (let i = 0; i < n; i++) {
    const w = createWorld({ seed: `sim${i}`, depth });
    const mem = newBotMemory();
    const maxTicks = maxSeconds * 60;
    while (w.status === 'playing' && w.tick < maxTicks) step(w, botCommand(w, mem), SIM_DT);
    if (w.status === 'escaped') escaped++;
    else if (w.status === 'dead') died++;
    else timeout++;
    time += w.time;
    claps += w.stats.claps;
  }
  return { depth, escaped: escaped / n, died: died / n, timeout: timeout / n, avgTime: time / n, avgClaps: claps / n };
}

describe('balance simulation', () => {
  const N = Number(process.env.SIM_N ?? 60);
  const reports = [1, 2, 3, 4, 5, 6, 8].map((d) => simulate(d, N));

  if (process.env.SIM_REPORT) {
    console.table(
      reports.map((r) => ({
        depth: r.depth,
        'escape %': (r.escaped * 100).toFixed(0),
        'death %': (r.died * 100).toFixed(0),
        'timeout %': (r.timeout * 100).toFixed(0),
        'avg time s': r.avgTime.toFixed(1),
        'avg claps': r.avgClaps.toFixed(1),
      })),
    );
  }

  it('depth 1 is always escapable', () => expect(reports[0].escaped).toBe(1));
  it('nothing gets stuck (timeouts < 5%)', () => {
    for (const r of reports) expect(r.timeout, `depth ${r.depth}`).toBeLessThan(0.05);
  });
  it('difficulty rises with depth but stays beatable', () => {
    expect(reports[1].escaped).toBeGreaterThan(0.6);
    expect(reports[6].escaped).toBeLessThan(reports[0].escaped);
    expect(reports[6].escaped).toBeGreaterThan(0.1);
  });
});
