/**
 * Procedural SFX recipes. Each recipe only needs a BaseAudioContext and an output node, so the same
 * code runs live and inside an OfflineAudioContext (used to measure peaks/RMS in tests).
 * Pitch is varied ±3–8 % per call so repeated sounds never feel copy-pasted.
 */
export type SfxName =
  | 'step'
  | 'sneakStep'
  | 'clap'
  | 'throw'
  | 'stoneLand'
  | 'monsterStep'
  | 'growl'
  | 'breath'
  | 'scream'
  | 'beacon'
  | 'pickup'
  | 'denied'
  | 'exit'
  | 'death'
  | 'notice'
  | 'heartbeat'
  | 'uiMove'
  | 'uiConfirm';

export const SFX_NAMES: SfxName[] = [
  'step', 'sneakStep', 'clap', 'throw', 'stoneLand', 'monsterStep', 'growl', 'breath', 'scream',
  'beacon', 'pickup', 'denied', 'exit', 'death', 'notice', 'heartbeat', 'uiMove', 'uiConfirm',
];

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

interface Env {
  a: number; // attack s
  d: number; // decay s (exponential-ish)
  peak: number;
}

function envGain(ctx: BaseAudioContext, t: number, e: Env): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(e.peak, t + e.a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + e.a + e.d);
  return g;
}

function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  e: Env,
  filter: { type: BiquadFilterType; freq: number; q?: number; freqEnd?: number },
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.playbackRate.value = 1;
  const f = ctx.createBiquadFilter();
  f.type = filter.type;
  f.frequency.setValueAtTime(filter.freq, t);
  if (filter.freqEnd) f.frequency.exponentialRampToValueAtTime(filter.freqEnd, t + e.a + e.d);
  f.Q.value = filter.q ?? 0.7;
  const g = envGain(ctx, t, e);
  src.connect(f).connect(g).connect(out);
  const offset = (t * 7.31) % 1.5;
  src.start(t, offset, e.a + e.d + 0.05);
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  type: OscillatorType,
  freq: number,
  e: Env,
  freqEnd?: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + e.a + e.d);
  const g = envGain(ctx, t, e);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + e.a + e.d + 0.05);
  return o;
}

/** FM bell: carrier + modulator with decaying index. */
function bell(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, peak: number, decay: number): void {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * 1.4;
  modGain.gain.setValueAtTime(freq * 2.2, t);
  modGain.gain.exponentialRampToValueAtTime(1, t + decay);
  mod.connect(modGain).connect(car.frequency);
  const g = envGain(ctx, t, { a: 0.004, d: decay, peak });
  car.connect(g).connect(out);
  car.start(t);
  mod.start(t);
  car.stop(t + decay + 0.1);
  mod.stop(t + decay + 0.1);
}

/** Returns the approximate tail length (s). `vary` is a random number in [0, 1). */
export function playRecipe(ctx: BaseAudioContext, out: AudioNode, name: SfxName, t: number, vary: number): number {
  const p = 1 + (vary - 0.5) * 0.12; // ±6 % pitch
  switch (name) {
    case 'step':
      noiseBurst(ctx, out, t, { a: 0.004, d: 0.09, peak: 0.42 }, { type: 'bandpass', freq: 520 * p, q: 1.1 });
      tone(ctx, out, t, 'sine', 95 * p, { a: 0.003, d: 0.08, peak: 0.22 }, 55);
      return 0.15;
    case 'sneakStep':
      noiseBurst(ctx, out, t, { a: 0.01, d: 0.07, peak: 0.12 }, { type: 'bandpass', freq: 380 * p, q: 1.4 });
      return 0.12;
    case 'clap':
      noiseBurst(ctx, out, t, { a: 0.001, d: 0.05, peak: 0.6 }, { type: 'highpass', freq: 900 * p });
      noiseBurst(ctx, out, t + 0.006, { a: 0.001, d: 0.12, peak: 0.35 }, { type: 'bandpass', freq: 1700 * p, q: 2.5 });
      return 0.3;
    case 'throw':
      noiseBurst(ctx, out, t, { a: 0.05, d: 0.18, peak: 0.16 }, { type: 'bandpass', freq: 600 * p, q: 3, freqEnd: 2200 * p });
      return 0.3;
    case 'stoneLand':
      noiseBurst(ctx, out, t, { a: 0.001, d: 0.04, peak: 0.5 }, { type: 'highpass', freq: 1800 * p });
      tone(ctx, out, t, 'sine', 2300 * p, { a: 0.001, d: 0.12, peak: 0.12 });
      tone(ctx, out, t + 0.09, 'sine', 1900 * p, { a: 0.001, d: 0.08, peak: 0.07 });
      noiseBurst(ctx, out, t + 0.1, { a: 0.001, d: 0.03, peak: 0.22 }, { type: 'highpass', freq: 2200 * p });
      return 0.35;
    case 'monsterStep':
      tone(ctx, out, t, 'sine', 70 * p, { a: 0.004, d: 0.18, peak: 0.45 }, 38);
      noiseBurst(ctx, out, t, { a: 0.004, d: 0.12, peak: 0.25 }, { type: 'lowpass', freq: 260 * p });
      return 0.25;
    case 'growl': {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(62 * p, t);
      o.frequency.linearRampToValueAtTime(48 * p, t + 1.1);
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 11 * p;
      lfoG.gain.value = 0.5;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      f.Q.value = 4;
      const g = envGain(ctx, t, { a: 0.15, d: 1.0, peak: 0.42 });
      const trem = ctx.createGain();
      trem.gain.value = 0.5;
      lfo.connect(lfoG).connect(trem.gain);
      o.connect(f).connect(trem).connect(g).connect(out);
      o.start(t);
      lfo.start(t);
      o.stop(t + 1.25);
      lfo.stop(t + 1.25);
      noiseBurst(ctx, out, t, { a: 0.2, d: 0.9, peak: 0.1 }, { type: 'bandpass', freq: 300, q: 2 });
      return 1.3;
    }
    case 'breath':
      noiseBurst(ctx, out, t, { a: 0.6, d: 0.9, peak: 0.13 }, { type: 'bandpass', freq: 380 * p, q: 3, freqEnd: 900 * p });
      return 1.6;
    case 'scream': {
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      car.type = 'sawtooth';
      car.frequency.setValueAtTime(520 * p, t);
      car.frequency.exponentialRampToValueAtTime(1150 * p, t + 0.25);
      car.frequency.exponentialRampToValueAtTime(380 * p, t + 0.9);
      mod.frequency.value = 233 * p;
      mg.gain.value = 420;
      mod.connect(mg).connect(car.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1400;
      f.Q.value = 0.8;
      const g = envGain(ctx, t, { a: 0.03, d: 0.9, peak: 0.34 });
      car.connect(f).connect(g).connect(out);
      car.start(t);
      mod.start(t);
      car.stop(t + 1);
      mod.stop(t + 1);
      return 1.1;
    }
    case 'beacon':
      bell(ctx, out, t, 880 * (1 + (vary - 0.5) * 0.02), 0.16, 1.6);
      bell(ctx, out, t + 0.12, 1318.5, 0.08, 1.4);
      return 1.8;
    case 'pickup':
      bell(ctx, out, t, 1046.5 * p, 0.15, 0.4);
      bell(ctx, out, t + 0.07, 1568 * p, 0.12, 0.5);
      return 0.6;
    case 'denied':
      tone(ctx, out, t, 'triangle', 180, { a: 0.005, d: 0.08, peak: 0.12 }, 140);
      return 0.12;
    case 'exit':
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(ctx, out, t + i * 0.09, f, 0.13, 1.6));
      return 2.2;
    case 'death':
      tone(ctx, out, t, 'sine', 90, { a: 0.002, d: 0.9, peak: 0.6 }, 30);
      noiseBurst(ctx, out, t, { a: 0.002, d: 0.6, peak: 0.42 }, { type: 'lowpass', freq: 1800, freqEnd: 120 });
      tone(ctx, out, t + 0.05, 'sawtooth', 440, { a: 0.02, d: 1.4, peak: 0.08 }, 55);
      return 1.6;
    case 'notice':
      tone(ctx, out, t, 'sawtooth', 110 * p, { a: 0.01, d: 0.35, peak: 0.18 }, 70);
      noiseBurst(ctx, out, t, { a: 0.005, d: 0.25, peak: 0.2 }, { type: 'bandpass', freq: 700, q: 2 });
      return 0.45;
    case 'heartbeat':
      tone(ctx, out, t, 'sine', 58, { a: 0.006, d: 0.12, peak: 0.5 }, 42);
      tone(ctx, out, t + 0.17, 'sine', 52, { a: 0.006, d: 0.14, peak: 0.36 }, 40);
      return 0.4;
    case 'uiMove':
      tone(ctx, out, t, 'sine', 1200 * p, { a: 0.002, d: 0.04, peak: 0.07 });
      return 0.06;
    case 'uiConfirm':
      tone(ctx, out, t, 'sine', 880, { a: 0.002, d: 0.08, peak: 0.1 });
      tone(ctx, out, t + 0.05, 'sine', 1320, { a: 0.002, d: 0.12, peak: 0.09 });
      return 0.2;
  }
}

export interface LevelReport {
  name: SfxName;
  peakDb: number;
  rmsDb: number;
}

/** Renders every recipe offline and measures it — used by the smoke test to keep peaks below -1 dBFS. */
export async function measureAll(): Promise<LevelReport[]> {
  const out: LevelReport[] = [];
  for (const name of SFX_NAMES) {
    const ctx = new OfflineAudioContext(1, 44100 * 3, 44100);
    playRecipe(ctx, ctx.destination, name, 0.01, 0.99);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      if (v > 1e-4) {
        sum += v * v;
        n++;
      }
    }
    const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -120);
    out.push({ name, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, n))) });
  }
  return out;
}
