import { playRecipe, type SfxName } from '../audio/sfx';

export interface AudioCue {
  t: number; // s
  name: SfxName;
  pan: number; // -1..1
  gain: number;
}

/**
 * Offline mix of the trailer: every cue is rendered with the game's own procedural recipes, plus a
 * low drone bed that swells in the chase. Output: 16-bit stereo WAV, base64.
 */
export async function renderTrailerAudio(cues: AudioCue[], duration: number): Promise<string> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * duration), sr);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(limiter).connect(ctx.destination);

  // Reverb send (same idea as the game's convolver).
  const conv = ctx.createConvolver();
  const len = sr * 2.4;
  const ir = ctx.createBuffer(2, len, sr);
  let seed = 7;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
  }
  conv.buffer = ir;
  const send = ctx.createGain();
  send.gain.value = 0.3;
  send.connect(conv).connect(master);

  // Drone bed: quiet, opening up during the chase (18.5–23.3 s), silent on the title cards.
  const droneF = ctx.createBiquadFilter();
  droneF.type = 'lowpass';
  droneF.Q.value = 2;
  droneF.frequency.setValueAtTime(140, 0);
  droneF.frequency.linearRampToValueAtTime(140, 18.5);
  droneF.frequency.linearRampToValueAtTime(900, 23);
  droneF.frequency.setValueAtTime(140, 23.4);
  const droneG = ctx.createGain();
  const g = droneG.gain;
  g.setValueAtTime(0.0001, 0);
  g.linearRampToValueAtTime(0.06, 1);
  g.setValueAtTime(0.06, 3.7);
  g.linearRampToValueAtTime(0.0001, 3.9);
  g.setValueAtTime(0.0001, 6.4);
  g.linearRampToValueAtTime(0.05, 7.2);
  g.linearRampToValueAtTime(0.16, 23);
  g.linearRampToValueAtTime(0.0001, 23.4);
  g.setValueAtTime(0.0001, 23.6);
  g.linearRampToValueAtTime(0.04, 24.5);
  g.linearRampToValueAtTime(0.0001, 26.6);
  droneF.connect(droneG).connect(master);
  for (const f of [41.2, 41.7, 61.9]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(droneF);
    o.start(0);
    o.stop(duration);
  }

  let r = 0.37;
  for (const c of cues) {
    r = (r * 9301 + 49297) % 233280 / 233280;
    const gain = ctx.createGain();
    gain.gain.value = c.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = c.pan;
    gain.connect(pan);
    pan.connect(master);
    pan.connect(send);
    playRecipe(ctx, gain, c.name, Math.max(0.001, c.t), r);
  }

  const buf = await ctx.startRendering();
  return wavBase64(buf);
}

function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = 44 + n * ch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string): void => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  const u8 = new Uint8Array(view.buffer);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
