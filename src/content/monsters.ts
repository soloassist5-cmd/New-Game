/** Declarative monster definitions. Behaviour code lives in game/monsters.ts and reads only these numbers. */

export type MonsterKind = 'stalker' | 'listener';

export interface StalkerDef {
  kind: 'stalker';
  radius: number; // m (collision)
  killRadius: number; // m
  hearing: number; // multiplier on sound radius
  wanderSpeed: number; // m/s
  investigateSpeed: number; // m/s
  huntSpeed: number; // m/s
  /** If the heard sound is closer than hearingRadius * huntFraction, the stalker sprints (hunt). */
  huntFraction: number;
  lingerTime: number; // s spent "listening" at the investigated spot
  stride: number; // m per audible footstep
  stepRadius: number; // m (only reveals the monster, other monsters ignore it)
  growlInterval: number; // s while hunting
  /** Bumping into an unaware stalker within this distance makes it notice you instead of killing outright. */
  noticeRadius: number; // m
  noticeTime: number; // s startle before it hunts
}

export interface ListenerDef {
  kind: 'listener';
  radius: number;
  killRadius: number;
  hearing: number;
  /** Footsteps only trigger it if this many are heard within rhythmWindow seconds. */
  rhythmSteps: number;
  rhythmWindow: number; // s
  windup: number; // s between hearing and lunging (the scream)
  screamRadius: number; // m — the scream is a sound other monsters hear
  lungeSpeed: number; // m/s
  lungeTime: number; // s max
  returnSpeed: number; // m/s
  breathMin: number; // s
  breathMax: number; // s
  breathRadius: number; // m
}

export type MonsterDef = StalkerDef | ListenerDef;

export const MONSTERS: { stalker: StalkerDef; listener: ListenerDef } = {
  stalker: {
    kind: 'stalker',
    radius: 0.35,
    killRadius: 0.8,
    hearing: 1.0,
    wanderSpeed: 1.1,
    investigateSpeed: 2.5,
    huntSpeed: 3.4,
    huntFraction: 0.45,
    lingerTime: 2.6,
    stride: 0.9,
    stepRadius: 2.2,
    growlInterval: 1.6,
    noticeRadius: 1.4,
    noticeTime: 0.55,
  },
  listener: {
    kind: 'listener',
    radius: 0.45,
    killRadius: 0.9,
    hearing: 1.5,
    rhythmSteps: 3,
    rhythmWindow: 2.6,
    windup: 0.55,
    screamRadius: 14,
    lungeSpeed: 6.5,
    lungeTime: 2.0,
    returnSpeed: 1.4,
    breathMin: 3.5,
    breathMax: 6,
    breathRadius: 2.4,
  },
};
