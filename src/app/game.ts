import { FixedLoop } from '../core/loop';
import { EventBus } from '../core/events';
import { step } from '../game/sim';
import { monsterThreat } from '../game/monsters';
import { absorbWorld, applyUpgrade, checkpointFromRun, createRun, dailySeed, randomSeed, rollUpgrades, runFromCheckpoint, worldForRun, type Run } from '../game/run';
import { EMPTY_COMMAND, type PlayerCommand, type SimEvent, type SoundEvent, type World } from '../game/types';
import { BALANCE } from '../game/config';
import { Input, keyLabel, type Action } from '../input/input';
import { AudioEngine } from '../audio/engine';
import { SceneRenderer } from '../render/scene';
import { PALETTE } from '../render/palette';
import { Ui } from '../ui/ui';
import { loadSave, writeSave, type SaveData, type Settings } from '../save/save';
import { detectLang, getLang, setLang, t } from '../i18n/strings';
import { DebugTools } from '../debug/debug';

export type AppState = 'menu' | 'playing' | 'paused' | 'settings' | 'upgrade' | 'dying' | 'exiting' | 'dead';

/** Typed app-level events: the simulation's events are re-published here for audio/render/UI. */
export interface AppEvents {
  sim: SimEvent;
  state: AppState;
}

const MOUSE_RAD_PER_PX = 0.0022;
const KEY_TURN_SPEED = 2.6; // rad/s
const PAD_LOOK_SPEED = 1.9; // rad/s

export class Game {
  state: AppState = 'menu';
  readonly bus = new EventBus<AppEvents>();
  readonly loop: FixedLoop;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly view: SceneRenderer;
  readonly ui: Ui;
  readonly save: SaveData;
  readonly debug: DebugTools;
  run: Run | null = null;
  world: World | null = null;
  private nextSeed: string;
  private firstTickOfFrame = true;
  private wasLocked = false;
  private stateTimer = 0;
  private hintTimer = 0;
  private distanceThisLevel = 0;
  private subThrottle = new Map<string, number>();
  private saveTimer = 0;
  private forcedSeed: string | null;
  private startDepth: number;
  private lastDeath: SimEvent | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.save = loadSave();
    setLang(this.save.settings.lang ?? detectLang());
    const params = new URLSearchParams(location.search);
    this.forcedSeed = params.get('seed');
    this.startDepth = Math.max(1, Number(params.get('depth') ?? 1) || 1);
    this.nextSeed = this.forcedSeed ?? randomSeed();

    this.view = new SceneRenderer(canvas);
    this.input = new Input(canvas, this.save.bindings);
    this.ui = new Ui({
      play: (daily) => this.startRun(daily),
      continueRun: () => this.continueFromCheckpoint(),
      resume: () => this.resume(),
      restart: () => this.retry(),
      newRun: () => this.startRun(false),
      quit: () => this.toMenu(),
      openSettings: () => this.openSettings(),
      closeSettings: () => this.closeSettings(),
      pickUpgrade: (id) => this.pickUpgrade(id),
      settingsChanged: (s) => this.applySettings(s, true),
      rebind: (a, done) => this.rebind(a, done),
      resetBindings: () => this.input.resetBindings(),
      bindingLabel: (a) => this.bindingLabel(a),
      sound: (n) => this.audio.ui(n),
    });
    this.debug = new DebugTools(this, params.has('debug'));
    this.applySettings(this.save.settings, false);
    this.loop = new FixedLoop({
      update: (dt) => this.update(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });

    this.bus.on('sim', (e) => this.onSimEvent(e));
    window.addEventListener('resize', () => this.view.resize());
    document.addEventListener('pointerlockchange', () => this.onPointerLock());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else this.audio.resume();
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) this.input.requestPointerLock();
    });
    window.addEventListener('keydown', (e) => this.globalKeys(e));
  }

  start(): void {
    this.toMenu();
    this.loop.start();
  }

  // ---------- states ----------
  private setState(s: AppState): void {
    this.state = s;
    this.stateTimer = 0;
    this.bus.emit('state', s);
  }

  toMenu(): void {
    this.input.exitPointerLock();
    this.setState('menu');
    this.ui.showHud(false);
    this.ui.clearHints();
    this.ui.showMenu({ best: this.save.stats.bestDepth, dailyBest: this.dailyBestToday(), checkpointDepth: this.save.checkpoint?.depth ?? 0, seed: this.nextSeed });
    this.loop.timeScale = 1;
  }

  async startRun(daily: boolean): Promise<void> {
    await this.audio.init();
    this.applySettings(this.save.settings, false);
    const seed = daily ? dailySeed() : this.nextSeed;
    this.nextSeed = this.forcedSeed ?? randomSeed();
    this.run = createRun(seed, daily, daily ? 1 : this.startDepth);
    this.save.stats.runs++;
    this.queueSave();
    this.startLevel();
  }

  /** Resume the run saved at the last green beacon. */
  async continueFromCheckpoint(): Promise<void> {
    const cp = this.save.checkpoint;
    if (!cp) return this.startRun(false);
    await this.audio.init();
    this.applySettings(this.save.settings, false);
    this.run = runFromCheckpoint(cp);
    this.startLevel();
  }

  /** After death: from the checkpoint if there is one, otherwise a fresh run. */
  retry(): void {
    if (this.save.checkpoint) this.continueFromCheckpoint();
    else this.startRun(this.run?.daily ?? false);
  }

  private clearedCheckpoint = false;

  private startLevel(): void {
    if (!this.run) return;
    this.world = worldForRun(this.run);
    this.view.setLevel(this.world.level);
    this.view.echo.echoLifeMul = this.run.mods.echoLifeMul;
    this.view.echo.monsterRevealMul = this.run.mods.monsterRevealMul;
    this.distanceThisLevel = 0;
    this.hintTimer = 0;
    this.lastDeath = null;
    this.loop.timeScale = 1;
    this.input.clearPressed();
    this.input.takeMouse();
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.ui.clearHints();
    this.setState('playing');
    this.input.requestPointerLock();
    this.ui.toast(t('hud.depth', { n: this.run.depth }).toUpperCase());
    // Arrival: a faint silent wave so the first frame is not pure black.
    const p = this.world.player;
    this.view.echo.paint(this.world, { id: 0, kind: 'clapEcho', x: p.x, y: p.y, radius: 6, source: 'world', silent: true, time: 0 }, this.view.time + 0.25);
    this.onboardingStart();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.exitPointerLock();
    this.ui.showPause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.ui.hideScreens();
    this.setState('playing');
    this.input.clearPressed();
    this.input.takeMouse();
    this.input.requestPointerLock();
  }

  private openSettings(): void {
    this.setState('settings');
    this.ui.showSettings(this.save.settings);
  }

  private closeSettings(): void {
    this.queueSave();
    if (this.ui.settingsFrom === 'pause' && this.world) {
      this.setState('paused');
      this.ui.showPause();
    } else this.toMenu();
  }

  private pickUpgrade(id: string): void {
    if (!this.run || this.state !== 'upgrade') return;
    applyUpgrade(this.run, id);
    this.run.depth++;
    // The checkpoint was written when the beacon was reached; refresh it so it includes this upgrade.
    if (this.clearedCheckpoint) {
      this.save.checkpoint = checkpointFromRun(this.run, this.run.depth);
      this.queueSave();
    }
    this.startLevel();
  }

  private onPointerLock(): void {
    const locked = this.input.pointerLocked;
    if (this.wasLocked && !locked && this.state === 'playing') this.pause();
    this.wasLocked = locked;
  }

  private globalKeys(e: KeyboardEvent): void {
    const b = this.input.bindings;
    if (b.pause.includes(e.code)) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'settings') this.closeSettings();
    }
    if (b.restart.includes(e.code) && this.state === 'dead') this.retry();
    if (this.state === 'menu' && e.code === 'Enter' && document.activeElement === document.body) this.startRun(false);
    this.debug.onKey(e);
  }

  // ---------- settings ----------
  private applySettings(s: Settings, persist: boolean): void {
    const langBefore = getLang();
    setLang(s.lang ?? detectLang());
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, ui: s.ui });
    this.view.settings = { fov: s.fov, shake: s.shake, reduceFlashes: s.reduceFlashes, shapes: s.shapes };
    this.ui.applyScale(s.uiScale);
    if (persist) {
      this.queueSave();
      if (getLang() !== langBefore && this.state === 'settings') this.ui.showSettings(s);
    }
  }

  private rebind(a: Action, done: (label: string) => void): void {
    this.input.waitForRebind((code) => {
      if (code !== 'Escape') this.input.rebind(a, code);
      this.save.bindings = { ...this.input.bindings };
      this.queueSave();
      done(this.bindingLabel(a));
    });
  }

  bindingLabel(a: Action): string {
    return this.input.bindings[a].map(keyLabel).join(' / ');
  }

  queueSave(): void {
    this.saveTimer = 0.3;
  }

  private dailyBestToday(): number {
    return this.save.stats.dailyDate === dailySeed() ? this.save.stats.dailyBest : 0;
  }

  // ---------- simulation ----------
  private buildCommand(dt: number): PlayerCommand {
    const w = this.world!;
    const s = this.save.settings;
    const axes = this.input.axes();
    const cmd: PlayerCommand = { ...EMPTY_COMMAND };
    cmd.forward = axes.forward;
    cmd.strafe = axes.strafe;
    cmd.sneak = this.input.held('sneak');
    cmd.sprint = this.input.held('sprint');
    if (this.firstTickOfFrame) {
      const m = this.input.takeMouse();
      cmd.yawDelta += m.dx * MOUSE_RAD_PER_PX * s.sensitivity;
      cmd.pitchDelta += -m.dy * MOUSE_RAD_PER_PX * s.sensitivity * (s.invertY ? -1 : 1);
    }
    cmd.yawDelta += axes.turn * (this.input.usingPad ? PAD_LOOK_SPEED * s.sensitivity : KEY_TURN_SPEED) * dt;
    cmd.pitchDelta += -axes.lookY * PAD_LOOK_SPEED * s.sensitivity * (s.invertY ? -1 : 1) * dt;
    // Clap: buffered during the last moments of cooldown, denied (with feedback) otherwise.
    const cd = w.player.clapCd;
    if (cd <= 0) cmd.clap = this.input.consume('clap');
    else if (cd > 0.13 && this.input.consume('clap')) cmd.clap = true;
    cmd.throw = this.input.consume('throw');
    return cmd;
  }

  private update(dt: number): void {
    if (this.state === 'playing' && this.world) {
      const cmd = this.buildCommand(dt);
      this.firstTickOfFrame = false;
      const before = { x: this.world.player.x, y: this.world.player.y };
      step(this.world, cmd, dt);
      this.distanceThisLevel += Math.hypot(this.world.player.x - before.x, this.world.player.y - before.y);
      for (const e of this.world.events) this.bus.emit('sim', e);
      this.onboardingTick(dt, cmd);
    }
  }

  private render(alpha: number, frameDt: number): void {
    this.firstTickOfFrame = true;
    this.input.beginFrame();
    this.input.pollPad();
    this.padMenus();
    const paused = this.state === 'paused' || this.state === 'settings' || this.state === 'upgrade' || this.state === 'menu' || this.state === 'dead';
    const scaled = paused ? 0 : frameDt * this.loop.timeScale;
    const w = this.world;
    // Danger for music, vignette, heartbeat.
    let danger = 0;
    if (w && (this.state === 'playing' || this.state === 'dying')) for (const m of w.monsters) danger = Math.max(danger, monsterThreat(w, m));
    if (this.state === 'dying') danger = 1;
    this.view.danger += (danger - this.view.danger) * Math.min(1, frameDt * 3);
    this.audio.update(frameDt, this.state === 'playing' || this.state === 'dying' ? this.view.danger : 0);

    let lookDX = 0;
    let lookDY = 0;
    if (this.state === 'playing') {
      const m = this.input.peekMouse();
      const s = this.save.settings;
      lookDX = m.dx * MOUSE_RAD_PER_PX * s.sensitivity;
      lookDY = -m.dy * MOUSE_RAD_PER_PX * s.sensitivity * (s.invertY ? -1 : 1);
    }
    this.view.render(w && this.state !== 'menu' ? w : null, this.state === 'playing' ? alpha : 1, frameDt, scaled, lookDX, lookDY);

    if (w) {
      const p = w.player;
      this.audio.setListener(p.x, p.y, p.yaw);
      const cdMax = BALANCE.player.clapCooldown * w.mods.clapCooldownMul;
      this.ui.updateHud(w, p.clapCd / cdMax);
      this.ui.drawIndicators(p.x, p.y, p.yaw, this.save.settings.indicators && this.state === 'playing');
      this.ui.setLockHint(this.state === 'playing' && !this.input.pointerLocked && !this.input.usingPad);
    }

    // Timed transitions (real time).
    this.stateTimer += frameDt;
    if (this.state === 'dying') {
      if (this.stateTimer > 0.9) this.loop.timeScale = Math.min(1, this.loop.timeScale + frameDt * 2);
      if (this.stateTimer > 1.5) this.showDeath();
    }
    if (this.state === 'exiting' && this.stateTimer > 1.3) this.showUpgrade();

    if (this.saveTimer > 0) {
      this.saveTimer -= frameDt;
      if (this.saveTimer <= 0) writeSave(this.save);
    }
    this.debug.frame(frameDt);
  }

  /** Gamepad: Start = pause, Back = restart after death, D-pad + A/B in menus. */
  private padMenus(): void {
    const p = this.input.padJustPressed;
    if (!p.size) return;
    const s = this.state;
    if (p.has(9)) {
      if (s === 'playing') return this.pause();
      if (s === 'paused') return this.resume();
    }
    if (s === 'playing' || s === 'dying' || s === 'exiting') return;
    if (s === 'dead' && p.has(8)) {
      this.retry();
      return;
    }
    if (p.has(12) || p.has(14)) this.ui.moveFocus(-1);
    if (p.has(13) || p.has(15)) this.ui.moveFocus(1);
    if (p.has(0)) this.ui.activateFocused();
    if (p.has(1)) {
      if (s === 'settings') this.closeSettings();
      else if (s === 'paused') this.resume();
    }
  }

  // ---------- event reactions (audio / visuals / UI) ----------
  private sub(key: 'sub.growl' | 'sub.scream' | 'sub.beacon' | 'sub.beaconSave' | 'sub.monsterStep' | 'sub.breath' | 'sub.stoneLand', x: number, y: number, kind: 'danger' | 'exit' | 'save' | '', throttle = 1.2): void {
    if (!this.save.settings.subtitles || !this.world) return;
    const now = performance.now() / 1000;
    if ((this.subThrottle.get(key) ?? 0) > now) return;
    this.subThrottle.set(key, now + throttle);
    const p = this.world.player;
    let rel = Math.atan2(y - p.y, x - p.x) - p.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const dir = Math.abs(rel) < Math.PI / 4 ? t('dir.front') : Math.abs(rel) > (3 * Math.PI) / 4 ? t('dir.behind') : rel > 0 ? t('dir.right') : t('dir.left');
    this.ui.subtitle(`${t(key)} ${dir}`, kind);
  }

  private onSound(s: SoundEvent): void {
    const w = this.world!;
    const v = this.view;
    v.echo.paint(w, s, v.time);
    const RED = '#FF3B3B';
    switch (s.kind) {
      case 'step':
        this.audio.play('step', { gain: 0.32, reverb: 0.25 });
        break;
      case 'sneakStep':
        this.audio.play('sneakStep', { gain: 0.5, reverb: 0.1 });
        break;
      case 'sprintStep':
        this.audio.play('sprintStep', { gain: 0.5, reverb: 0.35 });
        break;
      case 'pant':
        this.audio.play('pant', { gain: 0.8, reverb: 0.2 });
        break;
      case 'clap':
        this.audio.play('clap', { gain: 0.9, reverb: 1 });
        this.audio.duck(6, 0.35);
        v.addTrauma(0.22);
        v.punchFov(-3);
        v.shockwave();
        v.aberration(0.5);
        break;
      case 'clapEcho':
        this.audio.play('clap', { gain: 0.18, reverb: 1.4 });
        break;
      case 'throw':
        this.audio.play('throw', { gain: 0.7 });
        break;
      case 'stoneLand':
        this.audio.play('stoneLand', { x: s.x, y: s.y, gain: 1 });
        this.ui.indicator(s.x, s.y, '#B388FF', 1.2);
        this.sub('sub.stoneLand', s.x, s.y, '');
        break;
      case 'monsterStep':
        this.audio.play('monsterStep', { x: s.x, y: s.y, gain: 0.9 });
        this.ui.indicator(s.x, s.y, RED, 0.9);
        this.sub('sub.monsterStep', s.x, s.y, 'danger', 2.5);
        break;
      case 'growl':
        this.audio.play('growl', { x: s.x, y: s.y, gain: 1 });
        this.ui.indicator(s.x, s.y, RED, 1.6);
        this.sub('sub.growl', s.x, s.y, 'danger');
        break;
      case 'breath':
        this.audio.play('breath', { x: s.x, y: s.y, gain: 1 });
        this.ui.indicator(s.x, s.y, RED, 1.4);
        this.sub('sub.breath', s.x, s.y, 'danger', 3);
        break;
      case 'scream':
        this.audio.play('scream', { x: s.x, y: s.y, gain: 1 });
        this.audio.duck(9, 0.8);
        v.addTrauma(0.4);
        v.flashScreen(0xff2020, 0.12);
        v.aberration(0.9);
        this.ui.indicator(s.x, s.y, RED, 2);
        this.sub('sub.scream', s.x, s.y, 'danger', 0.5);
        break;
      case 'beacon':
        if (w.checkpoint) {
          this.audio.play('beaconSave', { x: s.x, y: s.y, gain: 0.9, reverb: 0.9 });
          this.ui.indicator(s.x, s.y, '#5CFF9D', 1.8);
          this.sub('sub.beaconSave', s.x, s.y, 'save', 6);
        } else {
          this.audio.play('beacon', { x: s.x, y: s.y, gain: 0.85, reverb: 0.8 });
          this.ui.indicator(s.x, s.y, '#FFC94D', 1.8);
          this.sub('sub.beacon', s.x, s.y, 'exit', 6);
        }
        break;
    }
  }

  private onSimEvent(e: SimEvent): void {
    const w = this.world;
    if (!w) return;
    const v = this.view;
    switch (e.type) {
      case 'sound':
        this.onSound(e.sound);
        break;
      case 'noticed':
        this.audio.play('notice', { x: e.x, y: e.y, gain: 1 });
        v.addTrauma(0.3);
        v.aberration(0.7);
        {
          const m = w.monsters.find((mo) => mo.id === e.monsterId);
          if (m) v.echo.monsterBody(m, v.time, 1.3, 2, 110);
        }
        break;
      case 'pickup':
        this.audio.play('pickup', { gain: 0.8, reverb: 0.3 });
        if (!this.save.seen.throw) this.ui.hint('throw', this.bindingLabel('throw').split(' / ')[0], t('hint.throw'));
        v.echo.burst(e.x, e.y, PALETTE.pickup, v.time, 30);
        break;
      case 'clapDenied':
      case 'throwDenied':
        this.audio.ui('denied');
        break;
      case 'exhausted':
        v.aberration(0.4);
        break;
      case 'death': {
        this.lastDeath = e;
        this.setState('dying');
        this.loop.hitStop(0.08);
        this.loop.timeScale = 0.3;
        if (this.save.settings.screamer) {
          // Jump scare: the face slams into the camera with a shriek, then the kill-cam turns to the body.
          this.audio.play('screamer', { gain: 1, reverb: 0.3 });
          this.audio.play('death', { gain: 0.6, reverb: 0.8, delay: 0.5 });
          this.audio.duck(18, 1.2);
          v.screamer();
        } else {
          this.audio.play('death', { gain: 1, reverb: 0.8 });
          v.flashScreen(0xff1a1a, 0.55);
          v.aberration(1.2);
          v.addTrauma(0.8);
        }
        v.startKillCam(e.x, e.y);
        const m = w.monsters.find((mo) => mo.id === e.killerId);
        if (m) v.echo.monsterBody(m, v.time, 1.6, 6, 220);
        this.input.exitPointerLock();
        this.ui.clearHints();
        break;
      }
      case 'exit':
        this.setState('exiting');
        if (e.checkpoint) {
          this.audio.play('save', { gain: 0.9, reverb: 1 });
          v.flashScreen(0x5cff9d, 0.35);
          this.ui.toast(t('toast.saved').toUpperCase(), 2200, 'save');
        } else {
          this.audio.play('exit', { gain: 0.9, reverb: 1 });
          v.flashScreen(0xffc94d, 0.3);
        }
        v.startExitCam();
        v.echo.exitShape(w, v.time, 1.4, 3, 260);
        this.ui.clearHints();
        break;
    }
  }

  private showDeath(): void {
    const run = this.run!;
    const w = this.world!;
    absorbWorld(run, w);
    const prev = this.save.stats.bestDepth;
    const depth = run.depth;
    this.save.stats.bestDepth = Math.max(prev, depth);
    this.save.stats.deaths++;
    if (run.daily) {
      const today = dailySeed();
      if (this.save.stats.dailyDate !== today) {
        this.save.stats.dailyDate = today;
        this.save.stats.dailyBest = 0;
      }
      this.save.stats.dailyBest = Math.max(this.save.stats.dailyBest, depth);
    }
    this.queueSave();
    this.setState('dead');
    this.loop.timeScale = 1;
    this.ui.showHud(false);
    const killer = this.lastDeath?.type === 'death' ? this.lastDeath.kind : 'stalker';
    this.ui.showDeath({
      depth,
      best: this.save.stats.bestDepth,
      newBest: depth > prev && prev > 0,
      killer,
      checkpointDepth: this.save.checkpoint?.depth ?? 0,
      panting: w.player.exhausted || w.player.pantT > 0,
      ...run.totals,
    });
  }

  private showUpgrade(): void {
    const run = this.run!;
    absorbWorld(run, this.world!);
    this.save.stats.bestDepth = Math.max(this.save.stats.bestDepth, run.depth + 1);
    // Green beacon: save the run so a death later restarts from the next depth.
    this.clearedCheckpoint = this.world!.checkpoint;
    if (this.clearedCheckpoint) this.save.checkpoint = checkpointFromRun(run, run.depth + 1);
    this.queueSave();
    this.setState('upgrade');
    this.input.exitPointerLock();
    this.ui.showHud(false);
    this.ui.showUpgrade(run.depth, rollUpgrades(run));
  }

  // ---------- onboarding (no text walls: a key glyph and two words, then it fades) ----------
  private onboardingStart(): void {
    const w = this.world!;
    const seen = this.save.seen;
    if (!seen.move) this.ui.hint('move', 'WASD', t('hint.move'));
    if (w.depth === 2 && !seen.sneak) this.ui.hint('sneak', this.bindingLabel('sneak').split(' / ')[0], t('hint.sneak'));
    if (w.depth === 3 && !seen.sprint) this.ui.hint('sprint', this.bindingLabel('sprint').split(' / ')[0], t('hint.sprint'));
    if (w.checkpoint && !seen.checkpoint) this.ui.hint('checkpoint', '◆', t('hint.checkpoint'), 'save');
    if (w.depth >= 2 && !seen.throw && w.player.stones > 0) this.ui.hint('throw', this.bindingLabel('throw').split(' / ')[0], t('hint.throw'));
  }

  private onboardingTick(dt: number, cmd: PlayerCommand): void {
    const seen = this.save.seen;
    const w = this.world!;
    this.hintTimer += dt;
    if (!seen.move && this.distanceThisLevel > 2.5) {
      seen.move = true;
      this.ui.dismissHint('move');
      this.queueSave();
    }
    if (!seen.clap && (seen.move || this.hintTimer > 4) && this.hintTimer > 1.5) this.ui.hint('clap', this.bindingLabel('clap').split(' / ')[0], t('hint.clap'));
    if (!seen.clap && cmd.clap) {
      seen.clap = true;
      this.ui.dismissHint('clap');
      this.queueSave();
      if (w.depth === 1) this.ui.hint('exit', '♪', t('hint.exit'), 'gold');
      setTimeout(() => this.ui.dismissHint('exit'), 6000);
    }
    if (!seen.sneak && cmd.sneak && this.distanceThisLevel > 0) {
      seen.sneak = true;
      this.ui.dismissHint('sneak');
      this.queueSave();
    }
    if (!seen.sprint && w.player.sprinting) {
      seen.sprint = true;
      this.ui.dismissHint('sprint');
      this.queueSave();
    }
    if (!seen.checkpoint && w.checkpoint && this.hintTimer > 7) {
      seen.checkpoint = true;
      this.ui.dismissHint('checkpoint');
      this.queueSave();
    }
    if (!seen.throw && cmd.throw) {
      seen.throw = true;
      this.ui.dismissHint('throw');
      this.queueSave();
    }
  }
}
