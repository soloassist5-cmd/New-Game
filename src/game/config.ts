/**
 * Single source of balance numbers. Units are in the comments.
 * World is a 2D grid (x, y) in metres; rendering maps y -> three.js Z.
 */
export const BALANCE = {
  world: {
    cellSize: 2, // m per grid cell
    wallHeight: 3, // m (render + echo only)
    eyeHeight: 1.6, // m
  },
  player: {
    radius: 0.3, // m
    walkSpeed: 3.2, // m/s
    sneakSpeed: 1.35, // m/s
    accel: 14, // 1/s exponential smoothing rate toward target velocity
    decel: 18, // 1/s when no input
    walkStride: 0.75, // m travelled per footstep
    sneakStride: 0.6, // m
    walkStepRadius: 5.5, // m hearing/echo radius of a walking step
    sneakStepRadius: 1.6, // m
    clapRadius: 16, // m
    clapCooldown: 0.9, // s
    throwRadius: 1.5, // m (the throw itself is a quiet whoosh)
    pitchLimit: 1.35, // rad
    pickupRadius: 0.9, // m
    exitRadius: 1.0, // m
  },
  stone: {
    startCount: 2,
    maxCount: 4,
    speed: 12, // m/s horizontal
    maxRange: 14, // m
    landRadius: 11, // m sound radius on impact
  },
  sound: {
    /** Each wall cell between source and listener multiplies the effective radius. */
    wallAttenuation: 0.55,
    /** Visual wave front speed (m/s). Real sound is ~343 m/s; slowed down so the wave is readable. */
    waveSpeed: 26,
  },
  exit: {
    beaconInterval: 3.2, // s between beacon chimes (audio + small gold reveal)
  },
} as const;

export type Balance = typeof BALANCE;
