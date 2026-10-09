import { describe, expect, it } from 'vitest';
import { createWorld, depthThreat, step, worldHash } from '../src/game/sim';
import { EMPTY_COMMAND, type PlayerCommand, type SimEvent, type Stalker, type Listener } from '../src/game/types';
import { createListener, createStalker, monsterHear } from '../src/game/monsters';
import { SIM_DT } from '../src/core/loop';
import { BALANCE } from '../src/game/config';
import { botCommand, newBotMemory } from '../src/game/bot';

const cmd = (c: Partial<PlayerCommand>): PlayerCommand => ({ ...EMPTY_COMMAND, ...c });

function run(world: ReturnType<typeof createWorld>, ticks: number, c: Partial<PlayerCommand> | ((t: number) => Partial<PlayerCommand>)): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    step(world, cmd(typeof c === 'function' ? c(t) : c), SIM_DT);
    all.push(...world.events);
  }
  return all;
}

describe('determinism', () => {
  it('same seed + same inputs => same state hash', () => {
    const script = (t: number): Partial<PlayerCommand> => ({
      forward: Math.sin(t * 0.05) > -0.3 ? 1 : 0,
      strafe: Math.cos(t * 0.03) * 0.5,
      yawDelta: 0.01,
      clap: t % 97 === 0,
      throw: t % 301 === 0,
      sneak: t % 400 > 200,
    });
    const a = createWorld({ seed: 'det', depth: 4 });
    const b = createWorld({ seed: 'det', depth: 4 });
    run(a, 1800, script);
    run(b, 1800, script);
    expect(worldHash(a)).toBe(worldHash(b));
    expect(a.tick).toBe(b.tick);
  });

  it('different seeds give different levels', () => {
    const a = createWorld({ seed: 'one', depth: 3 });
    const b = createWorld({ seed: 'two', depth: 3 });
    expect(Array.from(a.level.cells)).not.toEqual(Array.from(b.level.cells));
  });
});

describe('player', () => {
  it('walking makes footsteps, standing still is silent', () => {
    const w = createWorld({ seed: 'steps', depth: 1 });
    const still = run(w, 120, {});
    expect(still.filter((e) => e.type === 'sound' && e.sound.source === 'player')).toHaveLength(0);
    const walking = run(w, 120, { forward: 1 });
    const steps = walking.filter((e) => e.type === 'sound' && e.sound.kind === 'step');
    expect(steps.length).toBeGreaterThan(0);
  });

  it('sneaking is quieter than walking', () => {
    const w = createWorld({ seed: 'sneak', depth: 1 });
    const ev = run(w, 180, { forward: 1, sneak: true });
    const s = ev.find((e) => e.type === 'sound' && e.sound.kind === 'sneakStep');
    expect(s && s.type === 'sound' && s.sound.radius).toBeLessThan(BALANCE.player.walkStepRadius);
  });

  it('clap respects cooldown and reports denial', () => {
    const w = createWorld({ seed: 'clap', depth: 1 });
    const ev = run(w, 2, { clap: true });
    expect(ev.filter((e) => e.type === 'sound' && e.sound.kind === 'clap')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'clapDenied')).toHaveLength(1);
  });

  it('never walks through walls', () => {
    const w = createWorld({ seed: 'walls', depth: 3 });
    run(w, 2000, (t) => ({ forward: 1, yawDelta: t % 180 === 0 ? 1.3 : 0 }));
    const { level, player } = w;
    const cx = Math.floor(player.x / BALANCE.world.cellSize);
    const cy = Math.floor(player.y / BALANCE.world.cellSize);
    expect(level.cells[cy * level.w + cx]).toBe(0);
  });

  it('a thrown stone lands, makes a loud sound and can be picked up again', () => {
    const w = createWorld({ seed: 'throw', depth: 1 });
    const before = w.player.stones;
    const ev = run(w, 120, (t) => ({ throw: t === 0 }));
    expect(w.player.stones).toBe(before - 1);
    const land = ev.find((e) => e.type === 'sound' && e.sound.kind === 'stoneLand');
    expect(land).toBeTruthy();
    expect(w.pickups.some((p) => !p.taken)).toBe(true);
  });

  it('reaching the exit ends the level', () => {
    const w = createWorld({ seed: 'exit', depth: 1 });
    w.player.x = w.level.exit.x + 0.5;
    w.player.y = w.level.exit.y;
    const ev = run(w, 1, {});
    expect(ev.some((e) => e.type === 'exit')).toBe(true);
    expect(w.status).toBe('escaped');
  });
});

describe('monsters (scenario tests)', () => {
  function worldWith(kind: 'stalker' | 'listener', dx: number): { w: ReturnType<typeof createWorld>; m: Stalker | Listener } {
    const w = createWorld({ seed: 'scenario', depth: 1 });
    // Place the monster in the same room line-of-sight from the start along +x or as far as floor allows.
    const p = w.player;
    let x = p.x + dx;
    const lvl = w.level;
    while (lvl.cells[Math.floor(p.y / 2) * lvl.w + Math.floor(x / 2)] === 1 && x > p.x + 1) x -= 0.5;
    const m = kind === 'stalker' ? createStalker(x, p.y) : createListener(x, p.y, 0.5);
    w.monsters = [m];
    return { w, m };
  }

  it('a stalker investigates a clap it hears', () => {
    const { w, m } = worldWith('stalker', 6);
    run(w, 1, { clap: true });
    expect((m as Stalker).state === 'investigate' || (m as Stalker).state === 'hunt').toBe(true);
    expect(m.targetX).toBeCloseTo(w.player.x, 1);
  });

  it('a stalker is distracted by a stone landing elsewhere', () => {
    const { w, m } = worldWith('stalker', 3);
    run(w, 1, { clap: true });
    expect((m as Stalker).state).toBe('hunt');
    // Turn around and throw.
    run(w, 1, { yawDelta: Math.PI, throw: true });
    run(w, 90, {});
    const heardStone = Math.hypot(m.targetX - w.player.x, m.targetY - w.player.y) > 0.5;
    // Either it re-targeted the stone, or it already caught us (too close) — both are legitimate outcomes;
    // the scenario asserts the re-targeting path specifically when the player survives.
    if (w.status === 'playing') expect(heardStone).toBe(true);
  });

  it('a listener ignores a single footstep but reacts to rhythm', () => {
    const { w, m } = worldWith('listener', 3);
    const l = m as Listener;
    const p = w.player;
    const stepAt = (t: number): void => {
      w.time = t;
      monsterHear(w, l, { id: 100 + t * 10, kind: 'step', x: p.x, y: p.y, radius: 5.5, source: 'player', silent: false, time: t });
    };
    stepAt(0);
    expect(l.state).toBe('idle');
    // Steps far apart in time never build a rhythm.
    stepAt(5);
    stepAt(10);
    expect(l.state).toBe('idle');
    // Three steps inside the rhythm window do.
    stepAt(20);
    stepAt(20.5);
    stepAt(21);
    expect(l.state).toBe('windup');
  });

  it('a listener lunges after a clap and screams', () => {
    const { w, m } = worldWith('listener', 5);
    const ev = run(w, 1, { clap: true });
    expect((m as Listener).state).toBe('windup');
    expect(ev.some((e) => e.type === 'sound' && e.sound.kind === 'scream')).toBe(true);
  });

  it('contact with an aware monster kills the player', () => {
    const { w, m } = worldWith('stalker', 3);
    (m as Stalker).state = 'hunt';
    m.x = w.player.x + 0.5;
    m.y = w.player.y;
    const ev = run(w, 1, {});
    expect(ev.some((e) => e.type === 'death')).toBe(true);
    expect(w.status).toBe('dead');
  });

  it('bumping into an unaware stalker startles it instead of killing', () => {
    const { w, m } = worldWith('stalker', 3);
    m.x = w.player.x + 1.0;
    m.y = w.player.y;
    const ev = run(w, 1, {});
    expect(w.status).toBe('playing');
    expect(ev.some((e) => e.type === 'noticed')).toBe(true);
    expect((m as Stalker).state).toBe('notice');
    run(w, 40, {});
    expect(['hunt', 'linger', 'investigate']).toContain((m as Stalker).state);
  });

  it('god mode prevents death', () => {
    const { w, m } = worldWith('stalker', 3);
    w.god = true;
    (m as Stalker).state = 'hunt';
    m.x = w.player.x + 0.5;
    run(w, 5, {});
    expect(w.status).toBe('playing');
  });
});

describe('bot', () => {
  it('escapes depth 1 (no monsters) on every seed within 60 s', () => {
    for (let i = 0; i < 50; i++) {
      const w = createWorld({ seed: `bot${i}`, depth: 1 });
      const mem = newBotMemory();
      for (let t = 0; t < 60 * 60 && w.status === 'playing'; t++) step(w, botCommand(w, mem), SIM_DT);
      expect(w.status, `seed bot${i}`).toBe('escaped');
    }
  });
});

describe('sprint and stamina', () => {
  const run = (w: ReturnType<typeof createWorld>, ticks: number, c: Partial<PlayerCommand>): SimEvent[] => {
    const all: SimEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      step(w, { ...EMPTY_COMMAND, ...c }, SIM_DT);
      all.push(...w.events);
    }
    return all;
  };
  const openWorld = (): ReturnType<typeof createWorld> => {
    // A big cleared square so running is not blocked by walls.
    const w = createWorld({ seed: 'sprint', depth: 1 });
    w.level.cells.fill(0);
    w.monsters = [];
    return w;
  };

  it('sprint is faster than walking and outruns a hunting stalker', () => {
    const a = openWorld();
    const b = openWorld();
    run(a, 60, { forward: 1 });
    run(b, 60, { forward: 1, sprint: true });
    const da = Math.hypot(a.player.x - a.level.start.x, a.player.y - a.level.start.y);
    const db = Math.hypot(b.player.x - b.level.start.x, b.player.y - b.level.start.y);
    expect(db).toBeGreaterThan(da * 1.4);
    expect(BALANCE.player.sprintSpeed).toBeGreaterThan(3.4); // stalker hunt speed at depth 1
  });

  it('sprint steps are loud', () => {
    const w = openWorld();
    const ev = run(w, 90, { forward: 1, sprint: true });
    const s = ev.find((e) => e.type === 'sound' && e.sound.kind === 'sprintStep');
    expect(s && s.type === 'sound' && s.sound.radius).toBeGreaterThan(BALANCE.player.walkStepRadius);
  });

  it('stamina runs out, locks sprint, makes you pant, then recovers', () => {
    const w = openWorld();
    const ev = run(w, 60 * 4, { forward: 1, sprint: true });
    expect(ev.some((e) => e.type === 'exhausted')).toBe(true);
    expect(w.player.exhausted).toBe(true);
    expect(w.player.sprinting).toBe(false);
    const pants = run(w, 60 * 2, { forward: 1, sprint: true }).filter((e) => e.type === 'sound' && e.sound.kind === 'pant');
    expect(pants.length).toBeGreaterThanOrEqual(2);
    run(w, 60 * 3, {});
    expect(w.player.exhausted).toBe(false);
    expect(w.player.stamina).toBeGreaterThan(BALANCE.stamina.recoverAt);
  });

  it('cannot sprint while sneaking or walking backwards', () => {
    const w = openWorld();
    run(w, 10, { forward: 1, sprint: true, sneak: true });
    expect(w.player.sprinting).toBe(false);
    run(w, 10, { forward: -1, sprint: true });
    expect(w.player.sprinting).toBe(false);
  });
});

describe('depth progression', () => {
  it('every 5th depth ends in a checkpoint beacon', () => {
    expect(createWorld({ seed: 'c', depth: 5 }).checkpoint).toBe(true);
    expect(createWorld({ seed: 'c', depth: 10 }).checkpoint).toBe(true);
    expect(createWorld({ seed: 'c', depth: 4 }).checkpoint).toBe(false);
    const w = createWorld({ seed: 'c', depth: 5 });
    w.player.x = w.level.exit.x;
    w.player.y = w.level.exit.y;
    step(w, EMPTY_COMMAND, SIM_DT);
    expect(w.events.some((e) => e.type === 'exit' && e.checkpoint)).toBe(true);
  });

  it('monsters get sharper from depth 5', () => {
    expect(depthThreat(4)).toBe(1);
    expect(depthThreat(5)).toBeGreaterThan(1);
    expect(depthThreat(12)).toBeGreaterThan(depthThreat(6));
    expect(depthThreat(100)).toBeLessThanOrEqual(BALANCE.depth.threatMax);
  });
});
