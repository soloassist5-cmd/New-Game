import { playRecipe, type SfxName } from './sfx';
import { clamp } from '../core/math';

/**
 * Audio graph:
 *   sources ─► [panner] ─► bus(sfx|ui|music|amb) ─► master ─► limiter ─► destination
 *                    └──► reverb send ─► convolver ─┘
 * Music is ducked under loud events. Silence is a feature: the drone is deliberately quiet.
 */
export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ui: number;
}

const EYE = 1.6;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: { sfx: GainNode; ui: GainNode; music: GainNode; amb: GainNode };
  private duckGain!: GainNode;
  private reverbSend!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private droneGain!: GainNode;
  private windGain!: GainNode;
  private shimmerGain!: GainNode;
  private heartT = 0;
  private intensity = 0;
  private rand = 0.5;
  muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(limiter);

    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);

    const bus = (to: AudioNode): GainNode => {
      const g = ctx.createGain();
      g.connect(to);
      return g;
    };
    this.buses = { sfx: bus(this.master), ui: bus(this.master), music: bus(this.duckGain), amb: bus(this.duckGain) };

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 2.6, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(convolver).connect(this.master);

    this.startDrone(ctx);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  }

  private makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    let seed = 99;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const n = (seed / 4294967296) * 2 - 1;
        d[i] = n * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  private startDrone(ctx: AudioContext): void {
    // Low drone: two detuned saws through a lowpass that opens with danger.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 140;
    this.droneFilter.Q.value = 2;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.06;
    this.droneFilter.connect(this.droneGain).connect(this.buses.music);
    for (const f of [41.2, 41.7, 61.9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start();
    }
    // Air: filtered noise, very quiet.
    const n = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 260;
    nf.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.035;
    n.connect(nf).connect(this.windGain).connect(this.buses.amb);
    n.start();
    // Shimmer: a high, slowly beating pair that only appears near danger.
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    this.shimmerGain.connect(this.buses.music);
    for (const f of [1244.5, 1247.5]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(this.shimmerGain);
      o.start();
    }
  }

  setVolumes(v: Volumes): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : v.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(v.music, t, 0.05);
    this.buses.amb.gain.setTargetAtTime(v.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(v.ui, t, 0.05);
  }

  /** World (x, y) on the ground plane; yaw: forward = (cos, sin). */
  setListener(x: number, y: number, yaw: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const fx = Math.cos(yaw);
    const fz = Math.sin(yaw);
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(EYE, t);
      l.positionZ.setValueAtTime(y, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(0, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, EYE, y);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Play a recipe. With a position it is spatialised (HRTF) and sent to the reverb. */
  play(name: SfxName, opts: { x?: number; y?: number; bus?: 'sfx' | 'ui'; gain?: number; reverb?: number; delay?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.rand = (this.rand * 9301 + 49297) % 233280 / 233280;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    const bus = this.buses[opts.bus ?? 'sfx'];
    let head: AudioNode = g;
    if (opts.x !== undefined && opts.y !== undefined) {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = 1.5;
      pan.rolloffFactor = 1.1;
      pan.maxDistance = 60;
      if (pan.positionX) {
        pan.positionX.value = opts.x;
        pan.positionY.value = 0.8;
        pan.positionZ.value = opts.y;
      } else {
        pan.setPosition(opts.x, 0.8, opts.y);
      }
      g.connect(pan);
      head = pan;
    }
    head.connect(bus);
    const send = ctx.createGain();
    send.gain.value = opts.reverb ?? (opts.bus === 'ui' ? 0 : 0.5);
    head.connect(send).connect(this.reverbSend);
    const tail = playRecipe(ctx, g, name, t, this.rand);
    // Disconnect after the tail so nodes can be collected.
    setTimeout(() => {
      try {
        g.disconnect();
        head.disconnect();
        send.disconnect();
      } catch {
        /* already gone */
      }
    }, (tail + 3 + (opts.delay ?? 0)) * 1000);
  }

  ui(name: 'uiMove' | 'uiConfirm' | 'denied'): void {
    this.play(name, { bus: 'ui', reverb: 0 });
  }

  /** Lower music/ambience briefly under a loud event. amount in dB. */
  duck(db: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(Math.pow(10, -db / 20), t, 0.02);
    g.setTargetAtTime(1, t + seconds, 0.25);
  }

  /** 0..1 danger → drone filter/volume, shimmer, heartbeat rate. Call every frame. */
  update(dt: number, danger: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.intensity += (danger - this.intensity) * Math.min(1, dt * 2.5);
    const k = this.intensity;
    const t = ctx.currentTime;
    this.droneFilter.frequency.setTargetAtTime(140 + 700 * k * k, t, 0.1);
    this.droneGain.gain.setTargetAtTime(0.05 + 0.09 * k, t, 0.2);
    this.windGain.gain.setTargetAtTime(0.035 * (1 - 0.6 * k), t, 0.3);
    this.shimmerGain.gain.setTargetAtTime(0.012 * clamp((k - 0.4) / 0.6, 0, 1), t, 0.3);
    if (k > 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.1 - 0.6 * k;
        this.play('heartbeat', { bus: 'sfx', gain: 0.4 + 0.5 * k, reverb: 0 });
      }
    } else {
      this.heartT = 0;
    }
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    this.ctx?.resume().catch(() => undefined);
  }
}
