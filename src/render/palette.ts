/**
 * Palette — every colour has exactly one meaning (see docs/style-guide.md). Colour never lies.
 * Values are linear-ish RGB 0..1 for shaders; CSS mirrors live in src/ui/style.css.
 */
export const PALETTE = {
  world: [0.31, 0.76, 0.97], // #4FC3F7 — walls revealed by sound; "you" (your own steps)
  floor: [0.16, 0.5, 0.69], // #2A7FB0 — floor/ceiling, dimmer so walls read first
  danger: [1.0, 0.23, 0.23], // #FF3B3B — monsters, only monsters
  exit: [1.0, 0.79, 0.3], // #FFC94D — the way out
  pickup: [0.7, 0.53, 1.0], // #B388FF — interactive things (stones)
  white: [0.91, 0.95, 0.97], // #E8F1F8 — UI text, impact sparks
} as const;

export type Rgb = readonly [number, number, number];

/** Shapes used in the point shader. Monsters use a cross in colour-blind mode. */
export const SHAPE = { dot: 0, cross: 1, diamond: 2, ring: 3 } as const;
