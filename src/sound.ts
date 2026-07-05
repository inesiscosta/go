/**
 * Sound effects, synthesised with the Web Audio API (no audio files).
 *
 *  - stone:   a short wooden "clack" (filtered noise burst + low body tone)
 *  - capture: a few small clicks, like stones dropped into a bowl
 *  - pass:    a soft low tone
 *  - end:     a two-note chime, rising for a win, falling for a loss
 *
 * The mute choice is remembered in localStorage when it's available.
 */

const STORAGE_KEY = 'go:muted';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {}
  listeners.forEach((l) => l(value));
}

export function onMutedChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Browsers only allow audio after a user gesture; create the context lazily. */
function audio(): AudioContext | null {
  if (muted || typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function click(ac: AudioContext, at: number, freq: number, gain: number, decay: number) {
  const src = ac.createBufferSource();
  src.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const env = ac.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(band).connect(env).connect(ac.destination);
  src.start(at);
  src.stop(at + decay + 0.02);
}

function tone(ac: AudioContext, at: number, freq: number, gain: number, decay: number, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(env).connect(ac.destination);
  osc.start(at);
  osc.stop(at + decay + 0.02);
}

const jitter = (x: number, amount = 0.08) => x * (1 + (Math.random() * 2 - 1) * amount);

export const sounds = {
  stone() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    click(ac, t, jitter(2400), 0.9, 0.045);
    tone(ac, t, jitter(190), 0.35, 0.09, 'triangle');
  },

  capture(count: number) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.12;
    const n = Math.min(count, 5);
    for (let i = 0; i < n; i++) click(ac, t + i * jitter(0.07, 0.3), jitter(3600, 0.15), 0.45, 0.035);
  },

  pass() {
    const ac = audio();
    if (!ac) return;
    tone(ac, ac.currentTime, 330, 0.12, 0.35);
  },

  end(result: 'win' | 'loss' | 'neutral') {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.15;
    const [a, b] = result === 'loss' ? [523.25, 392] : [523.25, 783.99]; // C5→G4 or C5→G5
    tone(ac, t, a, 0.16, 0.5);
    tone(ac, t + 0.16, b, 0.16, 0.8);
  },
};
