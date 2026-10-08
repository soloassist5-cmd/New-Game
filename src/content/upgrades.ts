/** Upgrades are pure data: each one tweaks run modifiers. Text lives in i18n under `upgrade.<id>.*`. */

export interface Modifiers {
  stepRadiusMul: number;
  sneakRadiusMul: number;
  speedMul: number;
  stoneRadiusMul: number;
  maxStonesBonus: number;
  echoLifeMul: number;
  monsterRevealMul: number;
  clapCooldownMul: number;
  clapRadiusMul: number;
  doubleClap: boolean;
}

export const BASE_MODIFIERS: Modifiers = {
  stepRadiusMul: 1,
  sneakRadiusMul: 1,
  speedMul: 1,
  stoneRadiusMul: 1,
  maxStonesBonus: 0,
  echoLifeMul: 1,
  monsterRevealMul: 1,
  clapCooldownMul: 1,
  clapRadiusMul: 1,
  doubleClap: false,
};

export interface UpgradeDef {
  id: string;
  /** Icon glyph drawn in the upgrade card. */
  glyph: string;
  /** Max times it can be taken in a run. */
  stack: number;
  apply(m: Modifiers): void;
  /** Granted immediately when picked (e.g. stones). */
  stonesNow?: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'soft_soles', glyph: '◡', stack: 2, apply: (m) => (m.stepRadiusMul *= 0.72) },
  { id: 'held_breath', glyph: '◌', stack: 2, apply: (m) => (m.sneakRadiusMul *= 0.6) },
  { id: 'long_echo', glyph: '≋', stack: 2, apply: (m) => (m.echoLifeMul *= 1.5) },
  { id: 'heavy_stones', glyph: '●', stack: 2, apply: (m) => (m.stoneRadiusMul *= 1.35) },
  { id: 'deep_pockets', glyph: '+', stack: 2, stonesNow: 2, apply: (m) => (m.maxStonesBonus += 1) },
  { id: 'double_clap', glyph: '❘❘', stack: 1, apply: (m) => (m.doubleClap = true) },
  { id: 'quick_hands', glyph: '↺', stack: 2, apply: (m) => (m.clapCooldownMul *= 0.7) },
  { id: 'light_feet', glyph: '»', stack: 2, apply: (m) => (m.speedMul *= 1.12) },
  { id: 'red_memory', glyph: '✕', stack: 1, apply: (m) => (m.monsterRevealMul *= 2) },
  { id: 'focused_clap', glyph: '◎', stack: 2, apply: (m) => (m.clapRadiusMul *= 1.25) },
];

export const upgradeById = (id: string): UpgradeDef | undefined => UPGRADES.find((u) => u.id === id);
