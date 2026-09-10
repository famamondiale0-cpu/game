/**
 * SaveSystem.js - Serializzazione JSON, slot multipli e persistenza localStorage.
 *
 * SCHEMA DEL SALVATAGGIO (versionato, retrocompatibile):
 * {
 *   schema:  'zenithblock.save',
 *   version: '1.0.0',
 *   savedAt: <timestamp ms>,
 *   meta:    { level, turn, score, population, happiness, height, name },
 *   state: {
 *     rng:      { seed, state },
 *     turn:     <n>,  level: <n>,  best: <n>,
 *     grid:     { cols, rows, cells:[{ i,t,c,r,h,b,p }] },
 *     economy:  { coins, score, pollution, totalEarned, totalSpent, finesPaid },
 *     weather:  { hour, day, condition, wind, windDir, timer, nextChange },
 *     events:   { turnsToEvent, timedEffects, history },
 *     hand:     ['RES','PAR',...],
 *     queue:    ['COM',...]
 *   }
 * }
 */

import { CONFIG } from '../config/Config.js';
import { EVT } from '../utils/EventBus.js';

const SCHEMA = 'zenithblock.save';

export class SaveSystem {
  constructor(bus) {
    this.bus = bus;
    this.available = this._probe();
  }

  _probe() {
    try {
      const k = '__zb_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (err) {
      console.warn('[SaveSystem] localStorage non disponibile, salvataggi disattivati.');
      return false;
    }
  }

  _key(slot) { return CONFIG.SAVE.KEY + '.slot' + slot; }

  /** Costruisce il pacchetto completo a partire dallo stato di gioco. */
  build(state, meta) {
    return {
      schema: SCHEMA,
      version: CONFIG.VERSION,
      savedAt: Date.now(),
      meta,
      state
    };
  }

  validate(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.schema !== SCHEMA) return false;
    if (!data.state || !data.state.grid) return false;
    return true;
  }

  save(slot, state, meta) {
    if (!this.available) return { ok: false, error: 'storage non disponibile' };
    try {
      const pack = this.build(state, meta);
      window.localStorage.setItem(this._key(slot), JSON.stringify(pack));
      this.bus.emit(EVT.SAVED, { slot, meta });
      this.bus.emit(EVT.LOG, { text: 'Partita salvata nello slot ' + (slot + 1), kind: 'good' });
      return { ok: true, pack };
    } catch (err) {
      console.error('[SaveSystem] salvataggio fallito', err);
      this.bus.emit(EVT.LOG, { text: 'Salvataggio fallito: ' + err.message, kind: 'bad' });
      return { ok: false, error: err.message };
    }
  }

  load(slot) {
    if (!this.available) return null;
    try {
      const raw = window.localStorage.getItem(this._key(slot));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!this.validate(data)) {
        this.bus.emit(EVT.LOG, { text: 'Slot ' + (slot + 1) + ' corrotto o incompatibile.', kind: 'bad' });
        return null;
      }
      return data;
    } catch (err) {
      console.error('[SaveSystem] caricamento fallito', err);
      return null;
    }
  }

  /** Metadati di tutti gli slot, per il menu di caricamento. */
  listSlots() {
    const out = [];
    for (let i = 0; i < CONFIG.SAVE.SLOTS; i++) {
      const data = this.load(i);
      out.push(data
        ? { slot: i, empty: false, meta: data.meta || {}, savedAt: data.savedAt, version: data.version }
        : { slot: i, empty: true });
    }
    return out;
  }

  deleteSlot(slot) {
    if (!this.available) return false;
    window.localStorage.removeItem(this._key(slot));
    this.bus.emit(EVT.LOG, { text: 'Slot ' + (slot + 1) + ' cancellato.', kind: 'info' });
    return true;
  }

  hasSlot(slot) {
    if (!this.available) return false;
    return window.localStorage.getItem(this._key(slot)) !== null;
  }

  /** Record personale, indipendente dagli slot. */
  saveBest(score) {
    if (!this.available) return score;
    const best = Math.max(this.loadBest(), Math.round(score));
    window.localStorage.setItem(CONFIG.SAVE.KEY + '.best', String(best));
    return best;
  }

  loadBest() {
    if (!this.available) return 0;
    return parseInt(window.localStorage.getItem(CONFIG.SAVE.KEY + '.best') || '0', 10) || 0;
  }

  /** Preferenze UI (audio, ecc.) separate dagli slot partita. */
  savePrefs(prefs) {
    if (!this.available) return;
    window.localStorage.setItem(CONFIG.SAVE.KEY + '.prefs', JSON.stringify(prefs));
  }

  loadPrefs() {
    if (!this.available) return {};
    try { return JSON.parse(window.localStorage.getItem(CONFIG.SAVE.KEY + '.prefs') || '{}'); }
    catch (err) { return {}; }
  }

  /** Esporta la partita come stringa JSON (per backup o condivisione). */
  exportJSON(state, meta) {
    return JSON.stringify(this.build(state, meta), null, 2);
  }

  importJSON(text) {
    try {
      const data = JSON.parse(text);
      return this.validate(data) ? data : null;
    } catch (err) {
      return null;
    }
  }
}
