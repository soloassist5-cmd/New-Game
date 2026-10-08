import type { Lang } from '../i18n/strings';

/**
 * Versioned save with migrations. A corrupted save never breaks the game:
 * it is backed up under `<key>.corrupt` and defaults are used.
 */
export const SAVE_VERSION = 2;
const KEY = 'echo.save';

export interface Settings {
  master: number; // 0..1
  music: number;
  sfx: number;
  ui: number;
  sensitivity: number; // multiplier
  invertY: boolean;
  shake: number; // 0..1
  reduceFlashes: boolean;
  indicators: boolean;
  subtitles: boolean;
  shapes: boolean;
  uiScale: number; // 0.8..1.4
  fov: number; // degrees
  lang: Lang | null; // null = auto
}

export interface SaveData {
  version: number;
  settings: Settings;
  bindings: Record<string, string[]>;
  stats: {
    bestDepth: number;
    runs: number;
    deaths: number;
    dailyDate: string;
    dailyBest: number;
  };
  /** Onboarding flags (which hints were already learnt). */
  seen: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.7,
  sfx: 0.9,
  ui: 0.6,
  sensitivity: 1,
  invertY: false,
  shake: 1,
  reduceFlashes: false,
  indicators: true,
  subtitles: false,
  shapes: false,
  uiScale: 1,
  fov: 75,
  lang: null,
};

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    bindings: {},
    stats: { bestDepth: 0, runs: 0, deaths: 0, dailyDate: '', dailyBest: 0 },
    seen: {},
  };
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a save from version n to n + 1. */
export const MIGRATIONS: Record<number, Migration> = {
  // v1 kept a flat `best` number and no onboarding flags.
  1: (d) => {
    const stats = { ...(d.stats as object), bestDepth: Number((d as { best?: number }).best ?? 0) };
    const rest: Record<string, unknown> = { ...d };
    delete rest.best;
    return { ...rest, stats, seen: {}, version: 2 };
  },
};

export function migrate(raw: Record<string, unknown>): SaveData {
  let data = raw;
  let v = Number(data.version ?? 1);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from v${v}`);
    data = m(data);
    v = Number(data.version);
  }
  const def = defaultSave();
  const d = data as Partial<SaveData>;
  return {
    version: SAVE_VERSION,
    settings: { ...def.settings, ...(d.settings ?? {}) },
    bindings: { ...(d.bindings ?? {}) },
    stats: { ...def.stats, ...(d.stats ?? {}) },
    seen: { ...(d.seen ?? {}) },
  };
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSave(store: Storage | null = storage()): SaveData {
  if (!store) return defaultSave();
  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return migrate(parsed);
  } catch (err) {
    console.warn('[save] corrupted save, using defaults', err);
    try {
      if (raw) store.setItem(`${KEY}.corrupt`, raw);
    } catch {
      /* ignore */
    }
    return defaultSave();
  }
}

/** Write-then-swap so a crash mid-write never leaves a half-written main save. */
export function writeSave(data: SaveData, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    const json = JSON.stringify(data);
    store.setItem(`${KEY}.tmp`, json);
    store.setItem(KEY, json);
    store.removeItem(`${KEY}.tmp`);
  } catch (err) {
    console.warn('[save] failed to write', err);
  }
}
