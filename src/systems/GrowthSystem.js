/**
 * GrowthSystem.js - v1.1.0 - Edifici idroponici viventi.
 *
 * Una coltura [ECO] con accesso all'acqua matura per N turni e poi si espande
 * gratuitamente in una cella libera adiacente, aggrappandosi alla struttura.
 * L'accesso all'acqua si propaga lungo la catena di colture: basta che una
 * qualsiasi coltura del grappolo tocchi un serbatoio.
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from '../core/BlockFactory.js';
import { EVT } from '../utils/EventBus.js';

export class GrowthSystem {
  constructor(bus, rng) {
    this.bus = bus;
    this.rng = rng;
    this.reset();
  }

  reset() { this.grownTotal = 0; }

  /** Colture collegate a un serbatoio, direttamente o tramite altre colture. */
  wateredCells(grid) {
    const eco = grid.listByType('ECO');
    const watered = new Set();
    let changed = true;

    while (changed) {
      changed = false;
      for (const cell of eco) {
        if (watered.has(cell.id)) continue;
        const near = grid.neighborList(cell.col, cell.row);
        const ok = near.some((n) =>
          n.type === 'WAT' || (n.type === 'ECO' && watered.has(n.id)));
        if (ok) { watered.add(cell.id); changed = true; }
      }
    }
    return watered;
  }

  /** Celle libere dove la coltura puo aggrapparsi (serve almeno un appoggio). */
  _targets(grid, cell) {
    const around = [
      { c: cell.col, r: cell.row + 1 },
      { c: cell.col, r: cell.row - 1 },
      { c: cell.col - 1, r: cell.row },
      { c: cell.col + 1, r: cell.row }
    ];
    return around.filter((p) => {
      if (!grid.inBounds(p.c, p.r) || !grid.isEmpty(p.c, p.r)) return false;
      // deve avere un appoggio: un vicino solido oppure il suolo
      return p.r === 0 || grid.solidNeighbors(p.c, p.r) > 0;
    });
  }

  /**
   * Avanzamento di un turno. Ritorna le celle appena generate.
   * seasonMods.growthTurns accorcia la maturazione in primavera.
   */
  onTurn(grid, seasonMods, turn) {
    const eco = grid.listByType('ECO');
    if (!eco.length) return [];

    const needed = (seasonMods && seasonMods.growthTurns) || CONFIG.ECO.GROWTH_TURNS;
    const watered = this.wateredCells(grid);
    const born = [];

    for (const cell of eco) {
      if (cell.burning > 0) continue;
      if (!watered.has(cell.id)) { cell.growth = 0; continue; }

      cell.generation = cell.generation || 0;
      if (cell.generation >= CONFIG.ECO.MAX_GENERATIONS) continue;

      cell.growth = (cell.growth || 0) + 1;
      if (cell.growth < needed) continue;

      const targets = this._targets(grid, cell);
      if (!targets.length) { cell.growth = needed; continue; }   // resta pronta

      // predilige le celle piu ancorate: la coltura cresce dove ha piu presa
      targets.sort((a, b) => grid.solidNeighbors(b.c, b.r) - grid.solidNeighbors(a.c, a.r));
      const pick = targets[0];

      const child = BlockFactory.create('ECO', pick.c, pick.r, turn);
      child.generation = cell.generation + 1;
      child.growth = 0;
      child.anim.sx = 0.2;
      child.anim.sy = 0.2;
      grid.set(pick.c, pick.r, child);

      cell.growth = 0;
      cell.generation++;
      this.grownTotal++;
      born.push(child);

      this.bus.emit(EVT.ECO_GROWN, { parent: cell, child });
      this.bus.emit(EVT.FLOATER, { col: pick.c, row: pick.r, text: 'CRESCE', color: '#8BF5C0', size: 12 });
    }

    if (born.length) {
      this.bus.emit(EVT.LOG, {
        text: '🌱 Le colture idroponiche si sono espanse in ' + born.length + ' nuove celle.',
        kind: 'good'
      });
    }
    return born;
  }

  /** Percentuale di maturazione, per la barra mostrata sul blocco. */
  static progress(cell, seasonMods) {
    const needed = (seasonMods && seasonMods.growthTurns) || CONFIG.ECO.GROWTH_TURNS;
    return Math.min(1, (cell.growth || 0) / needed);
  }

  serialize() { return { grownTotal: this.grownTotal }; }
  deserialize(data) { if (data) this.grownTotal = data.grownTotal || 0; }
}
