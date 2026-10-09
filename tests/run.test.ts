import { describe, expect, it } from 'vitest';
import { applyUpgrade, checkpointFromRun, createRun, rollUpgrades, runFromCheckpoint } from '../src/game/run';

describe('run & checkpoints', () => {
  it('checkpoint round-trips the run state', () => {
    const run = createRun('cp');
    applyUpgrade(run, 'soft_soles');
    run.stones = 3;
    run.totals.claps = 7;
    const cp = checkpointFromRun(run, 6);
    const back = runFromCheckpoint(JSON.parse(JSON.stringify(cp)));
    expect(back.depth).toBe(6);
    expect(back.mods.stepRadiusMul).toBeCloseTo(run.mods.stepRadiusMul);
    expect(back.taken).toEqual({ soft_soles: 1 });
    expect(back.stones).toBe(3);
    expect(back.totals.claps).toBe(7);
    expect(back.seed).toBe('cp');
  });

  it('checkpoint is a snapshot, not a live reference', () => {
    const run = createRun('cp2');
    const cp = checkpointFromRun(run, 6);
    applyUpgrade(run, 'light_feet');
    expect(cp.mods.speedMul).toBe(1);
  });

  it('upgrade offers are deterministic and respect stack limits', () => {
    const a = createRun('u');
    const b = createRun('u');
    expect(rollUpgrades(a)).toEqual(rollUpgrades(b));
    applyUpgrade(a, 'double_clap');
    for (let d = 1; d < 30; d++) {
      a.depth = d;
      expect(rollUpgrades(a)).not.toContain('double_clap');
    }
  });
});
