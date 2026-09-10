/**
 * SoundEngine.js - Sintetizzatore procedurale su Web Audio API.
 * Zero file audio: ogni suono e generato da oscillatori, rumore e inviluppi.
 *
 * Catena: [voci] -> sfxGain / musicGain -> compressor -> masterGain -> output
 * Il contesto parte sospeso: init() va chiamato dal primo gesto utente.
 */

import { CONFIG } from '../config/Config.js';
import { clamp } from '../utils/Utils.js';

const NOTE = (semitone) => 220 * Math.pow(2, semitone / 12);

/** Progressioni per fase del giorno: la citta "suona" diversa di notte. */
const PROGRESSIONS = {
  giorno:   [[0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17], [2, 5, 9, 12]],
  alba:     [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [-2, 2, 5, 9]],
  tramonto: [[0, 3, 7, 10], [-3, 0, 4, 7], [-5, -1, 2, 7], [2, 5, 9, 12]],
  notte:    [[-12, -5, 0, 3], [-10, -3, 2, 5], [-12, -5, 0, 7], [-8, -1, 2, 7]]
};

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = 0;
    this.phase = 'giorno';
    this.intensity = 0.5;
  }

  /** Da chiamare al primo click/tasto: i browser bloccano l'audio prima. */
  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : CONFIG.AUDIO.MASTER;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = CONFIG.AUDIO.SFX;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = CONFIG.AUDIO.MUSIC;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.4);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.22;

    this.sfxGain.connect(this.comp);
    this.musicGain.connect(this.comp);
    this.sfxGain.connect(this.reverbGain);
    this.musicGain.connect(this.reverbGain);
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this.noiseBuffer = this._noise(2);
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.ready = true;
    return true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(muted) {
    this.muted = muted;
    if (this.ready) this.master.gain.setTargetAtTime(muted ? 0 : CONFIG.AUDIO.MASTER, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  toggleMute() { return this.setMuted(!this.muted); }

  setMusic(on) {
    this.musicOn = on;
    if (this.ready) this.musicGain.gain.setTargetAtTime(on ? CONFIG.AUDIO.MUSIC : 0, this.ctx.currentTime, 0.1);
  }

  _noise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Riverbero sintetico: rumore con decadimento esponenziale. */
  _impulse(seconds, decay) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** Voce base: oscillatore + inviluppo ADSR semplificato. */
  _tone(opts) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t + (opts.dur || 0.2));

    const peak = (opts.gain === undefined ? 0.3 : opts.gain);
    const dur = opts.dur || 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (opts.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = osc;
    if (opts.filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.setValueAtTime(opts.cutoff || 1200, t);
      if (opts.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.cutoffTo), t + dur);
      f.Q.value = opts.q || 1;
      osc.connect(f); node = f;
    }
    node.connect(gain);
    gain.connect(opts.bus || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Voce rumorosa: usata per impatti, esplosioni, pioggia, tuoni. */
  _noiseBurst(opts) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filter || 'lowpass';
    filter.frequency.setValueAtTime(opts.cutoff || 900, t);
    if (opts.cutoffTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.cutoffTo), t + (opts.dur || 0.3));
    filter.Q.value = opts.q || 0.8;
    const gain = this.ctx.createGain();
    const dur = opts.dur || 0.3;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain || 0.3), t + (opts.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(gain); gain.connect(opts.bus || this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // --- Effetti sonori --------------------------------------------------------

  select() { this._tone({ type: 'triangle', freq: NOTE(12), dur: 0.09, gain: 0.16 }); }

  click() { this._tone({ type: 'square', freq: NOTE(7), freqTo: NOTE(14), dur: 0.07, gain: 0.1 }); }

  /** Piazzamento: pitch piu grave per i blocchi pesanti. */
  place(weight = 25) {
    const p = clamp(1 - weight / 60, 0.1, 1);
    this._tone({ type: 'triangle', freq: NOTE(4 + p * 10), freqTo: NOTE(-2 + p * 8), dur: 0.16, gain: 0.2 });
  }

  /** Impatto al suolo: thump + polvere sonora, scala con il peso. */
  land(weight = 25) {
    const w = clamp(weight / 50, 0.2, 1.4);
    this._tone({ type: 'sine', freq: 150 * (1.4 - w * 0.5), freqTo: 42, dur: 0.22 + w * 0.1, gain: 0.34 });
    this._noiseBurst({ cutoff: 1800, cutoffTo: 240, dur: 0.2 + w * 0.15, gain: 0.16 * w, filter: 'lowpass' });
  }

  coin(count = 1) {
    for (let i = 0; i < Math.min(4, count); i++) {
      this._tone({ type: 'square', freq: NOTE(19 + i * 3), dur: 0.1, gain: 0.09, delay: i * 0.05 });
      this._tone({ type: 'sine', freq: NOTE(26 + i * 3), dur: 0.12, gain: 0.06, delay: i * 0.05 + 0.02 });
    }
  }

  error() {
    this._tone({ type: 'sawtooth', freq: NOTE(1), freqTo: NOTE(-6), dur: 0.22, gain: 0.16, filter: 'lowpass', cutoff: 900 });
  }

  demolish() {
    this._noiseBurst({ cutoff: 2600, cutoffTo: 300, dur: 0.32, gain: 0.28 });
    this._tone({ type: 'sine', freq: 90, freqTo: 38, dur: 0.3, gain: 0.2 });
  }

  collapse(size = 1) {
    this._noiseBurst({ cutoff: 1400, cutoffTo: 90, dur: 0.7 + size * 0.1, gain: 0.4 });
    this._tone({ type: 'sine', freq: 70, freqTo: 28, dur: 0.8, gain: 0.32 });
    this._tone({ type: 'sawtooth', freq: 120, freqTo: 44, dur: 0.5, gain: 0.1, filter: 'lowpass', cutoff: 700, cutoffTo: 120 });
  }

  quake() {
    this._noiseBurst({ cutoff: 320, cutoffTo: 60, dur: 1.5, gain: 0.42, attack: 0.25 });
    this._tone({ type: 'sine', freq: 46, freqTo: 26, dur: 1.6, gain: 0.3, attack: 0.2 });
  }

  fire() {
    this._noiseBurst({ cutoff: 900, cutoffTo: 2400, dur: 0.6, gain: 0.2, filter: 'bandpass', q: 1.4 });
    this._tone({ type: 'sawtooth', freq: NOTE(-5), freqTo: NOTE(6), dur: 0.5, gain: 0.1, filter: 'lowpass', cutoff: 700 });
  }

  thunder() {
    this._noiseBurst({ cutoff: 3000, cutoffTo: 70, dur: 1.8, gain: 0.36, attack: 0.02 });
    this._tone({ type: 'sine', freq: 58, freqTo: 24, dur: 1.6, gain: 0.24, delay: 0.06 });
  }

  rainLoop(intensity) {
    if (!this.ready || this.muted || intensity <= 0) return;
    this._noiseBurst({ cutoff: 2000 + intensity * 3000, dur: 0.5, gain: 0.035 * intensity, filter: 'highpass' });
  }

  levelUp() {
    const arp = [0, 4, 7, 12, 16, 19, 24];
    arp.forEach((n, i) => {
      this._tone({ type: 'triangle', freq: NOTE(n), dur: 0.35, gain: 0.2, delay: i * 0.075 });
      this._tone({ type: 'sine', freq: NOTE(n + 12), dur: 0.3, gain: 0.09, delay: i * 0.075 + 0.02 });
    });
  }

  gameOver() {
    const notes = [0, -3, -7, -12, -17];
    notes.forEach((n, i) => {
      this._tone({ type: 'sawtooth', freq: NOTE(n), dur: 0.7, gain: 0.16, delay: i * 0.22, filter: 'lowpass', cutoff: 1400, cutoffTo: 200 });
    });
    this._noiseBurst({ cutoff: 600, cutoffTo: 60, dur: 2.2, gain: 0.2, delay: 0.3, attack: 0.4 });
  }

  alarm() {
    for (let i = 0; i < 3; i++) {
      this._tone({ type: 'square', freq: NOTE(12), freqTo: NOTE(5), dur: 0.18, gain: 0.13, delay: i * 0.22, filter: 'bandpass', cutoff: 1200, q: 3 });
    }
  }

  // --- Musica procedurale ----------------------------------------------------

  /** Il chiamante aggiorna fase del giorno e intensita (densita della citta). */
  setMood(phase, intensity) {
    this.phase = PROGRESSIONS[phase] ? phase : 'giorno';
    this.intensity = clamp(intensity, 0, 1);
  }

  /** Scheduler a lookahead: chiamato ogni frame dall'Engine. */
  update() {
    if (!this.ready || !this.musicOn || this.muted) return;
    const spb = 60 / CONFIG.AUDIO.BPM;
    const stepDur = spb / 2;                 // ottavi
    const lookahead = 0.25;
    let guard = 0;
    while (this.nextNoteTime < this.ctx.currentTime + lookahead && guard++ < 16) {
      this._playStep(this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step++;
    }
    if (this.nextNoteTime < this.ctx.currentTime) this.nextNoteTime = this.ctx.currentTime + 0.05;
  }

  _playStep(step, time, stepDur) {
    const prog = PROGRESSIONS[this.phase];
    const bar = Math.floor(step / 8) % prog.length;
    const chord = prog[bar];
    const i = step % 8;
    const night = this.phase === 'notte';

    const voice = (freq, type, gain, dur) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(night ? 900 : 2200, time);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(f); f.connect(g); g.connect(this.musicGain);
      osc.start(time); osc.stop(time + dur + 0.05);
    };

    // Basso sul primo e quinto ottavo
    if (i === 0 || i === 4) voice(NOTE(chord[0] - 12), 'sine', 0.18, stepDur * 1.8);

    // Pad in sottofondo a ogni battuta
    if (i === 0) {
      for (const n of chord) voice(NOTE(n - 5), night ? 'triangle' : 'sawtooth', 0.035, stepDur * 7);
    }

    // Arpeggio: piu la citta e densa, piu note suonano
    const density = 0.35 + this.intensity * 0.55;
    if ((i % 2 === 1 || Math.random() < density * 0.4) && Math.random() < density) {
      const n = chord[(i + bar) % chord.length] + (Math.random() < 0.25 ? 12 : 0);
      voice(NOTE(n + 12), 'triangle', 0.07, stepDur * 1.4);
    }
  }
}
