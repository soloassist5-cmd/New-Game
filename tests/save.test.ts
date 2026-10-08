import { describe, expect, it } from 'vitest';
import { defaultSave, loadSave, migrate, SAVE_VERSION, writeSave, type Storage } from '../src/save/save';

class MemStore implements Storage {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe('save', () => {
  it('round-trips', () => {
    const s = new MemStore();
    const d = defaultSave();
    d.stats.bestDepth = 7;
    d.settings.shake = 0;
    writeSave(d, s);
    const back = loadSave(s);
    expect(back.stats.bestDepth).toBe(7);
    expect(back.settings.shake).toBe(0);
    expect(s.getItem('echo.save.tmp')).toBeNull();
  });

  it('corrupted JSON falls back to defaults and keeps a backup', () => {
    const s = new MemStore();
    s.setItem('echo.save', '{not json');
    const d = loadSave(s);
    expect(d).toEqual(defaultSave());
    expect(s.getItem('echo.save.corrupt')).toBe('{not json');
  });

  it('migrates v1 saves', () => {
    const d = migrate({ version: 1, best: 5, settings: { master: 0.3 } });
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.stats.bestDepth).toBe(5);
    expect(d.settings.master).toBe(0.3);
    expect(d.settings.fov).toBe(75);
  });

  it('fills settings added in newer versions', () => {
    const d = migrate({ version: SAVE_VERSION, settings: { master: 0.1 } });
    expect(d.settings.indicators).toBe(true);
  });
});
