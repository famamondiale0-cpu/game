/**
 * PhysicsSystem.js - Carico di massa, centro di gravita e stress strutturale.
 *
 * Tre grandezze governano la stabilita:
 *  1. CARICO      load(cella)  = somma dei pesi dei blocchi sovrastanti.
 *  2. TOLLERANZA  capacity     = capacita del blocco x 2^(travi SUP sotto).
 *  3. STRESS      load/capacity: oltre 1.0 il blocco si crepa e puo crollare.
 *
 * A questo si somma la TORSIONE: se il centro di massa esce dalla base di
 * appoggio (o il vento lo spinge fuori) la struttura si inclina e si danneggia.
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from '../core/BlockFactory.js';
import { clamp, damp } from '../utils/Utils.js';
import { EVT } from '../utils/EventBus.js';

export class PhysicsSystem {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.report = {
      totalWeight: 0, com: { x: 0, y: 0 }, footprint: null,
      imbalance: 0, effectiveImbalance: 0, maxStress: 0,
      stability: 1, criticalCells: [], tilt: 0
    };
    this.tilt = 0;        // inclinazione visiva smorzata
    this.sway = 0;        // oscillazione da vento
    this.swayTime = 0;
  }

  /** Tolleranza al peso della cella, considerando le travi sottostanti. */
  capacityOf(grid, cell) {
    const base = BlockFactory.def(cell.type).capacity;
    const isSup = BlockFactory.def(cell.type).isSupport;
    // le travi sotto (esclusa se stessa) raddoppiano la tolleranza, max x4
    const sups = clamp(grid.supportsBelow(cell.col, cell.row - 1), 0, CONFIG.PHYSICS.MAX_SUP_STACK);
    const mult = Math.pow(CONFIG.PHYSICS.SUP_MULTIPLIER, sups);
    const damageFactor = 0.3 + 0.7 * clamp(cell.integrity / 100, 0, 1);
    return base * mult * damageFactor * (isSup ? 1 : 1);
  }

  /**
   * Analisi completa (non distruttiva): aggiorna load/capacity/stress di ogni
   * cella e calcola centro di massa, sbilanciamento e indice di stabilita.
   */
  analyze(grid, weather = null, opts = {}) {
    let totalWeight = 0, momentX = 0, momentY = 0, maxStress = 0;
    const criticalCells = [];

    // Carico cumulativo per colonna, calcolato dall'alto verso il basso
    for (let c = 0; c < grid.cols; c++) {
      let above = 0;
      for (let r = grid.rows - 1; r >= 0; r--) {
        const cell = grid.get(c, r);
        if (!cell) continue;
        const w = BlockFactory.weight(cell.type);
        cell.load = above;
        cell.capacity = this.capacityOf(grid, cell);
        cell.stress = cell.capacity > 0 ? cell.load / cell.capacity : 0;
        if (cell.stress > maxStress) maxStress = cell.stress;
        if (cell.stress > 0.85) criticalCells.push(cell);
        above += w;

        totalWeight += w;
        momentX += w * (c + 0.5);
        momentY += w * (r + 0.5);
      }
    }

    const footprint = grid.footprint();
    const com = totalWeight > 0
      ? { x: momentX / totalWeight, y: momentY / totalWeight }
      : { x: footprint.center, y: 0 };

    // Sbilanciamento normalizzato: 0 = perfettamente centrato, 1 = sul bordo
    const halfBase = Math.max(0.75, footprint.width / 2);
    const imbalance = (com.x - footprint.center) / halfBase;

    // Il vento spinge lateralmente in proporzione all'altezza esposta
    const wind = weather ? weather.windVector : 0;
    const heightFactor = grid.maxHeight() / grid.rows;
    // v1.1.0: i ponti sospesi irrigidiscono la struttura (windResistance < 1),
    // mentre in autunno le raffiche aumentano (windMult > 1).
    const resist = opts.windResistance === undefined ? 1 : opts.windResistance;
    const seasonWind = opts.windMult || 1;
    const windPush = wind * seasonWind * resist * heightFactor *
      (1 + com.y / grid.rows) * CONFIG.PHYSICS.WIND_FACTOR * 12;
    const effectiveImbalance = imbalance + windPush;

    const stressPart = clamp(1 - maxStress, 0, 1);
    const balancePart = clamp(1 - Math.abs(effectiveImbalance) / CONFIG.PHYSICS.IMBALANCE_LIMIT, 0, 1);
    const stability = clamp(Math.min(stressPart, balancePart), 0, 1);

    this.report = {
      totalWeight, com, footprint, imbalance, effectiveImbalance, windResistance: resist,
      maxStress, stability, criticalCells,
      tilt: clamp(effectiveImbalance, -2, 2) * CONFIG.PHYSICS.TILT_VISUAL
    };
    return this.report;
  }

  /** Applica danno a una cella; ritorna true se e stata distrutta. */
  damage(cell, amount, reason = 'stress') {
    cell.integrity -= amount;
    cell.anim.flash = Math.max(cell.anim.flash, 0.6);
    if (cell.integrity <= 0) { cell.integrity = 0; cell.doomed = reason; return true; }
    return false;
  }

  /**
   * Risoluzione di fine turno: crepe da sovraccarico, torsione da
   * sbilanciamento e crolli conseguenti. Ritorna l'elenco dei crolli.
   */
  resolveTurn(grid, weather = null, opts = {}) {
    const rep = this.analyze(grid, weather, opts);
    const doomed = [];
    const P = CONFIG.PHYSICS;

    // 1) Sovraccarico: oltre il margine di sicurezza la cella si crepa.
    //    Sotto il 75% di carico invece la manutenzione la ripara lentamente.
    grid.each((cell) => {
      if (cell.stress < 0.75 && cell.integrity < 100 && cell.burning <= 0) {
        cell.integrity = Math.min(100, cell.integrity + P.REPAIR_PER_TURN);
        return;
      }
      if (cell.stress > P.STRESS_MARGIN) {
        const excess = cell.stress - P.STRESS_MARGIN;
        const dmg = P.BASE_DAMAGE + excess * P.OVERSTRESS_DAMAGE;
        if (this.damage(cell, dmg, 'sovraccarico')) doomed.push({ cell, reason: 'sovraccarico' });
        else if (cell.integrity < 45) {
          this.bus.emit(EVT.FLOATER, { col: cell.col, row: cell.row, text: 'CREPA', color: '#ff6b6b', size: 12 });
        }
      }
    });

    // 2) Torsione: il centro di massa fuori base danneggia le fondamenta
    const excessTilt = Math.abs(rep.effectiveImbalance) - P.IMBALANCE_LIMIT;
    if (excessTilt > 0 && rep.footprint.count > 0) {
      const leaningRight = rep.effectiveImbalance > 0;
      const pivotCol = leaningRight ? rep.footprint.min : rep.footprint.max;
      const dmg = P.TORSION_DAMAGE * (1 + excessTilt * 2);
      for (let r = 0; r < 3; r++) {
        const cell = grid.get(pivotCol, r);
        if (!cell) continue;
        if (this.damage(cell, dmg, 'torsione')) doomed.push({ cell, reason: 'torsione' });
      }
      this.bus.emit(EVT.LOG, {
        text: 'Struttura sbilanciata verso ' + (leaningRight ? 'destra' : 'sinistra') + ': le fondamenta cedono!',
        kind: 'warn'
      });
      this.bus.emit(EVT.SHAKE, { power: 6 + excessTilt * 10 });
    }

    const collapses = this.applyCollapses(grid, doomed);
    if (collapses.length) this.analyze(grid, weather, opts);
    return collapses;
  }

  /**
   * Rimuove le celle distrutte e fa cadere per gravita quelle sovrastanti.
   * Ritorna [{ cell, reason, moves }] per particelle, suoni e log.
   */
  applyCollapses(grid, doomed) {
    if (!doomed.length) return [];
    const cols = new Set();
    const out = [];

    for (const entry of doomed) {
      const { cell, reason } = entry;
      if (grid.get(cell.col, cell.row) !== cell) continue;
      grid.clearAt(cell.col, cell.row);
      cols.add(cell.col);
      out.push({ cell, reason, col: cell.col, row: cell.row });
      this.bus.emit(EVT.BLOCK_DESTROYED, { cell, reason, col: cell.col, row: cell.row });
    }

    let moves = [];
    for (const c of cols) moves = moves.concat(grid.compactColumn(c));
    // le celle che scendono ripartono con un'animazione di caduta
    for (const m of moves) {
      m.cell.anim.fall = Math.max(m.cell.anim.fall, (m.from - m.to));
      m.cell.anim.vy = 0;
      m.cell.anim.falling = true;
    }

    if (out.length) {
      this.bus.emit(EVT.COLLAPSE, { cells: out, moves });
      this.bus.emit(EVT.SHAKE, { power: 8 + out.length * 3 });
    }
    return out;
  }

  /** Aggiornamento cosmetico: inclinazione e oscillazione al vento. */
  update(dt, weather) {
    const target = this.report.tilt || 0;
    this.tilt = damp(this.tilt, target, 3.2, dt);
    this.swayTime += dt * (0.8 + (weather ? weather.wind * 3 : 0));
    const amp = (weather ? weather.wind : 0) * 0.012 * (0.4 + Math.abs(this.report.imbalance));
    this.sway = Math.sin(this.swayTime) * amp;
  }

  /** Inclinazione totale in radianti usata dal RenderEngine. */
  visualTilt() { return this.tilt + this.sway; }

  /** Etichetta sintetica dello stato strutturale per la UI. */
  statusLabel() {
    const s = this.report.stability;
    if (s > 0.75) return { text: 'STABILE', kind: 'good' };
    if (s > 0.45) return { text: 'SOTTO CARICO', kind: 'warn' };
    if (s > 0.15) return { text: 'CRITICA', kind: 'bad' };
    return { text: 'CEDIMENTO', kind: 'bad' };
  }
}
