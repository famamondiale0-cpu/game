/**
 * Random.js - PRNG deterministico (mulberry32).
 * Lo stato e serializzabile: la partita ricaricata riproduce la stessa sequenza.
 */
export class Random {
  constructor(seed = (Date.now() >>> 0)) { this.seed = seed >>> 0; this.state = this.seed; }

  /** float in [0,1) */
  next() {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Estrazione pesata da un oggetto { chiave: peso }. */
  weighted(weights) {
    const entries = Object.entries(weights);
    const total = entries.reduce((s, e) => s + e[1], 0);
    let roll = this.next() * total;
    for (const [key, w] of entries) { roll -= w; if (roll <= 0) return key; }
    return entries[entries.length - 1][0];
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  serialize() { return { seed: this.seed, state: this.state }; }
  deserialize(data) {
    if (!data) return;
    this.seed = data.seed >>> 0;
    this.state = data.state >>> 0;
  }
}

/** Istanza per il solo aspetto visivo (dettagli deterministici delle facciate). */
export const visualRng = new Random(0xC0FFEE);

/** Hash stabile -> [0,1): dettagli grafici riproducibili per cella. */
export function hash01(n) {
  let x = Math.imul(n ^ 0x9E3779B9, 0x85EBCA6B);
  x ^= x >>> 13;
  x = Math.imul(x, 0xC2B2AE35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
