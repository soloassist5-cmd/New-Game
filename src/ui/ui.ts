import { t, tk, type StringKey } from '../i18n/strings';
import { REBINDABLE, type Action } from '../input/input';
import type { Settings } from '../save/save';
import { upgradeById } from '../content/upgrades';
import { maxStones } from '../game/sim';
import type { World } from '../game/types';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | ((e: Event) => void)>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export interface MenuData {
  best: number;
  dailyBest: number;
  /** Depth saved at the last green beacon, 0 if none. */
  checkpointDepth: number;
  seed: string;
}

export interface DeathData {
  depth: number;
  best: number;
  newBest: boolean;
  killer: 'stalker' | 'listener';
  checkpointDepth: number;
  /** Caught while out of breath. */
  panting: boolean;
  claps: number;
  throws: number;
  steps: number;
  time: number;
}

export interface UiCallbacks {
  play(daily: boolean): void;
  continueRun(): void;
  newRun(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  openSettings(): void;
  closeSettings(): void;
  pickUpgrade(id: string): void;
  settingsChanged(s: Settings): void;
  rebind(action: Action, done: (label: string) => void): void;
  resetBindings(): void;
  bindingLabel(action: Action): string;
  sound(name: 'uiMove' | 'uiConfirm'): void;
}

interface Indicator {
  angle: number; // world angle from player
  x: number;
  y: number;
  color: string;
  born: number;
  life: number;
}

/** DOM overlay: HUD, hints, subtitles, direction indicators, and all menu screens. */
export class Ui {
  private root: HTMLElement;
  private hud: HTMLElement;
  private depthEl: HTMLElement;
  private stonesEl: HTMLElement;
  private cdArc: SVGCircleElement;
  private staminaArc: SVGCircleElement;
  private hintsEl: HTMLElement;
  private subsEl: HTMLElement;
  private toastEl: HTMLElement;
  private lockHintEl: HTMLElement;
  private indCanvas: HTMLCanvasElement;
  private indCtx: CanvasRenderingContext2D;
  private indicators: Indicator[] = [];
  private screens = new Map<string, HTMLElement>();
  private hints = new Map<string, HTMLElement>();
  readonly debugEl: HTMLElement;
  private lastStones = -1;
  private settingsReturn: 'menu' | 'pause' = 'menu';
  current = '';

  constructor(private cb: UiCallbacks) {
    this.root = document.getElementById('ui')!;
    this.depthEl = h('div', { class: 'hud-depth' });
    this.stonesEl = h('div', { class: 'hud-stones' });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '-20 -20 40 40');
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('r', '1.4');
    dot.setAttribute('fill', 'rgba(232,241,248,0.6)');
    this.cdArc = document.createElementNS(svgNS, 'circle');
    this.cdArc.setAttribute('r', '9');
    this.cdArc.setAttribute('fill', 'none');
    this.cdArc.setAttribute('stroke', '#4FC3F7');
    this.cdArc.setAttribute('stroke-width', '1.5');
    this.cdArc.setAttribute('stroke-dasharray', `${2 * Math.PI * 9}`);
    this.cdArc.setAttribute('transform', 'rotate(-90)');
    this.cdArc.style.opacity = '0';
    this.staminaArc = document.createElementNS(svgNS, 'circle');
    this.staminaArc.setAttribute('r', '14');
    this.staminaArc.setAttribute('fill', 'none');
    this.staminaArc.setAttribute('stroke', 'rgba(232,241,248,0.75)');
    this.staminaArc.setAttribute('stroke-width', '2');
    this.staminaArc.setAttribute('stroke-dasharray', `${2 * Math.PI * 14}`);
    this.staminaArc.setAttribute('transform', 'rotate(-90)');
    this.staminaArc.style.opacity = '0';
    this.staminaArc.style.transition = 'opacity .3s';
    svg.append(dot, this.cdArc, this.staminaArc);
    const cross = h('div', { class: 'crosshair' });
    cross.append(svg);
    this.hintsEl = h('div', { class: 'hints' });
    this.subsEl = h('div', { class: 'subs' });
    this.toastEl = h('div', { class: 'toast' });
    this.lockHintEl = h('div', { class: 'lockhint' }, t('hint.click'));
    this.indCanvas = h('canvas', { class: 'indicators' });
    this.indCtx = this.indCanvas.getContext('2d')!;
    this.hud = h('div', { class: 'hud' }, this.indCanvas, this.depthEl, this.stonesEl, cross, this.hintsEl, this.subsEl, this.toastEl, this.lockHintEl);
    this.debugEl = h('div', { class: 'debug' });
    this.root.append(this.hud, this.debugEl);
    window.addEventListener('keydown', (e) => this.menuKeys(e));
  }

  applyScale(scale: number): void {
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  }

  // ---------- HUD ----------
  showHud(on: boolean): void {
    this.hud.classList.toggle('on', on);
  }

  setLockHint(on: boolean): void {
    this.lockHintEl.classList.toggle('on', on);
  }

  updateHud(world: World, clapFrac: number): void {
    this.depthEl.textContent = t('hud.depth', { n: world.depth });
    const max = maxStones(world);
    const n = world.player.stones;
    if (n !== this.lastStones || this.stonesEl.childElementCount !== max) {
      const gained = n > this.lastStones && this.lastStones >= 0;
      this.stonesEl.replaceChildren(
        ...Array.from({ length: max }, (_, i) => h('div', { class: `stone${i < n ? '' : ' empty'}${gained && i === n - 1 ? ' pop' : ''}` })),
      );
      this.lastStones = n;
    }
    const c = 2 * Math.PI * 9;
    this.cdArc.style.opacity = clapFrac > 0 ? '0.8' : '0';
    this.cdArc.setAttribute('stroke-dashoffset', String(c * clapFrac));
    // Stamina: an outer ring that only appears while it is not full; blinks when exhausted.
    const p = world.player;
    const cs = 2 * Math.PI * 14;
    this.staminaArc.setAttribute('stroke-dashoffset', String(cs * (1 - p.stamina)));
    const blink = p.exhausted ? 0.35 + 0.35 * Math.sin(performance.now() / 90) : 0.8;
    this.staminaArc.style.opacity = p.stamina < 0.999 ? String(blink) : '0';
  }

  hint(id: string, key: string, text: string, tone: '' | 'gold' | 'save' = ''): void {
    if (this.hints.has(id)) return;
    const el = h('div', { class: `hint${tone ? ` ${tone}` : ''}` }, h('span', { class: 'key' }, key), h('span', {}, text));
    this.hintsEl.append(el);
    this.hints.set(id, el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  }

  dismissHint(id: string): void {
    const el = this.hints.get(id);
    if (!el) return;
    this.hints.delete(id);
    el.classList.remove('on');
    setTimeout(() => el.remove(), 700);
  }

  clearHints(): void {
    for (const id of [...this.hints.keys()]) this.dismissHint(id);
  }

  toast(text: string, ms = 1800, tone: '' | 'save' = ''): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('save', tone === 'save');
    this.toastEl.classList.add('on');
    setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  subtitle(text: string, kind: 'danger' | 'exit' | 'save' | '' = ''): void {
    const el = h('div', { class: `sub ${kind}` }, `[${text}]`);
    this.subsEl.append(el);
    while (this.subsEl.childElementCount > 3) this.subsEl.firstElementChild?.remove();
    setTimeout(() => el.remove(), 2200);
  }

  indicator(x: number, y: number, color: string, life = 1.6): void {
    this.indicators.push({ angle: 0, x, y, color, born: performance.now(), life: life * 1000 });
    if (this.indicators.length > 24) this.indicators.shift();
  }

  /** Arcs around the crosshair pointing at recent sounds (for players without headphones). */
  drawIndicators(px: number, py: number, yaw: number, enabled: boolean): void {
    const c = this.indCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hh * dpr);
    }
    const g = this.indCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const now = performance.now();
    this.indicators = this.indicators.filter((i) => now - i.born < i.life);
    if (!enabled) return;
    const cx = w / 2;
    const cy = hh / 2;
    const R = Math.min(w, hh) * 0.16;
    for (const ind of this.indicators) {
      const k = 1 - (now - ind.born) / ind.life;
      const world = Math.atan2(ind.y - py, ind.x - px);
      const rel = world - yaw; // 0 = ahead
      const a = rel - Math.PI / 2; // screen: up = ahead
      const dist = Math.hypot(ind.x - px, ind.y - py);
      if (dist < 1) continue;
      g.strokeStyle = ind.color;
      g.globalAlpha = k * 0.9;
      g.lineWidth = 3;
      g.shadowColor = ind.color;
      g.shadowBlur = 10;
      g.beginPath();
      g.arc(cx, cy, R, a - 0.22, a + 0.22);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
  }

  // ---------- Screens ----------
  private screen(id: string, build: () => HTMLElement): HTMLElement {
    this.screens.get(id)?.remove();
    const el = build();
    el.classList.add('screen');
    this.root.append(el);
    this.screens.set(id, el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    this.current = id;
    setTimeout(() => (el.querySelector('button.primary, button') as HTMLButtonElement | null)?.focus({ preventScroll: true }), 60);
    return el;
  }

  hideScreens(): void {
    for (const [id, el] of this.screens) {
      el.classList.remove('on');
      setTimeout(() => {
        if (this.screens.get(id) === el && !el.classList.contains('on')) {
          el.remove();
          this.screens.delete(id);
        }
      }, 400);
    }
    this.current = '';
  }

  private btn(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = h('button', { class: primary ? 'primary' : '' }, label);
    b.addEventListener('click', () => {
      this.cb.sound('uiConfirm');
      onClick();
    });
    b.addEventListener('mouseenter', () => this.cb.sound('uiMove'));
    return b;
  }

  showMenu(d: MenuData): void {
    this.hideScreens();
    this.screen('menu', () =>
      h(
        'div',
        { class: 'dim' },
        h('h1', { class: 'title' }, 'ЭХО'),
        h('div', { class: 'tagline' }, t('title.tagline')),
        h(
          'div',
          { class: 'menu' },
          d.checkpointDepth > 0 ? this.btn(t('menu.fromCheckpoint', { n: d.checkpointDepth }), () => this.cb.continueRun(), true) : null,
          this.btn(t('menu.play'), () => this.cb.play(false), d.checkpointDepth === 0),
          this.btn(t('menu.daily'), () => this.cb.play(true)),
          this.btn(t('menu.settings'), () => {
            this.settingsReturn = 'menu';
            this.cb.openSettings();
          }),
        ),
        h(
          'div',
          { class: 'stats' },
          d.best > 0 ? h('span', { class: 'best' }, t('menu.best', { n: d.best })) : null,
          d.dailyBest > 0 ? ` · ${t('menu.dailyBest', { n: d.dailyBest })}` : null,
        ),
        h('div', { class: 'headphones' }, '🎧', t('menu.headphones')),
        h('div', { class: 'seed' }, `v0.2 · ${t('menu.seed', { seed: d.seed })}`),
      ),
    );
  }

  showPause(): void {
    this.hideScreens();
    this.screen('pause', () =>
      h(
        'div',
        { class: 'dim' },
        h('h2', {}, t('pause.title')),
        h(
          'div',
          { class: 'menu' },
          this.btn(t('pause.resume'), () => this.cb.resume(), true),
          this.btn(t('pause.restart'), () => this.cb.restart()),
          this.btn(t('menu.settings'), () => {
            this.settingsReturn = 'pause';
            this.cb.openSettings();
          }),
          this.btn(t('pause.quit'), () => this.cb.quit()),
        ),
      ),
    );
  }

  get settingsFrom(): 'menu' | 'pause' {
    return this.settingsReturn;
  }

  showSettings(s: Settings): void {
    this.hideScreens();
    const set = (patch: Partial<Settings>): void => {
      Object.assign(s, patch);
      this.cb.settingsChanged(s);
    };
    const slider = (key: StringKey, val: number, min: number, max: number, step: number, on: (v: number) => void): HTMLElement => {
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), 'aria-label': t(key) });
      input.addEventListener('input', () => on(Number(input.value)));
      return h('label', { class: 'field' }, h('span', {}, t(key)), input);
    };
    const toggle = (key: StringKey, val: boolean, on: (v: boolean) => void): HTMLElement => {
      let v = val;
      const b = h('button', { class: v ? 'on' : '' }, v ? t('settings.on') : t('settings.off'));
      b.addEventListener('click', () => {
        v = !v;
        b.className = v ? 'on' : '';
        b.textContent = v ? t('settings.on') : t('settings.off');
        this.cb.sound('uiMove');
        on(v);
      });
      return h('div', { class: 'field' }, h('span', {}, t(key)), b);
    };
    const binds = REBINDABLE.map((a) => {
      const b = h('button', {}, this.cb.bindingLabel(a));
      b.addEventListener('click', () => {
        b.textContent = t('settings.rebind');
        this.cb.rebind(a, (label) => (b.textContent = label));
      });
      return h('div', { class: 'field' }, h('span', {}, t(`action.${a}` as StringKey)), b);
    });
    const langBtn = h('button', {}, s.lang === 'en' ? 'English' : 'Русский');
    langBtn.addEventListener('click', () => set({ lang: (s.lang ?? 'ru') === 'ru' ? 'en' : 'ru' }));

    this.screen('settings', () =>
      h(
        'div',
        { class: 'dim' },
        h('h2', {}, t('settings.title')),
        h(
          'div',
          { class: 'settings' },
          h('h3', {}, t('settings.audio')),
          slider('settings.master', s.master, 0, 1, 0.05, (v) => set({ master: v })),
          slider('settings.music', s.music, 0, 1, 0.05, (v) => set({ music: v })),
          slider('settings.sfx', s.sfx, 0, 1, 0.05, (v) => set({ sfx: v })),
          slider('settings.ui', s.ui, 0, 1, 0.05, (v) => set({ ui: v })),
          h('h3', {}, t('settings.controls')),
          slider('settings.sensitivity', s.sensitivity, 0.2, 3, 0.05, (v) => set({ sensitivity: v })),
          toggle('settings.invertY', s.invertY, (v) => set({ invertY: v })),
          ...binds,
          h('h3', {}, t('settings.access')),
          slider('settings.shake', s.shake, 0, 1, 0.05, (v) => set({ shake: v })),
          toggle('settings.flashes', s.reduceFlashes, (v) => set({ reduceFlashes: v })),
          toggle('settings.indicators', s.indicators, (v) => set({ indicators: v })),
          toggle('settings.subtitles', s.subtitles, (v) => set({ subtitles: v })),
          toggle('settings.shapes', s.shapes, (v) => set({ shapes: v })),
          toggle('settings.screamer', s.screamer, (v) => set({ screamer: v })),
          slider('settings.uiScale', s.uiScale, 0.8, 1.4, 0.05, (v) => set({ uiScale: v })),
          slider('settings.fov', s.fov, 60, 100, 1, (v) => set({ fov: v })),
          h('div', { class: 'field' }, h('span', {}, t('settings.lang')), langBtn),
        ),
        h('div', { class: 'row' }, this.btn(t('settings.back'), () => this.cb.closeSettings(), true)),
      ),
    );
  }

  showUpgrade(depth: number, ids: string[]): void {
    this.hideScreens();
    this.screen('upgrade', () =>
      h(
        'div',
        { class: 'dim' },
        h('h2', { class: 'exit' }, t('upgrade.title', { n: depth })),
        h('div', { class: 'muted' }, t('upgrade.pick')),
        h(
          'div',
          { class: 'cards' },
          ...ids.map((id, i) => {
            const u = upgradeById(id)!;
            const b = h(
              'button',
              { class: 'card', style: `animation-delay:${i * 90}ms` },
              h('div', { class: 'glyph' }, u.glyph),
              h('div', { class: 'name' }, tk(`upgrade.${id}.name`)),
              h('div', { class: 'desc' }, tk(`upgrade.${id}.desc`)),
              h('div', { class: 'num' }, String(i + 1)),
            );
            b.addEventListener('click', () => {
              this.cb.sound('uiConfirm');
              this.cb.pickUpgrade(id);
            });
            b.addEventListener('mouseenter', () => this.cb.sound('uiMove'));
            return b;
          }),
        ),
      ),
    );
  }

  showDeath(d: DeathData): void {
    this.hideScreens();
    const mm = Math.floor(d.time / 60);
    const ss = Math.floor(d.time % 60)
      .toString()
      .padStart(2, '0');
    this.screen('death', () =>
      h(
        'div',
        { class: 'dim' },
        h('h2', { class: 'danger' }, t('death.title')),
        h('div', { class: 'muted' }, t(d.killer === 'stalker' ? 'death.by.stalker' : 'death.by.listener')),
        h('div', { class: 'title', style: 'font-size:3.2em;letter-spacing:.2em;margin:0' }, String(d.depth)),
        h('div', { class: 'stats' }, d.newBest ? h('span', { class: 'best' }, t('death.newBest')) : t('death.best', { n: d.best })),
        h('div', { class: 'stats' }, t('death.stats', { claps: d.claps, throws: d.throws, steps: d.steps, time: `${mm}:${ss}` })),
        h('div', { class: 'muted' }, t(d.panting ? 'death.hint.panting' : d.killer === 'stalker' ? 'death.hint.stalker' : 'death.hint.listener')),
        h(
          'div',
          { class: 'row' },
          d.checkpointDepth > 0
            ? this.btn(`${t('death.fromCheckpoint', { n: d.checkpointDepth })} [${this.cb.bindingLabel('restart')}]`, () => this.cb.restart(), true)
            : this.btn(`${t('death.retry')} [${this.cb.bindingLabel('restart')}]`, () => this.cb.restart(), true),
          d.checkpointDepth > 0 ? this.btn(t('death.newRun'), () => this.cb.newRun()) : null,
          this.btn(t('death.menu'), () => this.cb.quit()),
        ),
      ),
    );
  }

  showError(message: string): void {
    this.hideScreens();
    const el = this.screen('error', () =>
      h(
        'div',
        { class: 'error' },
        h('h2', { class: 'danger' }, t('error.title')),
        h('div', { class: 'muted' }, message),
        this.btn(t('error.reload'), () => location.reload(), true),
      ),
    );
    el.classList.add('on');
  }

  /** Arrow/D-pad navigation between buttons; number keys pick upgrade cards. */
  private menuKeys(e: KeyboardEvent): void {
    if (!this.current) return;
    const el = this.screens.get(this.current);
    if (!el) return;
    if (this.current === 'upgrade' && /^Digit[1-3]$/.test(e.code)) {
      const cards = el.querySelectorAll<HTMLButtonElement>('.card');
      cards[Number(e.code.slice(5)) - 1]?.click();
      return;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      this.moveFocus(e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
    }
  }

  moveFocus(dir: number): void {
    const el = this.screens.get(this.current);
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('button, input'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    next.focus();
    this.cb.sound('uiMove');
  }

  activateFocused(): void {
    const a = document.activeElement as HTMLElement | null;
    if (a && a.tagName === 'BUTTON') a.click();
  }
}
