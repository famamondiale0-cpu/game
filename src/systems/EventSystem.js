/**
 * EventSystem.js - Disastri ed eventi dinamici.
 *
 * Ogni N turni (con varianza) tira un evento fra:
 *   TERREMOTO  - screen shake + controllo di stabilita, i blocchi deboli crollano
 *   INCENDIO   - si propaga ai vicini se non c'e acqua adiacente o pioggia
 *   ISPEZIONE  - multa se l'inquinamento supera la tolleranza
 *   IMMIGRAZIONE - bonus temporaneo alla resa dei residenziali
 *   SOVVENZIONE  - contributo statale una tantum
 *
 * Gestisce anche gli effetti persistenti (fuoco attivo, modificatori a scadenza).
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from '../core/BlockFactory.js';
import { EVT } from '../utils/EventBus.js';
import { clamp } from '../utils/Utils.js';

export const DISASTERS = {
  QUAKE:       { id: 'QUAKE',       name: 'Terremoto',            icon: '🌋', kind: 'bad' },
  FIRE:        { id: 'FIRE',        name: 'Incendio',             icon: '🔥', kind: 'bad' },
  INSPECTION:  { id: 'INSPECTION',  name: 'Ispezione ecologica',  icon: '🧪', kind: 'warn' },
  IMMIGRATION: { id: 'IMMIGRATION', name: 'Ondata migratoria',    icon: '🧳', kind: 'good' },
  GRANT:       { id: 'GRANT',       name: 'Sovvenzione statale',  icon: '🏛️', kind: 'good' }
};

export class EventSystem {
  constructor(bus, rng) {
    this.bus = bus;
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.turnsToEvent = CONFIG.EVENTS.START_AFTER;
    this.activeFires = [];
    this.modifiers = { resMultiplier: 1, comMultiplier: 1, indMultiplier: 1 };
    this.timedEffects = [];
    this.history = [];
    this.lastEvent = null;
  }

  get fireCount() { return this.activeFires.length; }

  /** Turni mancanti al prossimo evento (mostrato nella HUD). */
  get countdown() { return Math.max(0, this.turnsToEvent); }

  _schedule() {
    const v = CONFIG.EVENTS.VARIANCE;
    this.turnsToEvent = Math.max(2, CONFIG.EVENTS.EVERY + this.rng.int(-v, v));
  }

  _addTimed(key, value, turns, label) {
    this.timedEffects.push({ key, value, turns, label });
    this.modifiers[key] = value;
  }

  _tickTimed() {
    const still = [];
    for (const eff of this.timedEffects) {
      eff.turns--;
      if (eff.turns > 0) still.push(eff);
      else {
        this.modifiers[eff.key] = 1;
        this.bus.emit(EVT.LOG, { text: 'Effetto terminato: ' + eff.label, kind: 'info' });
      }
    }
    this.timedEffects = still;
  }

  /**
   * Avanzamento di un turno. ctx = { grid, economy, physics, weather, turn }.
   * Ritorna { fires, collapses, event } per log e effetti visivi.
   */
  onTurn(ctx) {
    this._tickTimed();
    const fireResult = this.updateFires(ctx);

    let event = null;
    this.turnsToEvent--;
    if (this.turnsToEvent <= 0) {
      event = this.trigger(ctx);
      this._schedule();
    } else if (ctx.economy.pollution > CONFIG.ECONOMY.POLLUTION_TOLERANCE && this.rng.chance(CONFIG.EVENTS.INSPECTION_EXTRA_CHANCE)) {
      // l'ispezione puo scattare anche fuori cadenza se si inquina troppo
      event = this.trigger(ctx, 'INSPECTION');
    }

    return { ...fireResult, event };
  }

  /** Sceglie ed esegue un evento (eventualmente forzato per id). */
  trigger(ctx, forceId = null) {
    const id = forceId || this._pick(ctx);
    const def = DISASTERS[id];
    if (!def) return null;

    const payload = { id, def, turn: ctx.turn, detail: '' };
    switch (id) {
      case 'QUAKE': this.earthquake(ctx, payload); break;
      case 'FIRE': this.ignite(ctx, payload); break;
      case 'INSPECTION': this.inspection(ctx, payload); break;
      case 'IMMIGRATION': this.immigration(ctx, payload); break;
      case 'GRANT': this.grant(ctx, payload); break;
      default: return null;
    }

    this.lastEvent = payload;
    this.history.push({ turn: ctx.turn, id, detail: payload.detail });
    if (this.history.length > 40) this.history.shift();
    this.bus.emit(EVT.DISASTER, payload);
    this.bus.emit(EVT.LOG, { text: def.icon + ' ' + def.name + ': ' + payload.detail, kind: def.kind });
    return payload;
  }

  /** Pesi dinamici: il rischio dipende dallo stato reale della citta. */
  _pick(ctx) {
    const { grid, economy, physics, weather } = ctx;
    const height = grid.maxHeight();
    const industries = grid.listByType('IND').length + grid.listByType('POW').length;
    const stability = physics.report.stability;

    const weights = {
      QUAKE: 8 + height * 0.8 + (1 - stability) * 14,
      FIRE: 4 + industries * 2.2 + (weather.isRaining ? -3 : 4),
      INSPECTION: economy.pollution > CONFIG.ECONOMY.POLLUTION_TOLERANCE ? 26 : 3,
      IMMIGRATION: 10 + clamp(economy.stats.happiness - 50, 0, 40) * 0.5,
      GRANT: 6 + (economy.coins < 150 ? 10 : 0)
    };
    for (const k of Object.keys(weights)) weights[k] = Math.max(0.5, weights[k]);
    return this.rng.weighted(weights);
  }

  // --- Implementazione dei singoli eventi -----------------------------------

  /** Terremoto: scossa, danni diffusi crescenti con l'altezza, crolli. */
  earthquake(ctx, payload) {
    const { grid, physics, weather } = ctx;
    const power = this.rng.range(0.5, 1) * (1 + grid.maxHeight() / grid.rows);
    const doomed = [];
    const [minD, maxD] = CONFIG.EVENTS.QUAKE_DAMAGE;

    grid.each((cell, col, row) => {
      // piu si e in alto, piu la scossa amplifica
      const heightFactor = 0.35 + (row / grid.rows) * 1.15;
      const supported = grid.supportsBelow(col, row) > 0 ? 0.55 : 1;
      if (!this.rng.chance(CONFIG.EVENTS.QUAKE_HIT_CHANCE)) return;
      const dmg = this.rng.range(minD, maxD) * power * heightFactor * supported;
      if (dmg < 6) return;
      if (physics.damage(cell, dmg, 'terremoto')) doomed.push({ cell, reason: 'terremoto' });
    });

    const collapses = physics.applyCollapses(grid, doomed);
    physics.analyze(grid, weather);
    this.bus.emit(EVT.SHAKE, { power: 14 + power * 12, duration: 1.2 });
    payload.collapses = collapses;
    payload.detail = collapses.length
      ? collapses.length + ' blocchi sono crollati!'
      : 'La struttura ha retto, ma sono comparse crepe.';
  }

  /** Innesca un incendio: preferisce centrali soffocate e industrie. */
  ignite(ctx, payload) {
    const { grid } = ctx;
    const candidates = [];
    grid.each((cell, col, row) => {
      if (cell.burning > 0) return;
      const def = BlockFactory.def(cell.type);
      let w = 1;
      if (cell.type === 'IND') w = 4;
      if (cell.type === 'POW') w = grid.enclosure(col, row) >= 4 ? 12 : 5;
      if (def.suppressesFire) w = 0.2;
      candidates.push({ cell, w });
    });

    if (!candidates.length) { payload.detail = 'Nessun edificio a rischio: allarme rientrato.'; return; }
    const total = candidates.reduce((s, c) => s + c.w, 0);
    let roll = this.rng.next() * total;
    let target = candidates[0].cell;
    for (const c of candidates) { roll -= c.w; if (roll <= 0) { target = c.cell; break; } }

    this.setFire(target, ctx);
    payload.detail = 'Fiamme in ' + BlockFactory.def(target.type).name + ' (col ' + (target.col + 1) + ', liv ' + (target.row + 1) + ')';
    this.bus.emit(EVT.SHAKE, { power: 5 });
  }

  setFire(cell, ctx) {
    if (!cell || cell.burning > 0) return false;
    cell.burning = CONFIG.EVENTS.FIRE_DURATION;
    this.activeFires.push(cell.id);
    this.bus.emit(EVT.FLOATER, { col: cell.col, row: cell.row, text: 'INCENDIO', color: '#ff7043', size: 13 });
    return true;
  }

  extinguish(cell) {
    if (!cell) return;
    cell.burning = 0;
    this.activeFires = this.activeFires.filter((id) => id !== cell.id);
  }

  /**
   * Aggiorna gli incendi attivi: danno, propagazione e spegnimento.
   * Un [WAT] adiacente o la pioggia riducono drasticamente la propagazione.
   */
  updateFires(ctx) {
    const { grid, physics, weather } = ctx;
    if (!this.activeFires.length) return { fires: [], collapses: [] };

    const burning = [];
    grid.each((cell) => { if (cell.burning > 0) burning.push(cell); });
    this.activeFires = burning.map((c) => c.id);
    if (!burning.length) return { fires: [], collapses: [] };

    const doomed = [];
    const newFires = [];

    for (const cell of burning) {
      const neigh = grid.neighborList(cell.col, cell.row);
      const hasWater = neigh.some((n) => BlockFactory.def(n.type).suppressesFire && n.burning === 0);

      // tentativo di spegnimento
      let suppress = 0;
      if (hasWater) suppress += CONFIG.EVENTS.WATER_SUPPRESS;
      if (weather.isRaining) suppress += CONFIG.EVENTS.RAIN_SUPPRESS * (weather.isStorm ? 1.4 : 1);
      if (suppress > 0 && this.rng.chance(clamp(suppress, 0, 0.95))) {
        this.extinguish(cell);
        this.bus.emit(EVT.FLOATER, { col: cell.col, row: cell.row, text: 'SPENTO', color: '#4dd0e1', size: 12 });
        continue;
      }

      if (physics.damage(cell, CONFIG.EVENTS.FIRE_DAMAGE, 'incendio')) {
        doomed.push({ cell, reason: 'incendio' });
        continue;
      }

      cell.burning--;
      if (cell.burning <= 0) { this.extinguish(cell); continue; }

      // propagazione: il vento favorisce la direzione sottovento
      let chance = CONFIG.EVENTS.FIRE_SPREAD_CHANCE;
      if (weather.isRaining) chance *= 0.35;
      if (hasWater) chance *= 0.25;
      chance += weather.wind * 0.12;

      for (const n of neigh) {
        if (n.burning > 0) continue;
        if (BlockFactory.def(n.type).suppressesFire) continue;
        const dirBonus = (n.col - cell.col) * weather.windDir > 0 ? 0.12 : 0;
        if (this.rng.chance(chance + dirBonus)) { if (this.setFire(n, ctx)) newFires.push(n); }
      }
    }

    const collapses = physics.applyCollapses(grid, doomed);
    if (collapses.length) {
      this.bus.emit(EVT.LOG, { text: 'Le fiamme hanno distrutto ' + collapses.length + ' blocchi.', kind: 'bad' });
    }
    return { fires: newFires, collapses };
  }

  /** Ispezione ecologica: multa proporzionale all'eccesso di inquinamento. */
  inspection(ctx, payload) {
    const { economy } = ctx;
    const tolerance = CONFIG.ECONOMY.POLLUTION_TOLERANCE;
    if (economy.pollution <= tolerance) {
      const bonus = Math.round(CONFIG.ECONOMY.FINE_BASE * 0.4);
      economy.earn(bonus);
      payload.detail = 'Citta pulita: premio di ' + bonus + ' monete.';
      return;
    }
    const excess = economy.pollution - tolerance;
    const amount = Math.round(CONFIG.ECONOMY.FINE_BASE * (1 + excess / 25));
    economy.fine(amount, 'inquinamento oltre la soglia');
    economy.addPollution(-excess * 0.25);
    payload.detail = 'Inquinamento ' + Math.round(economy.pollution) + '/' + tolerance + ', multa ' + amount + ' monete.';
    this.bus.emit(EVT.SHAKE, { power: 4 });
  }

  /** Ondata migratoria: i residenziali rendono di piu per alcuni turni. */
  immigration(ctx, payload) {
    const turns = CONFIG.EVENTS.IMMIGRATION_TURNS;
    this._addTimed('resMultiplier', CONFIG.EVENTS.IMMIGRATION_BONUS, turns, 'Ondata migratoria');
    payload.detail = 'Domanda di alloggi x' + CONFIG.EVENTS.IMMIGRATION_BONUS + ' per ' + turns + ' turni.';
  }

  /** Sovvenzione: liquidita immediata, piu generosa se si e in difficolta. */
  grant(ctx, payload) {
    const { economy } = ctx;
    const amount = Math.round(this.rng.range(80, 220) + (economy.coins < 150 ? 120 : 0));
    economy.earn(amount);
    payload.detail = 'Ricevute ' + amount + ' monete dal fondo urbano.';
  }

  serialize() {
    return {
      turnsToEvent: this.turnsToEvent,
      timedEffects: this.timedEffects,
      history: this.history.slice(-20)
    };
  }

  deserialize(data) {
    if (!data) return;
    this.turnsToEvent = data.turnsToEvent ?? CONFIG.EVENTS.START_AFTER;
    this.timedEffects = data.timedEffects || [];
    this.history = data.history || [];
    this.modifiers = { resMultiplier: 1, comMultiplier: 1, indMultiplier: 1 };
    for (const eff of this.timedEffects) this.modifiers[eff.key] = eff.value;
  }
}
