import { BALANCE } from './config';
import { bfsDistances, cellCenter, isWallCell, toCell, wallsBetween } from './level';
import { moveCircle } from './physics';
import type { Listener, Monster, SoundEvent, Stalker, World } from './types';
import { MONSTERS } from '../content/monsters';
import { emitSound } from './sound';

let nextId = 1;

export function createStalker(x: number, y: number, threat = 1): Stalker {
  const base = MONSTERS.stalker;
  return {
    id: nextId++,
    kind: 'stalker',
    def: threat === 1 ? base : { ...base, hearing: base.hearing * threat, huntSpeed: base.huntSpeed * (1 + (threat - 1) * 0.4), investigateSpeed: base.investigateSpeed * (1 + (threat - 1) * 0.5) },
    state: 'idle',
    x,
    y,
    prevX: x,
    prevY: y,
    homeX: x,
    homeY: y,
    targetX: x,
    targetY: y,
    timer: 1,
    stepAcc: 0,
    field: null,
    fieldCell: -1,
    growlT: 0,
  };
}

export function createListener(x: number, y: number, phase: number, threat = 1): Listener {
  const def = threat === 1 ? MONSTERS.listener : { ...MONSTERS.listener, hearing: MONSTERS.listener.hearing * threat };
  return {
    id: nextId++,
    kind: 'listener',
    def,
    state: 'idle',
    x,
    y,
    prevX: x,
    prevY: y,
    homeX: x,
    homeY: y,
    targetX: x,
    targetY: y,
    timer: 0,
    stepAcc: 0,
    field: null,
    fieldCell: -1,
    breathT: def.breathMin + phase * (def.breathMax - def.breathMin),
    heardSteps: [],
  };
}

/** Resets ids so identical seeds produce identical ids (determinism across runs in one process). */
export function resetMonsterIds(): void {
  nextId = 1;
}

/** Effective hearing check: radius shrinks per wall in between. Returns distance or -1 if not heard. */
export function hears(world: World, m: Monster, s: SoundEvent): number {
  const d = Math.hypot(s.x - m.x, s.y - m.y);
  const base = s.radius * m.def.hearing;
  if (d > base) return -1;
  const walls = wallsBetween(world.level, m.x, m.y, s.x, s.y);
  const eff = base * Math.pow(BALANCE.sound.wallAttenuation, walls);
  return d <= eff ? d : -1;
}

function stalkerHears(world: World, m: Stalker, s: SoundEvent): void {
  if (s.silent) return;
  if (s.source === 'monster' && s.kind !== 'scream') return;
  if (m.state === 'notice' && s.source === 'player') return; // startled: deaf to the player for a moment, a stone still distracts it
  const d = hears(world, m, s);
  if (d < 0) return;
  const reff = s.radius * m.def.hearing;
  const close = s.source === 'player' && d <= reff * m.def.huntFraction;
  m.targetX = s.x;
  m.targetY = s.y;
  m.field = null;
  m.state = close || (m.state === 'hunt' && s.source === 'player') ? 'hunt' : 'investigate';
  world.events.push({ type: 'heard', monsterId: m.id, kind: 'stalker', x: s.x, y: s.y, alarmed: m.state === 'hunt' });
}

function listenerHears(world: World, m: Listener, s: SoundEvent): void {
  if (s.silent || s.source === 'monster') return;
  if (m.state !== 'idle') return;
  const d = hears(world, m, s);
  if (d < 0) return;
  if (s.kind === 'step' || s.kind === 'sneakStep' || s.kind === 'sprintStep') {
    m.heardSteps.push(world.time);
    while (m.heardSteps.length && world.time - m.heardSteps[0] > m.def.rhythmWindow) m.heardSteps.shift();
    if (m.heardSteps.length < m.def.rhythmSteps) return;
  }
  m.heardSteps.length = 0;
  m.state = 'windup';
  m.timer = m.def.windup;
  m.targetX = s.x;
  m.targetY = s.y;
  emitSound(world, { kind: 'scream', x: m.x, y: m.y, radius: m.def.screamRadius, source: 'monster', monsterId: m.id, silent: false });
  world.events.push({ type: 'heard', monsterId: m.id, kind: 'listener', x: s.x, y: s.y, alarmed: true });
}

export function monsterHear(world: World, m: Monster, s: SoundEvent): void {
  if (m.kind === 'stalker') stalkerHears(world, m, s);
  else listenerHears(world, m, s);
}

/** Moves along the BFS field toward (targetX, targetY). Returns true when arrived. */
function pathMove(world: World, m: Monster, speed: number, dt: number): boolean {
  const level = world.level;
  const tcx = toCell(m.targetX);
  const tcy = toCell(m.targetY);
  const tCell = tcy * level.w + tcx;
  const mcx = toCell(m.x);
  const mcy = toCell(m.y);
  let gx = m.targetX;
  let gy = m.targetY;
  if (mcx !== tcx || mcy !== tcy) {
    if (!m.field || m.fieldCell !== tCell) {
      m.field = isWallCell(level, tcx, tcy) ? null : bfsDistances(level, tcx, tcy);
      m.fieldCell = tCell;
    }
    const f = m.field;
    if (!f) return true;
    const here = f[mcy * level.w + mcx];
    if (here < 0) return true;
    let best = -1;
    const w = level.w;
    const i = mcy * w + mcx;
    const opts = [i - 1, i + 1, i - w, i + w];
    for (const o of opts) if (o >= 0 && o < f.length && f[o] >= 0 && f[o] < here) best = o;
    if (best < 0) return true;
    gx = cellCenter(best % w);
    gy = cellCenter(Math.floor(best / w));
  }
  const dx = gx - m.x;
  const dy = gy - m.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return mcx === tcx && mcy === tcy;
  const step = Math.min(d, speed * dt);
  const moved = moveCircle(level, m, (dx / d) * step, (dy / d) * step, m.def.radius);
  accumulateSteps(world, m, moved);
  const toTarget = Math.hypot(m.targetX - m.x, m.targetY - m.y);
  return toTarget < 0.3 || (moved < 1e-4 && mcx === tcx && mcy === tcy);
}

function accumulateSteps(world: World, m: Monster, moved: number): void {
  if (m.kind !== 'stalker') return;
  m.stepAcc += moved;
  if (m.stepAcc >= m.def.stride) {
    m.stepAcc -= m.def.stride;
    emitSound(world, { kind: 'monsterStep', x: m.x, y: m.y, radius: m.def.stepRadius, source: 'monster', monsterId: m.id, silent: true });
  }
}

function pickWanderTarget(world: World, m: Stalker): void {
  const level = world.level;
  const cx = toCell(m.x);
  const cy = toCell(m.y);
  for (let tries = 0; tries < 20; tries++) {
    const tx = cx + world.rng.int(-6, 6);
    const ty = cy + world.rng.int(-6, 6);
    if (!isWallCell(level, tx, ty)) {
      m.targetX = cellCenter(tx);
      m.targetY = cellCenter(ty);
      m.field = null;
      return;
    }
  }
  m.targetX = m.homeX;
  m.targetY = m.homeY;
}

function updateStalker(world: World, m: Stalker, dt: number): void {
  const d = m.def;
  switch (m.state) {
    case 'idle':
      m.timer -= dt;
      if (m.timer <= 0) {
        pickWanderTarget(world, m);
        m.state = 'wander';
      }
      break;
    case 'wander':
      if (pathMove(world, m, d.wanderSpeed, dt)) {
        m.state = 'idle';
        m.timer = world.rng.range(1, 3);
      }
      break;
    case 'investigate':
    case 'hunt': {
      const speed = m.state === 'hunt' ? d.huntSpeed : d.investigateSpeed;
      if (m.state === 'hunt') {
        m.growlT -= dt;
        if (m.growlT <= 0) {
          m.growlT = d.growlInterval;
          emitSound(world, { kind: 'growl', x: m.x, y: m.y, radius: 4, source: 'monster', monsterId: m.id, silent: true });
        }
      }
      if (pathMove(world, m, speed, dt)) {
        m.state = 'linger';
        m.timer = d.lingerTime;
      }
      break;
    }
    case 'linger':
      m.timer -= dt;
      if (m.timer <= 0) {
        m.state = 'idle';
        m.timer = 0.5;
      }
      break;
    case 'notice':
      // Startled: stands still, then charges where the player is *now*.
      m.timer -= dt;
      if (m.timer <= 0) {
        m.state = 'hunt';
        m.targetX = world.player.x;
        m.targetY = world.player.y;
        m.field = null;
        m.growlT = 0;
      }
      break;
  }
}

/** Whether contact with this monster right now is lethal. Unaware monsters notice you first. */
export function isAware(m: Monster): boolean {
  if (m.kind === 'stalker') return m.state === 'investigate' || m.state === 'hunt' || m.state === 'linger';
  return m.state === 'lunge';
}

/**
 * Proximity check, called once per tick after movement.
 * Returns true if the player dies. Unaware monsters within reach get startled instead.
 */
export function proximity(world: World, m: Monster): boolean {
  const p = world.player;
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  if (isAware(m)) return d <= m.def.killRadius;
  if (m.kind === 'stalker' && (m.state === 'idle' || m.state === 'wander') && d <= m.def.noticeRadius) {
    m.state = 'notice';
    m.timer = m.def.noticeTime;
    emitSound(world, { kind: 'growl', x: m.x, y: m.y, radius: 4, source: 'monster', monsterId: m.id, silent: true });
    world.events.push({ type: 'noticed', monsterId: m.id, kind: 'stalker', x: m.x, y: m.y });
  } else if (m.kind === 'listener' && m.state === 'idle' && d <= m.def.killRadius + 0.6) {
    m.state = 'windup';
    m.timer = m.def.windup;
    m.targetX = p.x;
    m.targetY = p.y;
    emitSound(world, { kind: 'scream', x: m.x, y: m.y, radius: m.def.screamRadius, source: 'monster', monsterId: m.id, silent: false });
    world.events.push({ type: 'noticed', monsterId: m.id, kind: 'listener', x: m.x, y: m.y });
  }
  return false;
}

function updateListener(world: World, m: Listener, dt: number): void {
  const d = m.def;
  switch (m.state) {
    case 'idle':
      m.breathT -= dt;
      if (m.breathT <= 0) {
        m.breathT = world.rng.range(d.breathMin, d.breathMax);
        emitSound(world, { kind: 'breath', x: m.x, y: m.y, radius: d.breathRadius, source: 'monster', monsterId: m.id, silent: true });
      }
      break;
    case 'windup':
      m.timer -= dt;
      if (m.timer <= 0) {
        m.state = 'lunge';
        m.timer = d.lungeTime;
      }
      break;
    case 'lunge': {
      m.timer -= dt;
      const dx = m.targetX - m.x;
      const dy = m.targetY - m.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.3 || m.timer <= 0) {
        m.state = 'return';
        m.targetX = m.homeX;
        m.targetY = m.homeY;
        m.field = null;
        break;
      }
      const step = Math.min(dist, d.lungeSpeed * dt);
      const moved = moveCircle(world.level, m, (dx / dist) * step, (dy / dist) * step, d.radius);
      if (moved < step * 0.2) m.timer = Math.min(m.timer, 0.15); // blocked — give up soon
      break;
    }
    case 'return':
      if (pathMove(world, m, d.returnSpeed, dt)) m.state = 'idle';
      break;
  }
}

export function updateMonster(world: World, m: Monster, dt: number): void {
  m.prevX = m.x;
  m.prevY = m.y;
  if (m.kind === 'stalker') updateStalker(world, m, dt);
  else updateListener(world, m, dt);
}

/** 0..1 how threatening the monster currently is (for music, vignette, heartbeat). */
export function monsterThreat(world: World, m: Monster): number {
  const d = Math.hypot(world.player.x - m.x, world.player.y - m.y);
  const active =
    (m.kind === 'stalker' && (m.state === 'hunt' || m.state === 'investigate')) ||
    (m.kind === 'listener' && (m.state === 'windup' || m.state === 'lunge'));
  const base = active ? 1 : 0.35;
  return base * Math.max(0, 1 - d / 14);
}
