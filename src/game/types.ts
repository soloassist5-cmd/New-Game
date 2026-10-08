import type { Rng } from '../core/rng';
import type { Level } from './level';
import type { Modifiers } from '../content/upgrades';
import type { ListenerDef, MonsterKind, StalkerDef } from '../content/monsters';

export type SoundKind =
  | 'step'
  | 'sneakStep'
  | 'clap'
  | 'clapEcho'
  | 'throw'
  | 'stoneLand'
  | 'monsterStep'
  | 'growl'
  | 'breath'
  | 'scream'
  | 'beacon';

export interface SoundEvent {
  id: number;
  kind: SoundKind;
  x: number;
  y: number;
  radius: number; // m
  source: 'player' | 'monster' | 'world';
  monsterId?: number;
  /** Visual/audio only — monsters never react. */
  silent: boolean;
  time: number; // sim seconds
}

export type SimEvent =
  | { type: 'sound'; sound: SoundEvent }
  | { type: 'heard'; monsterId: number; kind: MonsterKind; x: number; y: number; alarmed: boolean }
  | { type: 'pickup'; x: number; y: number; stones: number }
  | { type: 'clapDenied' }
  | { type: 'throwDenied' }
  | { type: 'death'; killerId: number; kind: MonsterKind; x: number; y: number }
  | { type: 'noticed'; monsterId: number; kind: MonsterKind; x: number; y: number }
  | { type: 'exit'; x: number; y: number };

export interface PlayerCommand {
  forward: number; // -1..1
  strafe: number; // -1..1 (+ = right)
  yawDelta: number; // rad
  pitchDelta: number; // rad
  sneak: boolean;
  clap: boolean; // edge
  throw: boolean; // edge
}

export const EMPTY_COMMAND: PlayerCommand = {
  forward: 0,
  strafe: 0,
  yawDelta: 0,
  pitchDelta: 0,
  sneak: false,
  clap: false,
  throw: false,
};

export interface Player {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  yaw: number; // rad; forward = (cos yaw, sin yaw)
  pitch: number;
  vx: number;
  vy: number;
  stones: number;
  stepAcc: number; // m since last footstep
  clapCd: number; // s
  sneaking: boolean;
  /** Speed 0..1 relative to walk, for head-bob. */
  moving: number;
}

export interface Projectile {
  x: number;
  y: number;
  dx: number;
  dy: number;
  travelled: number;
  range: number;
}

export interface Pickup {
  x: number;
  y: number;
  taken: boolean;
}

export type StalkerState = 'wander' | 'idle' | 'notice' | 'investigate' | 'hunt' | 'linger';
export type ListenerState = 'idle' | 'windup' | 'lunge' | 'return';

interface MonsterBase {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  timer: number;
  stepAcc: number;
  /** Cached BFS field toward target cell. */
  field: Int32Array | null;
  fieldCell: number;
}

export interface Stalker extends MonsterBase {
  kind: 'stalker';
  def: StalkerDef;
  state: StalkerState;
  growlT: number;
}

export interface Listener extends MonsterBase {
  kind: 'listener';
  def: ListenerDef;
  state: ListenerState;
  breathT: number;
  heardSteps: number[];
}

export type Monster = Stalker | Listener;

export interface PendingSound {
  at: number;
  sound: Omit<SoundEvent, 'id' | 'time'>;
}

export interface World {
  level: Level;
  depth: number;
  rng: Rng;
  tick: number;
  time: number;
  player: Player;
  monsters: Monster[];
  projectiles: Projectile[];
  pickups: Pickup[];
  pending: PendingSound[];
  mods: Modifiers;
  events: SimEvent[];
  /** Sounds emitted during the current tick (monsters process them once). */
  tickSounds: SoundEvent[];
  nextSoundId: number;
  beaconT: number;
  status: 'playing' | 'dead' | 'escaped';
  god: boolean;
  stats: { claps: number; throws: number; steps: number; time: number };
}
