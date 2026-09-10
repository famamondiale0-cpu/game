/**
 * Config.js - Costanti globali di bilanciamento e configurazione.
 * Unico punto di verita per il tuning: nessun numero magico sparso nei moduli.
 */

export const CONFIG = {
  VERSION: '1.1.0',
  TITLE: 'ZENITH BLOCK',

  GRID: {
    COLS: 10,
    ROWS: 20,
    CELL: 44
  },

  START: {
    COINS: 800,
    HAND_SIZE: 5,
    DISCARD_COST: 15
  },

  ECONOMY: {
    BASE_HAPPINESS: 50,
    TAX_PER_POP: 0.6,           // gettito fiscale per abitante per turno
    BASE_ENERGY: 10,          // fornitura minima della rete cittadina
    BASE_WATER: 10,           // acquedotto pubblico di base
    POLLUTION_TOLERANCE: 60,
    POLLUTION_MAX: 150,
    // L'inquinamento e un INDICE DI DENSITA, non uno stock illimitato:
    // conta quanto inquina la citta in rapporto alla sua dimensione.
    POLLUTION_SCALE: 150,     // conversione densita -> indice
    POLLUTION_INERTIA: 0.3,   // quanto in fretta l'indice insegue il valore di regime
    FINE_BASE: 120,
    // La manutenzione e definita per tipo di blocco in BlockFactory (campo upkeep)
    BROWNOUT_PENALTY: 0.5,
    DEMOLISH_REFUND: 0.25,
    DEMOLISH_FEE: 20,
    COST_GROWTH: 0.09,        // curva di domanda: ogni copia costruita rincara il tipo
    COST_CAP: 4               // tetto massimo al rincaro (x4 del prezzo base)
  },

  PHYSICS: {
    SUP_MULTIPLIER: 2,
    MAX_SUP_STACK: 2,
    STRESS_MARGIN: 1.15,      // margine di sicurezza prima delle crepe
    REPAIR_PER_TURN: 4,       // manutenzione dei blocchi non sollecitati
    OVERSTRESS_DAMAGE: 20,
    BASE_DAMAGE: 5,
    IMBALANCE_LIMIT: 0.62,
    TORSION_DAMAGE: 14,
    WIND_FACTOR: 0.055,
    TILT_VISUAL: 0.055
  },

  WEATHER: {
    DAY_LENGTH: 180,
    START_HOUR: 7.5,
    CHANGE_EVERY: [22, 46],
    RAIN_WATER_BONUS: 4,
    RAIN_POLLUTION_WASH: 1.5,
    STORM_WIND: [0.65, 1.0],
    WINDY_WIND: [0.35, 0.65],
    CALM_WIND: [0.0, 0.25]
  },

  EVENTS: {
    START_AFTER: 4,
    EVERY: 6,
    VARIANCE: 2,
    FIRE_SPREAD_CHANCE: 0.16,
    FIRE_DAMAGE: 22,
    FIRE_DURATION: 3,
    WATER_SUPPRESS: 0.75,
    RAIN_SUPPRESS: 0.5,
    QUAKE_DAMAGE: [6, 20],
    QUAKE_HIT_CHANCE: 0.55,   // quota di blocchi colpiti da una scossa
    IMMIGRATION_TURNS: 6,
    IMMIGRATION_BONUS: 2.0,
    INSPECTION_EXTRA_CHANCE: 0.12
  },

  RENDER: {
    PADDING: 26,
    SHAKE_DECAY: 5.4,
    FALL_GRAVITY: 48,         // celle/s^2 durante la caduta di un blocco
    FALL_MAX_SPEED: 30,       // celle/s, velocita terminale
    SQUASH_RECOVER: 9.5,
    PARALLAX: [0.12, 0.26, 0.46]
  },

  AUDIO: {
    MASTER: 0.55,
    MUSIC: 0.3,
    SFX: 0.55,
    BPM: 84
  },

  SAVE: {
    KEY: 'zenithblock.save.v1',
    SLOTS: 3,
    AUTOSLOT: 0
  },

/** v1.1.0 - Ponti sospesi fra colonne staccate. */
  SKYBRIDGE: {
    MIN_ROW: 4,               // riga 4 = quinto livello
    MAX_SPAN: 4,              // campata massima in celle vuote
    WIND_BONUS: 0.3,          // -30% di spinta del vento per ponte
    MAX_BONUS: 0.6            // tetto cumulativo del bonus
  },

  /** v1.1.0 - Elisuperficie e turismo VIP. */
  HELIPAD: {
    INTERVAL: 3,              // turni fra un arrivo VIP e il successivo
    INCOME: 85,               // monete per arrivo
    NOISE_DEPTH: 2,           // residenziali sottostanti colpiti dal rumore
    NOISE_PENALTY: 7          // felicita sottratta a ciascuno
  },

  /** v1.1.0 - Edifici idroponici viventi. */
  ECO: {
    GROWTH_TURNS: 5,          // turni necessari per espandersi
    SPRING_TURNS: 3,          // in primavera cresce piu in fretta
    MAX_GENERATIONS: 2,       // quante volte una singola cella puo generare
    WATER_RANGE: 1            // distanza massima da una fonte d acqua
  },

  /** v1.1.0 - Mercato nero e sicurezza. */
  BLACK_MARKET: {
    MAX_ROW: 2,               // solo nelle prime 3 righe
    INSTANT_COINS: [280, 460],
    TAX_PENALTY: 0.4,         // -40% di gettito alle residenze della colonna
    POLICE_RADIUS: 3          // raggio di copertura di una stazione di polizia
  },

  /** v1.1.0 - Ciclo delle stagioni. */
  SEASONS: {
    LENGTH: 20,               // turni per stagione
    WINTER_ENERGY_MULT: 2,    // riscaldamento: consumo residenziale raddoppiato
    SUMMER_FIRE_MULT: 2.2,    // rischio incendio delle centrali in sovraccarico
    SUMMER_OVERLOAD_IGNITION: 0.18,
    AUTUMN_WIND_MULT: 1.35
  }
,

  LEVELS: [
    { population: 40,  happiness: 45, maxPollution: 70, reward: 400,  name: 'Distretto Alba' },
    { population: 70,  happiness: 50, maxPollution: 65, reward: 650,  name: 'Quartiere Meridiano' },
    { population: 110, happiness: 55, maxPollution: 60, reward: 900,  name: 'Torre del Tramonto' },
    { population: 160, happiness: 58, maxPollution: 55, reward: 1250, name: 'Cittadella Notturna' },
    { population: 220, happiness: 60, maxPollution: 50, reward: 1600, name: 'Zenith Assoluto' }
  ]
};

/** Obiettivo del livello n (1-based); oltre la tabella scala proceduralmente. */
export function getLevelGoal(level) {
  const table = CONFIG.LEVELS;
  if (level <= table.length) return { ...table[level - 1], level };
  const last = table[table.length - 1];
  const over = level - table.length;
  return {
    level,
    name: 'Zenith +' + over,
    population: Math.round(last.population * Math.pow(1.35, over)),
    happiness: Math.min(75, last.happiness + over),
    maxPollution: Math.max(35, last.maxPollution - over * 2),
    reward: Math.round(last.reward * Math.pow(1.25, over))
  };
}
