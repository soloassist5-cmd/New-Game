import { SceneRenderer } from '../render/scene';
import { createWorld, step } from '../game/sim';
import { createListener, createStalker } from '../game/monsters';
import { cellCenter, type Level } from '../game/level';
import { BALANCE } from '../game/config';
import { EMPTY_COMMAND, type Monster, type PlayerCommand, type SoundEvent, type World } from '../game/types';
import type { SfxName } from '../audio/sfx';
import { renderTrailerAudio, type AudioCue } from './audio';

/**
 * In-engine trailer. Every frame is a pure function of the frame index: the director rebuilds
 * the shot's world, runs the real simulation with scripted inputs and renders it with the real
 * renderer. Sound is not recorded — it is synthesised afterwards from the same events (audio.ts).
 *
 * Usage (scripts/render-trailer.mjs): open /play/?trailer, call __trailer.frame(i) for every frame,
 * screenshot, then __trailer.audio() for a WAV.
 */
export const FPS = 30;
const DT = 1 / FPS;
const SIM_STEPS = 2; // 60 Hz simulation inside a 30 fps video

interface Shot {
  start: number;
  end: number;
  build(): World;
  /** Scripted control: called before each sim step. `t` is time since the shot started. */
  script(t: number, w: World, cmd: PlayerCommand, d: TrailerDirector): void;
}

/** ASCII → level. '#' wall, '.' floor, 'S' start, 'E' exit, 'M' stalker, 'L' listener. */
function mapLevel(rows: string[]): Level {
  const h = rows.length;
  const w = rows[0].length;
  if (rows.some((r) => r.length !== w)) throw new Error('trailer map rows must have equal length');
  const cells = new Uint8Array(w * h);
  const level: Level = { w, h, cells, rooms: [], start: { x: 0, y: 0 }, exit: { x: 0, y: 0 }, stalkers: [], listeners: [], stones: [] };
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      cells[y * w + x] = ch === '#' ? 1 : 0;
      const p = { x: cellCenter(x), y: cellCenter(y) };
      if (ch === 'S') level.start = p;
      if (ch === 'E') level.exit = p;
      if (ch === 'M') level.stalkers.push(p);
      if (ch === 'L') level.listeners.push(p);
    }),
  );
  return level;
}

function worldOn(rows: string[], yaw = 0, depth = 3): World {
  const w = createWorld({ seed: 'trailer', depth, yaw });
  w.level = mapLevel(rows);
  w.player.x = w.player.prevX = w.level.start.x;
  w.player.y = w.player.prevY = w.level.start.y;
  w.monsters = [
    ...w.level.stalkers.map((s) => createStalker(s.x, s.y)),
    ...w.level.listeners.map((s) => createListener(s.x, s.y, 0.5)),
  ];
  w.pickups = [];
  w.god = true; // deaths are staged by the director
  w.beaconT = 999; // beacons only where scripted
  return w;
}

const HALL = [
  '####################',
  '#..................#',
  '#..................#',
  '#S...M............E#',
  '#..................#',
  '#..................#',
  '####################',
];

const LONG_HALL = [
  '##########################',
  '#####....######....#######',
  '#S......................E#',
  '#####....######....#######',
  '##########################',
];

const ROOM_STONE = [
  '##############',
  '#............#',
  '#..........M.#',
  '#............#',
  '#S...........#',
  '#............#',
  '#............#',
  '##############',
];

const ROOM_LISTENER = [
  '############',
  '#..........#',
  '#..........#',
  '#S...L.....#',
  '#..........#',
  '#..........#',
  '############',
];

const CHASE = [
  '############################',
  '#..........................#',
  '#S.........M...............#',
  '#..........................#',
  '############################',
];

const BEACON = [
  '##############',
  '#....#########',
  '#S.........E.#',
  '#....#########',
  '##############',
];

const stalker = (w: World): Monster => w.monsters.find((m) => m.kind === 'stalker')!;

const SHOTS: Shot[] = [
  {
    // 0–4 s. The hook: silence, a clap, something at the end of the hall turns and comes.
    start: 0,
    end: 4,
    build: () => {
      const w = worldOn(HALL);
      const m = stalker(w);
      m.state = 'linger';
      m.timer = 99;
      return w;
    },
    script(t, w, cmd, d) {
      if (d.once('h-clap1', t >= 0.5)) cmd.clap = true;
      const m = stalker(w);
      if (d.once('h-hunt', t >= 1.7) && m.kind === 'stalker') {
        m.state = 'hunt';
        m.targetX = w.player.x;
        m.targetY = w.player.y;
        m.field = null;
      }
      if (d.once('h-flash2', t >= 2.5)) d.visualClap(w, 0.8);
      if (d.once('h-flash3', t >= 3.25)) d.visualClap(w, 0.9);
      if (d.once('h-growl', t >= 3.3)) d.cue('growl', w, m.x, m.y, 1.4);
    },
  },
  {
    // 4–6.5 s. Title.
    start: 4,
    end: 6.5,
    build: () => worldOn(HALL),
    script(t, w, _cmd, d) {
      if (d.once('t-hit', t >= 0)) d.cue('death', w, undefined, undefined, 0.7);
    },
  },
  {
    // 6.5–11 s. Walk — every step lights the floor. Then run: the world blooms with loud steps.
    start: 6.5,
    end: 11,
    build: () => worldOn(LONG_HALL),
    script(t, _w, cmd, d) {
      cmd.forward = 1;
      cmd.yawDelta = Math.sin(t * 1.3) * 0.0025;
      if (d.once('w-clap', t >= 1.2)) cmd.clap = true;
      cmd.sprint = t >= 2.6;
    },
  },
  {
    // 11–15 s. A stone thrown across the room pulls the stalker away.
    start: 11,
    end: 15,
    build: () => {
      const w = worldOn(ROOM_STONE, -0.35);
      const m = stalker(w);
      m.state = 'linger';
      m.timer = 99;
      return w;
    },
    script(t, w, cmd, d) {
      if (d.once('s-clap', t >= 0.3)) cmd.clap = true;
      if (d.once('s-throw', t >= 1.3)) cmd.throw = true;
      const m = stalker(w);
      if (m.kind === 'stalker' && m.state !== 'investigate' && t > 1.3 && t < 1.9) {
        m.state = 'linger';
        m.timer = 99;
      }
      if (d.once('s-echo', t >= 2.2)) d.visualClap(w, 0.55);
      if (d.once('s-echo2', t >= 3.2)) d.visualClap(w, 0.5);
      cmd.sneak = true;
    },
  },
  {
    // 15–18.5 s. The listener breathes. Careless steps. It screams.
    start: 15,
    end: 18.5,
    build: () => worldOn(ROOM_LISTENER),
    script(t, w, cmd, d) {
      const l = w.monsters[0];
      if (d.once('l-breath', t >= 0.2) && l.kind === 'listener') l.breathT = 0;
      if (d.once('l-clap', t >= 0.6)) d.visualClap(w, 0.6);
      cmd.sneak = t < 1.6;
      cmd.forward = t > 0.9 && t < 2.6 ? 1 : 0;
    },
  },
  {
    // 18.5–23.5 s. Strobe: each flash shows it closer. Then the screamer.
    start: 18.5,
    end: 23.5,
    build: () => {
      const w = worldOn(CHASE, 0);
      const m = stalker(w);
      if (m.kind === 'stalker') {
        m.state = 'hunt';
        m.targetX = w.player.x;
        m.targetY = w.player.y;
      }
      return w;
    },
    script(t, w, _cmd, d) {
      const m = stalker(w);
      if (m.kind === 'stalker' && m.state !== 'hunt') {
        m.state = 'hunt';
        m.targetX = w.player.x;
        m.targetY = w.player.y;
        m.field = null;
      }
      // Flashes speed up as it closes in.
      const dist = Math.hypot(m.x - w.player.x, m.y - w.player.y);
      const interval = Math.max(0.22, dist / 22);
      if (t - d.lastFlash >= interval && dist > 1.2) {
        d.lastFlash = t;
        d.visualClap(w, 0.85);
      }
      if (d.once('c-scare', dist < 1.3)) {
        d.view.screamer();
        d.view.startKillCam(m.x, m.y);
        d.cue('screamer', w, undefined, undefined, 1);
        d.cueAt('death', t + 0.45, 0.5);
      }
    },
  },
  {
    // 23.5–26.5 s. Relief: the green beacon.
    start: 23.5,
    end: 26.5,
    build: () => {
      const w = worldOn(BEACON);
      w.checkpoint = true;
      w.beaconT = 0.2;
      return w;
    },
    script(t, w, cmd, d) {
      cmd.forward = t > 0.4 ? 0.85 : 0;
      cmd.sneak = true;
      if (d.once('b-clap', t >= 0.9)) cmd.clap = true;
      if (d.once('b-clap2', t >= 1.9)) d.visualClap(w, 0.5);
    },
  },
  {
    // 26.5–32 s. End card.
    start: 26.5,
    end: 32,
    build: () => worldOn(HALL),
    script(t, w, _cmd, d) {
      if (d.once('e-chime', t >= 0.6)) d.cue('beaconSave', w, undefined, undefined, 1);
    },
  },
];

export const DURATION = SHOTS[SHOTS.length - 1].end;

/** Title-card overlay states keyed by time (seconds). */
function overlayAt(t: number): { black: number; title: number; line: string; small: string; tone: string } {
  const fade = (a: number, b: number, x: number): number => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (t < 0.25) return { black: 1 - fade(0, 0.25, t), title: 0, line: '', small: '', tone: '' };
  if (t >= 3.75 && t < 6.5) {
    const title = fade(4.2, 4.9, t) * (1 - fade(6.1, 6.5, t));
    return { black: t < 6.3 ? 1 : 1 - fade(6.3, 6.5, t), title, line: 'Ты видишь только звуком.', small: '', tone: '' };
  }
  if (t >= 18.2 && t < 18.5) return { black: fade(18.2, 18.35, t), title: 0, line: '', small: '', tone: '' };
  if (t >= 23.25 && t < 23.7) return { black: 1 - fade(23.4, 23.7, t), title: 0, line: '', small: '', tone: '' };
  if (t >= 25.6 && t < 26.5) return { black: fade(26.2, 26.5, t), title: fade(25.6, 25.8, t), line: '', small: 'МАЯК ЗАЖЖЁН · ЗАБЕГ СОХРАНЁН', tone: 'save' };
  if (t >= 26.5) {
    const k = fade(27, 27.8, t);
    return { black: 1, title: k, line: t > 28.2 ? 'И оно — тоже.' : '', small: t > 29.2 ? 'Играй бесплатно в браузере · echo-v2-three.vercel.app' : '', tone: '' };
  }
  return { black: 0, title: 0, line: '', small: '', tone: '' };
}

export class TrailerDirector {
  readonly view: SceneRenderer;
  private world: World | null = null;
  private shotIndex = -1;
  private shotStartFrame = 0;
  private flags = new Set<string>();
  private cues: AudioCue[] = [];
  private overlay: HTMLElement;
  private frameNo = -1;
  lastFlash = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.view = new SceneRenderer(canvas, { preserveDrawingBuffer: true });
    this.view.settings = { fov: 72, shake: 1, reduceFlashes: false, shapes: false };
    // A video is watched small and compressed: slightly bigger points and more glow than in-game.
    this.view.tuneForVideo();
    this.overlay = document.createElement('div');
    this.overlay.className = 'trailer-overlay';
    this.overlay.innerHTML = `<div class="tr-black"></div><div class="tr-card"><div class="tr-title">ЭХО</div><div class="tr-line"></div><div class="tr-small"></div></div>`;
    document.body.append(this.overlay);
  }

  /** Fire once per shot when cond first becomes true. */
  once(key: string, cond: boolean): boolean {
    if (!cond || this.flags.has(key)) return false;
    this.flags.add(key);
    return true;
  }

  private get time(): number {
    return this.frameNo / FPS;
  }

  cue(name: SfxName, w: World, x?: number, y?: number, gain = 1): void {
    const p = w.player;
    let pan = 0;
    let dist = 0;
    if (x !== undefined && y !== undefined) {
      const rel = Math.atan2(y - p.y, x - p.x) - p.yaw;
      pan = Math.max(-1, Math.min(1, Math.sin(rel)));
      dist = Math.hypot(x - p.x, y - p.y);
    }
    this.cues.push({ t: this.time, name, pan, gain: gain / (1 + dist * 0.12) });
  }

  cueAt(name: SfxName, shotT: number, gain: number): void {
    const shot = SHOTS[this.shotIndex];
    this.cues.push({ t: shot.start + shotT, name, pan: 0, gain });
  }

  /** A clap the monsters do not hear: pure visual punctuation for the edit. */
  visualClap(w: World, intensity: number): void {
    const s: SoundEvent = { id: 0, kind: 'clap', x: w.player.x, y: w.player.y, radius: BALANCE.player.clapRadius, source: 'world', silent: true, time: w.time };
    this.view.echo.paint(w, s, this.view.time);
    this.view.addTrauma(0.15);
    this.view.shockwave();
    this.view.aberration(0.4);
    this.cue('clap', w, undefined, undefined, intensity);
  }

  private soundCue(w: World, s: SoundEvent): void {
    const map: Partial<Record<SoundEvent['kind'], [SfxName, number, boolean]>> = {
      step: ['step', 0.45, false],
      sneakStep: ['sneakStep', 0.7, false],
      sprintStep: ['sprintStep', 0.6, false],
      clap: ['clap', 0.95, false],
      throw: ['throw', 0.8, false],
      stoneLand: ['stoneLand', 1.1, true],
      monsterStep: ['monsterStep', 1.2, true],
      growl: ['growl', 1.3, true],
      breath: ['breath', 1.5, true],
      scream: ['scream', 1.4, true],
      beacon: [w.checkpoint ? 'beaconSave' : 'beacon', 1.1, true],
    };
    const m = map[s.kind];
    if (!m) return;
    if (m[2]) this.cue(m[0], w, s.x, s.y, m[1]);
    else this.cue(m[0], w, undefined, undefined, m[1]);
  }

  frame(i: number): void {
    if (i !== this.frameNo + 1) throw new Error(`frames must be rendered in order (got ${i}, expected ${this.frameNo + 1})`);
    this.frameNo = i;
    const t = this.time;
    const idx = SHOTS.findIndex((s) => t >= s.start && t < s.end);
    const shotIdx = idx < 0 ? SHOTS.length - 1 : idx;
    if (shotIdx !== this.shotIndex) {
      this.shotIndex = shotIdx;
      this.shotStartFrame = i;
      this.flags.clear();
      this.lastFlash = -1;
      this.world = SHOTS[shotIdx].build();
      this.view.setLevel(this.world.level);
    }
    const shot = SHOTS[this.shotIndex];
    const w = this.world!;
    for (let k = 0; k < SIM_STEPS; k++) {
      const shotT = (i - this.shotStartFrame) / FPS + (k * DT) / SIM_STEPS;
      const cmd: PlayerCommand = { ...EMPTY_COMMAND };
      shot.script(shotT, w, cmd, this);
      step(w, cmd, DT / SIM_STEPS);
      for (const e of w.events) {
        if (e.type === 'sound') {
          this.view.echo.paint(w, e.sound, this.view.time);
          this.soundCue(w, e.sound);
          if (e.sound.kind === 'clap') {
            this.view.addTrauma(0.2);
            this.view.shockwave();
            this.view.punchFov(-3);
          }
          if (e.sound.kind === 'scream') {
            this.view.addTrauma(0.5);
            this.view.aberration(1);
          }
          // Stone thrown in the stone shot: the stalker goes for it.
          if (e.sound.kind === 'stoneLand') {
            const m = w.monsters.find((mo) => mo.kind === 'stalker');
            if (m && m.kind === 'stalker') {
              m.state = 'investigate';
              m.targetX = e.sound.x;
              m.targetY = e.sound.y;
              m.field = null;
            }
          }
        }
        if (e.type === 'exit') {
          this.cue(e.checkpoint ? 'save' : 'exit', w, undefined, undefined, 1);
          this.view.flashScreen(e.checkpoint ? 0x5cff9d : 0xffc94d, 0.35);
          this.view.startExitCam();
        }
      }
    }
    // Danger drives the vignette like in the game.
    let danger = 0;
    for (const m of w.monsters) {
      const d = Math.hypot(m.x - w.player.x, m.y - w.player.y);
      danger = Math.max(danger, m.kind === 'stalker' && m.state === 'hunt' ? Math.max(0, 1 - d / 12) : 0);
    }
    this.view.danger += (danger - this.view.danger) * 0.2;
    this.view.render(w, 1, DT, DT);

    const o = overlayAt(t);
    const el = this.overlay;
    (el.querySelector('.tr-black') as HTMLElement).style.opacity = String(o.black);
    const card = el.querySelector('.tr-card') as HTMLElement;
    card.style.opacity = String(Math.max(o.title, o.small ? 1 : 0));
    card.dataset.tone = o.tone;
    (el.querySelector('.tr-title') as HTMLElement).style.display = o.tone === 'save' ? 'none' : '';
    (el.querySelector('.tr-line') as HTMLElement).textContent = o.line;
    (el.querySelector('.tr-small') as HTMLElement).textContent = o.small;
  }

  async audio(): Promise<string> {
    return renderTrailerAudio(this.cues, DURATION);
  }

  get frameCount(): number {
    return Math.round(DURATION * FPS);
  }
}
