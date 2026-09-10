/**
 * BlockFactory.js - Registro dei tipi di blocco, attributi e MATRICE DI SINERGIA.
 *
 * Ogni definizione descrive in modo dichiarativo cosa il blocco fa da solo
 * (effects) e cosa fa in relazione ai 4 vicini ortogonali (synergy).
 * EconomyEngine e PhysicsSystem leggono solo questi dati: aggiungere un nuovo
 * tipo di blocco non richiede di toccare nessun altro modulo.
 *
 * Schema di una regola di sinergia:
 *   { with: ['PAR','COM'], happiness: +2, coins: 0, label: '...' }
 * Viene applicata UNA VOLTA PER VICINO che soddisfa "with".
 */

import { hash01 } from '../utils/Random.js';

let UID = 1;

export const BLOCK_DEFS = {
  RES: {
    type: 'RES',
    name: 'Residenziale',
    short: 'RES',
    icon: '🏠',
    category: 'abitativo',
    color: '#3E7BFA',
    colorDark: '#1E3F8F',
    colorLight: '#7FB0FF',
    cost: 45,
    upkeep: 1,
    weight: 25,
    capacity: 280,
    effects: { population: 5, energy: -1, water: -1, happiness: 0, pollution: 0, coins: 0 },
    synergy: [
      { with: ['PAR', 'COM'], happiness: 2, label: '+2 Felicita (Parco/Commercio)' },
      { with: ['IND', 'POW'], happiness: -3, label: '-3 Felicita (Industria/Centrale)' }
    ],
    desc: 'Alloggi per i cittadini. Ama il verde, odia le ciminiere.'
  },

  COM: {
    type: 'COM',
    name: 'Commerciale',
    short: 'COM',
    icon: '🏪',
    category: 'economia',
    color: '#F5C42B',
    colorDark: '#A87C05',
    colorLight: '#FFE484',
    cost: 65,
    upkeep: 4,
    weight: 30,
    capacity: 260,
    effects: { coins: 10, energy: -2, population: 0, water: 0, happiness: 1, pollution: 0 },
    synergy: [
      { with: ['RES'], coins: 5, label: '+5 Monete (clienti residenti)' }
    ],
    desc: 'Negozi e uffici: rendono di piu se circondati da residenti.'
  },

  IND: {
    type: 'IND',
    name: 'Industriale',
    short: 'IND',
    icon: '🏭',
    category: 'economia',
    color: '#8A7A63',
    colorDark: '#4A4033',
    colorLight: '#BFAE93',
    cost: 110,
    upkeep: 10,
    weight: 50,
    capacity: 380,
    effects: { coins: 25, pollution: 2, energy: -2, population: 0, water: -1, happiness: 0 },
    synergy: [
      { with: ['IND'], coins: 10, label: '+10 Monete (distretto industriale)' }
    ],
    desc: 'Il motore economico della citta. Pesante e inquinante.'
  },

  PAR: {
    type: 'PAR',
    name: 'Parco',
    short: 'PAR',
    icon: '🌳',
    category: 'ambiente',
    color: '#3FBF6F',
    colorDark: '#1E6E3C',
    colorLight: '#8CE8AC',
    cost: 35,
    upkeep: 1,
    weight: 5,
    capacity: 130,
    effects: { happiness: 10, pollution: -1, coins: 0, energy: 0, water: 0, population: 0 },
    synergy: [],
    requiresSupport: true,
    desc: 'Polmone verde. Richiede un blocco solido sotto di se.'
  },

  POW: {
    type: 'POW',
    name: 'Centrale',
    short: 'POW',
    icon: '⚡',
    category: 'utility',
    color: '#F0762B',
    colorDark: '#A03D06',
    colorLight: '#FFB27A',
    cost: 130,
    upkeep: 6,
    weight: 45,
    capacity: 300,
    effects: { energy: 20, pollution: 3, coins: 0, water: 0, population: 0, happiness: 0 },
    synergy: [],
    ventilated: true,
    desc: 'Produce energia. Se soffocata da 4 vicini rischia l incendio.'
  },

  WAT: {
    type: 'WAT',
    name: 'Serbatoio',
    short: 'WAT',
    icon: '💧',
    category: 'utility',
    color: '#31C8E8',
    colorDark: '#0E6F87',
    colorLight: '#9BEBFA',
    cost: 55,
    upkeep: 3,
    weight: 35,
    capacity: 290,
    effects: { water: 20, coins: 0, energy: 0, population: 0, happiness: 0, pollution: 0 },
    synergy: [],
    suppressesFire: true,
    desc: 'Riserva idrica. Spegne gli incendi nei blocchi adiacenti.'
  },

  SUP: {
    type: 'SUP',
    name: 'Trave',
    short: 'SUP',
    icon: '🔩',
    category: 'struttura',
    color: '#5A6273',
    colorDark: '#262B36',
    colorLight: '#98A2B6',
    cost: 30,
    upkeep: 0,
    weight: 20,
    capacity: 820,
    effects: {},
    synergy: [],
    isSupport: true,
    desc: 'Trave in acciaio: raddoppia la tolleranza al peso della colonna.'
  }
};

export const BLOCK_TYPES = Object.keys(BLOCK_DEFS);

/** Pesi di pescata dal mazzo: i blocchi economici sono piu rari. */
export const DRAW_WEIGHTS = {
  RES: 26, COM: 16, IND: 10, PAR: 16, POW: 9, WAT: 10, SUP: 13
};

export class BlockFactory {
  /** Definizione statica (sola lettura) di un tipo. */
  static def(type) {
    const d = BLOCK_DEFS[type];
    if (!d) throw new Error('[BlockFactory] tipo sconosciuto: ' + type);
    return d;
  }

  static exists(type) { return Object.prototype.hasOwnProperty.call(BLOCK_DEFS, type); }
  static all() { return BLOCK_TYPES.map((t) => BLOCK_DEFS[t]); }
  static cost(type) { return BlockFactory.def(type).cost; }
  static weight(type) { return BlockFactory.def(type).weight; }
  static upkeep(type) {
    const u = BlockFactory.def(type).upkeep;
    return typeof u === 'number' ? u : 1;
  }

  /**
   * Crea un'istanza di cella (lo stato mutabile che vive nella griglia).
   * anim contiene solo dati cosmetici: il render puo ignorarli senza rompere la logica.
   */
  static create(type, col, row, turn = 0) {
    const def = BlockFactory.def(type);
    const id = UID++;
    return {
      id,
      type: def.type,
      col, row,
      integrity: 100,
      burning: 0,
      stress: 0,
      load: 0,
      capacity: def.capacity,
      powered: true,
      watered: true,
      active: true,
      placedTurn: turn,
      seed: hash01(id * 2654435761),
      anim: { fall: 0, vy: 0, sx: 1, sy: 1, flash: 0, glow: 0, born: 0 }
    };
  }

  /** Estrae un tipo casuale usando il PRNG deterministico passato. */
  static randomType(rng, weights = DRAW_WEIGHTS) { return rng.weighted(weights); }

  /** Descrizione leggibile delle regole di sinergia (usata dai tooltip). */
  static synergyText(type) {
    const def = BlockFactory.def(type);
    const lines = def.synergy.map((r) => r.label);
    if (def.requiresSupport) lines.push('Richiede un blocco sotto di se');
    if (def.isSupport) lines.push('x2 tolleranza al peso per la colonna');
    if (def.suppressesFire) lines.push('Spegne gli incendi adiacenti');
    if (def.ventilated) lines.push('Rischio incendio se soffocata');
    return lines;
  }

  /** Riassunto degli effetti base per la UI. */
  static effectsText(type) {
    const e = BlockFactory.def(type).effects;
    const map = {
      population: 'Pop', coins: 'Monete', energy: 'Energia',
      water: 'Acqua', happiness: 'Felicita', pollution: 'Inquin.'
    };
    return Object.entries(e)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => (v > 0 ? '+' : '') + v + ' ' + (map[k] || k));
  }

  /** Reset del contatore ID (usato dal caricamento partita). */
  static syncUid(maxId) { UID = Math.max(UID, (maxId | 0) + 1); }
}
