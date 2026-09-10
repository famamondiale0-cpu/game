/**
 * SecuritySystem.js - v1.1.0 - Mercato nero e presidio di polizia.
 *
 * Ogni [BLK] rende INSICURA la propria colonna finche non c'e una [POL] entro
 * CONFIG.BLACK_MARKET.POLICE_RADIUS celle (distanza di Chebyshev).
 * Nelle colonne insicure il gettito fiscale dei residenziali cala del 40%.
 */

import { CONFIG } from '../config/Config.js';
import { EVT } from '../utils/EventBus.js';

export class SecuritySystem {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.insecureColumns = new Set();
    this.markets = 0;
    this.stations = 0;
    this._lastSignature = '';
  }

  /** Ricalcola la mappa della sicurezza. Non muta la griglia. */
  analyze(grid) {
    const radius = CONFIG.BLACK_MARKET.POLICE_RADIUS;
    const markets = grid.listByType('BLK');
    const stations = grid.listByType('POL');
    const insecure = new Set();

    for (const m of markets) {
      const covered = stations.some((p) =>
        Math.max(Math.abs(p.col - m.col), Math.abs(p.row - m.row)) <= radius);
      m.covered = covered;
      if (!covered) insecure.add(m.col);
    }

    this.insecureColumns = insecure;
    this.markets = markets.length;
    this.stations = stations.length;

    // avvisa solo quando la situazione cambia davvero
    const signature = [...insecure].sort((a, b) => a - b).join(',');
    if (signature !== this._lastSignature) {
      this._lastSignature = signature;
      this.bus.emit(EVT.SECURITY_CHANGE, {
        insecure: [...insecure], markets: this.markets, stations: this.stations
      });
      if (insecure.size) {
        this.bus.emit(EVT.LOG, {
          text: '🕴️ Colonne senza presidio: ' + [...insecure].map((c) => c + 1).join(', ') +
                '. Le residenze perdono il ' + Math.round(CONFIG.BLACK_MARKET.TAX_PENALTY * 100) + '% di gettito.',
          kind: 'warn'
        });
      } else if (this.markets > 0) {
        this.bus.emit(EVT.LOG, { text: '🚓 Tutti i mercati neri sono sotto sorveglianza.', kind: 'good' });
      }
    }
    return { insecure, markets: this.markets, stations: this.stations };
  }

  isInsecure(col) { return this.insecureColumns.has(col); }

  /** Moltiplicatore del gettito residenziale per la colonna indicata. */
  taxMultiplier(col) {
    return this.isInsecure(col) ? (1 - CONFIG.BLACK_MARKET.TAX_PENALTY) : 1;
  }

  /** Incasso immediato di un mercato nero appena aperto. */
  payout(rng) {
    const [min, max] = CONFIG.BLACK_MARKET.INSTANT_COINS;
    return Math.round(rng ? rng.range(min, max) : (min + max) / 2);
  }

  serialize() { return { insecure: [...this.insecureColumns] }; }

  deserialize(data) {
    this.reset();
    if (data && Array.isArray(data.insecure)) this.insecureColumns = new Set(data.insecure);
  }
}
