/**
 * Input abstraction: the game asks about *actions*, never keys.
 * Keyboard/mouse bindings are rebindable; the gamepad uses the standard mapping with dead zones.
 * Pressed edges are buffered (default 130 ms) so a clap pressed slightly early still happens.
 */
export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'turnLeft'
  | 'turnRight'
  | 'clap'
  | 'throw'
  | 'sneak'
  | 'sprint'
  | 'pause'
  | 'restart';

export const ACTIONS: Action[] = ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'turnLeft', 'turnRight', 'clap', 'throw', 'sneak', 'sprint', 'pause', 'restart'];
export const REBINDABLE: Action[] = ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'turnLeft', 'turnRight', 'clap', 'throw', 'sneak', 'sprint', 'restart'];

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  turnLeft: ['ArrowLeft', 'KeyQ'],
  turnRight: ['ArrowRight', 'KeyE'],
  clap: ['Mouse0', 'Space'],
  throw: ['Mouse2', 'KeyF'],
  // Ctrl is avoided on purpose: Ctrl+W closes the browser tab mid-run.
  sneak: ['KeyC', 'KeyZ'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
};

// Standard gamepad mapping.
const PAD_BUTTONS: Partial<Record<Action, number[]>> = {
  clap: [7, 0], // RT, A
  throw: [6, 2], // LT, X
  sneak: [4, 1], // LB, B (B is "back" only in menus)
  sprint: [10, 5], // L3, RB
  pause: [9], // Start
  restart: [8], // Back/Select
};
const DEAD_ZONE = 0.18;
const BUFFER_MS = 130;

export interface MoveAxes {
  forward: number;
  strafe: number;
  turn: number; // -1..1 from keys / right stick X
  lookY: number; // right stick Y
}

export function keyLabel(code: string): string {
  if (code === 'Mouse0') return 'ЛКМ/LMB';
  if (code === 'Mouse1') return 'СКМ/MMB';
  if (code === 'Mouse2') return 'ПКМ/RMB';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  if (code.startsWith('Shift')) return 'Shift';
  if (code === 'Space') return 'Space';
  if (code === 'Escape') return 'Esc';
  return code;
}

export class Input {
  bindings: Record<Action, string[]>;
  private down = new Set<string>();
  private pressedAt = new Map<Action, number>();
  private padPrev = new Set<string>();
  private padRawPrev = new Set<number>();
  /** Raw button indices newly pressed during the last pollPad() (menus, pause). */
  padJustPressed = new Set<number>();
  private mouseDX = 0;
  /** Time the previous frame began — presses after it are always valid, however slow the frame was. */
  private prevFrame = 0;
  private curFrame = 0;
  private mouseDY = 0;
  pointerLocked = false;
  usingPad = false;
  /** Called when a key is pressed while waiting for a rebind. */
  private rebindCb: ((code: string) => void) | null = null;
  private listeners: Array<() => void> = [];

  constructor(private target: HTMLElement, overrides: Record<string, string[]> = {}) {
    this.bindings = { ...DEFAULT_BINDINGS };
    const overridden = ACTIONS.filter((a) => overrides[a]?.length);
    for (const a of overridden) this.bindings[a] = overrides[a];
    // A code chosen by the player wins over a default bound elsewhere (e.g. old saves with Shift = sneak).
    const taken = new Set(overridden.flatMap((a) => this.bindings[a]));
    for (const a of ACTIONS) if (!overridden.includes(a)) this.bindings[a] = this.bindings[a].filter((c) => !taken.has(c));
    this.attach();
  }

  private attach(): void {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      window.addEventListener(type, fn as EventListener, opts);
      this.listeners.push(() => window.removeEventListener(type, fn as EventListener, opts));
    };
    on('keydown', (e) => {
      if (this.rebindCb) {
        e.preventDefault();
        const cb = this.rebindCb;
        this.rebindCb = null;
        cb(e.code);
        return;
      }
      if (e.repeat) return;
      this.press(e.code);
      if (this.isBound(e.code) && e.code !== 'Escape') e.preventDefault();
    });
    on('keyup', (e) => this.down.delete(e.code));
    on('blur', () => this.down.clear());
    on('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (this.rebindCb) {
        const cb = this.rebindCb;
        this.rebindCb = null;
        cb(code);
        return;
      }
      // Clicking to capture the mouse must not also clap.
      if (!this.pointerLocked) return;
      this.press(code);
    });
    on('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    on('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      this.usingPad = false;
    });
    on('contextmenu', (e) => e.preventDefault());
    const plc = (): void => {
      this.pointerLocked = document.pointerLockElement === this.target;
    };
    document.addEventListener('pointerlockchange', plc);
    this.listeners.push(() => document.removeEventListener('pointerlockchange', plc));
  }

  private isBound(code: string): boolean {
    return ACTIONS.some((a) => this.bindings[a].includes(code));
  }

  private press(code: string): void {
    this.down.add(code);
    this.usingPad = false;
    const now = performance.now();
    for (const a of ACTIONS) if (this.bindings[a].includes(code)) this.pressedAt.set(a, now);
  }

  /** Poll the gamepad once per frame. */
  pollPad(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    this.padJustPressed.clear();
    if (!pad) return;
    const now = performance.now();
    const raw = new Set<number>();
    pad.buttons.forEach((b, i) => {
      if (b.pressed || b.value > 0.5) raw.add(i);
    });
    for (const i of raw) if (!this.padRawPrev.has(i)) this.padJustPressed.add(i);
    this.padRawPrev = raw;
    if (this.padJustPressed.size) this.usingPad = true;
    const cur = new Set<string>();
    for (const [action, buttons] of Object.entries(PAD_BUTTONS) as Array<[Action, number[]]>) {
      for (const b of buttons) {
        const btn = pad.buttons[b];
        if (btn && (btn.pressed || btn.value > 0.5)) {
          const id = `${action}:${b}`;
          cur.add(id);
          if (!this.padPrev.has(id)) {
            this.pressedAt.set(action, now);
            this.usingPad = true;
          }
        }
      }
    }
    this.padPrev = cur;
  }

  private padAxes(): MoveAxes {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    const zero = { forward: 0, strafe: 0, turn: 0, lookY: 0 };
    if (!pad) return zero;
    const dz = (v: number): number => (Math.abs(v) < DEAD_ZONE ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE)));
    const axes = {
      strafe: dz(pad.axes[0] ?? 0),
      forward: -dz(pad.axes[1] ?? 0),
      turn: dz(pad.axes[2] ?? 0),
      lookY: dz(pad.axes[3] ?? 0),
    };
    if (axes.strafe || axes.forward || axes.turn || axes.lookY) this.usingPad = true;
    return axes;
  }

  held(a: Action): boolean {
    if (this.bindings[a].some((c) => this.down.has(c))) return true;
    for (const id of this.padPrev) if (id.startsWith(`${a}:`)) return true;
    return false;
  }

  /** Call once per rendered frame. */
  beginFrame(): void {
    this.prevFrame = this.curFrame;
    this.curFrame = performance.now();
  }

  private fresh(t: number, bufferMs: number): boolean {
    return t >= this.prevFrame || performance.now() - t <= bufferMs;
  }

  /** True once per press, if the press happened since the last frame or within the buffer window. */
  consume(a: Action, bufferMs = BUFFER_MS): boolean {
    const t = this.pressedAt.get(a);
    if (t === undefined) return false;
    if (!this.fresh(t, bufferMs)) {
      this.pressedAt.delete(a);
      return false;
    }
    this.pressedAt.delete(a);
    return true;
  }

  /** Peek without consuming (e.g. to keep a clap buffered during cooldown). */
  pending(a: Action, bufferMs = BUFFER_MS): boolean {
    const t = this.pressedAt.get(a);
    return t !== undefined && this.fresh(t, bufferMs);
  }

  clearPressed(): void {
    this.pressedAt.clear();
  }

  axes(): MoveAxes {
    const k = (a: Action): number => (this.held(a) ? 1 : 0);
    const pad = this.padAxes();
    const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));
    return {
      forward: clamp1(k('moveForward') - k('moveBack') + pad.forward),
      strafe: clamp1(k('moveRight') - k('moveLeft') + pad.strafe),
      turn: clamp1(k('turnRight') - k('turnLeft') + pad.turn),
      lookY: pad.lookY,
    };
  }

  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  peekMouse(): { dx: number; dy: number } {
    return { dx: this.mouseDX, dy: this.mouseDY };
  }

  requestPointerLock(): void {
    try {
      const r = this.target.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* not supported (e.g. headless) — keyboard turning still works */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  waitForRebind(cb: (code: string) => void): void {
    this.rebindCb = cb;
  }

  rebind(a: Action, code: string): void {
    // A code belongs to one action only.
    for (const other of ACTIONS) this.bindings[other] = this.bindings[other].filter((c) => c !== code);
    this.bindings[a] = [code, ...this.bindings[a].filter((c) => c !== code)].slice(0, 2);
  }

  resetBindings(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
  }

  dispose(): void {
    for (const off of this.listeners) off();
  }
}
