/**
 * SkybridgeSystem.js - v1.1.0 - Ponti sospesi fra colonne staccate.
 *
 * Un ponte non e un singolo blocco ma una CAMPATA: posandolo si riempie tutta
 * la fila di celle vuote fino ai due appoggi laterali, pagando un segmento per
 * cella. Cosi le due torri diventano ortogonalmente adiacenti e i distretti si
 * fondono: energia e acqua vengono condivise senza logiche aggiuntive.
 *
 * Effetti:
 *   - reti unite (vedi Grid.components e EconomyEngine)
 *   - ogni ponte riduce del 30% la spinta del vento (tetto 60%)
 *   - se uno dei due appoggi sparisce, la campata crolla
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from '../core/BlockFactory.js';
import { EVT } from '../utils/EventBus.js';

export class SkybridgeSystem {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() { this.spans = []; }

  /**
   * Cerca la campata utilizzabile passando per (col,row).
   * Ritorna { ok, cols, left, right, cost } oppure { ok:false, reason }.
   */
  findSpan(grid, col, row) {
    const S = CONFIG.SKYBRIDGE;
    if (!grid.inBounds(col, row)) return { ok: false, reason: 'Fuori griglia' };
    if (!grid.isEmpty(col, row)) return { ok: false, reason: 'Cella gia occupata' };
    if (row < S.MIN_ROW) return { ok: false, reason: 'I ponti partono dal livello ' + (S.MIN_ROW + 1) };

    const scan = (dir) => {
      for (let step = 1; step <= S.MAX_SPAN + 1; step++) {
        const c = col + dir * step;
        if (c < 0 || c >= grid.cols) return null;
        if (!grid.isEmpty(c, row)) return c;
      }
      return null;
    };

    const left = scan(-1);
    const right = scan(1);
    if (left === null || right === null) {
      return { ok: false, reason: 'Servono due appoggi solidi alla stessa altezza' };
    }

    const cols = [];
    for (let c = left + 1; c < right; c++) cols.push(c);
    if (cols.length === 0) return { ok: false, reason: 'Nessuna campata da coprire' };
    if (cols.length > S.MAX_SPAN) return { ok: false, reason: 'Campata troppo lunga (max ' + S.MAX_SPAN + ')' };

    return { ok: true, cols, row, left, right, cost: cols.length };
  }

  /** Costruisce fisicamente la campata; ritorna le celle create. */
  build(grid, span, turn) {
    const created = [];
    for (const c of span.cols) {
      const cell = BlockFactory.create('BRG', c, span.row, turn);
      cell.anim.fall = 0;
      cell.anim.sy = 0.35;          // il ponte si dispiega invece di cadere
      cell.anim.sx = 1.25;
      cell.bridge = { row: span.row, left: span.left, right: span.right };
      grid.set(c, span.row, cell);
      created.push(cell);
    }
    this.bus.emit(EVT.BRIDGE_BUILT, { span, cells: created });
    this.bus.emit(EVT.LOG, {
      text: 'Ponte sospeso di ' + created.length + ' campate al livello ' + (span.row + 1) + ': reti collegate.',
      kind: 'good'
    });
    return created;
  }

  /** Elenco delle celle-ponte presenti. */
  bridges(grid) { return grid.listByType('BRG'); }

  /** Numero di campate distinte (ponti logici, non segmenti). */
  count(grid) {
    const keys = new Set();
    for (const cell of this.bridges(grid)) {
      if (cell.bridge) keys.add(cell.bridge.row + ':' + cell.bridge.left + ':' + cell.bridge.right);
    }
    return keys.size;
  }

  /**
   * Fattore di resistenza al vento: 1 = nessuna protezione,
   * 0,4 = tre ponti (tetto del 60% di riduzione).
   */
  windResistance(grid) {
    const bonus = Math.min(CONFIG.SKYBRIDGE.MAX_BONUS, this.count(grid) * CONFIG.SKYBRIDGE.WIND_BONUS);
    return 1 - bonus;
  }

  /**
   * Controllo di fine turno: una campata senza uno dei due appoggi crolla.
   * Ritorna l'elenco delle celle da distruggere.
   */
  validate(grid) {
    const doomed = [];
    for (const cell of this.bridges(grid)) {
      const info = cell.bridge;
      if (!info) continue;
      const leftOk = grid.get(info.left, info.row) !== null;
      const rightOk = grid.get(info.right, info.row) !== null;
      if (!leftOk || !rightOk) doomed.push({ cell, reason: 'cedimento del ponte' });
    }
    if (doomed.length) {
      this.bus.emit(EVT.BRIDGE_LOST, { cells: doomed });
      this.bus.emit(EVT.LOG, { text: 'Un ponte sospeso ha perso l appoggio ed e crollato!', kind: 'bad' });
    }
    return doomed;
  }
}
