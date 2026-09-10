/**
 * EconomyEngine.js - Risorse globali e valutazione della matrice di sinergia.
 *
 * Modello:
 *  - ENERGIA / ACQUA sono flussi: produzione vs consumo. In deficit scatta il
 *    blackout (introiti dimezzati, felicita e popolazione penalizzate).
 *  - INQUINAMENTO e uno stock che cresce ogni turno del "rate" della citta.
 *  - FELICITA e un indice 0..100 = base + media pesata dei contributi.
 *  - MONETE sono il flusso di cassa: introiti - manutenzione.
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from '../core/BlockFactory.js';
import { clamp } from '../utils/Utils.js';
import { EVT } from '../utils/EventBus.js';

export class EconomyEngine {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.coins = CONFIG.START.COINS;
    this.score = 0;
    this.pollution = 0;
    this.totalEarned = 0;
    this.totalSpent = 0;
    this.finesPaid = 0;
    this.stats = this._emptyStats();
  }

  _emptyStats() {
    return {
      population: 0, happiness: CONFIG.ECONOMY.BASE_HAPPINESS,
      energyProd: 0, energyUse: 0, energyBalance: 0,
      waterProd: 0, waterUse: 0, waterBalance: 0,
      pollutionRate: 0, income: 0, upkeep: 0, netIncome: 0,
      blocks: 0, blackout: false, drought: false, taxes: 0,
      energyDeficit: 0, waterDeficit: 0, districts: 0, starvedDistricts: 0,
      noisedHomes: 0, insecureTaxLoss: 0, vip: 0,
      synergyBonus: 0, malus: 0, perCell: new Map()
    };
  }

  canAfford(amount) { return this.coins >= amount; }

  spend(amount) {
    if (!this.canAfford(amount)) return false;
    this.coins -= amount;
    this.totalSpent += amount;
    return true;
  }

  earn(amount) {
    this.coins += amount;
    if (amount > 0) this.totalEarned += amount;
    return this.coins;
  }

  fine(amount, reason) {
    const paid = Math.min(this.coins, amount);
    this.coins = Math.max(0, this.coins - amount);
    this.finesPaid += paid;
    this.bus.emit(EVT.LOG, { text: 'Multa di ' + Math.round(amount) + ' monete: ' + reason, kind: 'bad' });
    return paid;
  }

  addPollution(delta) {
    this.pollution = clamp(this.pollution + delta, 0, CONFIG.ECONOMY.POLLUTION_MAX);
    return this.pollution;
  }

  /** Efficienza di una cella: danni e incendi riducono la resa. */
  _efficiency(cell) {
    if (cell.burning > 0) return 0;
    return 0.35 + 0.65 * clamp(cell.integrity / 100, 0, 1);
  }

  /**
   * Ricalcola tutti gli indicatori dalla griglia. Non muta le risorse:
   * viene usata sia per il turno reale sia per le anteprime.
   *
   * v1.1.0 - energia e acqua non sono piu un unico serbatoio cittadino: ogni
   * DISTRETTO (componente connessa di blocchi) ha la propria rete. Un ponte
   * sospeso, unendo due torri, ne fonde le reti. La fornitura municipale e
   * ripartita in proporzione alle colonne che poggiano a terra.
   *
   * mods: { resMultiplier, comMultiplier, indMultiplier,  (eventi)
   *         resEnergyMult,                                (stagione)
   *         taxMultiplier(col) }                          (sicurezza)
   */
  evaluate(grid, mods = {}) {
    const stats = this._emptyStats();
    const perCell = stats.perCell;
    const resMul = mods.resMultiplier || 1;
    const comMul = mods.comMultiplier || 1;
    const indMul = mods.indMultiplier || 1;
    const winterMul = mods.resEnergyMult || 1;
    const taxMul = typeof mods.taxMultiplier === 'function' ? mods.taxMultiplier : () => 1;

    const districts = grid.components();
    const groundTotal = districts.reduce((s, d) => s + d.groundCols.size, 0);
    const share = (d) => (groundTotal > 0 ? d.groundCols.size / groundTotal : 0);

    const nets = districts.map((d) => ({
      district: d,
      energyProd: CONFIG.ECONOMY.BASE_ENERGY * share(d),
      energyUse: 0,
      waterProd: CONFIG.ECONOMY.BASE_WATER * share(d),
      waterUse: 0
    }));
    const netOf = (cell) => nets[cell.district] || nets[0];

    // --- Passata 1: flussi di energia e acqua, rete per rete ---
    grid.each((cell) => {
      const e = BlockFactory.def(cell.type).effects;
      const eff = this._efficiency(cell);
      const net = netOf(cell);
      stats.blocks++;
      stats.upkeep += BlockFactory.upkeep(cell.type);
      if (!net) return;

      if (e.energy > 0) net.energyProd += e.energy * eff;
      else if (e.energy < 0) {
        // Inverno: il riscaldamento raddoppia i consumi dei residenziali
        net.energyUse += -e.energy * (cell.type === 'RES' ? winterMul : 1);
      }
      if (e.water > 0) net.waterProd += e.water * eff;
      else if (e.water < 0) net.waterUse += -e.water;
    });

    if (!nets.length) {
      stats.energyProd = CONFIG.ECONOMY.BASE_ENERGY;
      stats.waterProd = CONFIG.ECONOMY.BASE_WATER;
    }

    for (const net of nets) {
      net.energyBalance = net.energyProd - net.energyUse;
      net.waterBalance = net.waterProd - net.waterUse;
      net.energyDeficit = clamp(-net.energyBalance / Math.max(1, net.energyUse), 0, 1);
      net.waterDeficit = clamp(-net.waterBalance / Math.max(1, net.waterUse), 0, 1);
      net.outputMul = 1 - (1 - CONFIG.ECONOMY.BROWNOUT_PENALTY) * net.energyDeficit;
      net.popMul = (1 - 0.45 * net.energyDeficit) * (1 - 0.35 * net.waterDeficit);

      stats.energyProd += net.energyProd;
      stats.energyUse += net.energyUse;
      stats.waterProd += net.waterProd;
      stats.waterUse += net.waterUse;
    }

    stats.districts = nets.length;
    stats.starvedDistricts = nets.filter((n) => n.energyDeficit > 0.05 || n.waterDeficit > 0.05).length;
    stats.energyBalance = stats.energyProd - stats.energyUse;
    stats.waterBalance = stats.waterProd - stats.waterUse;
    stats.energyDeficit = clamp(-stats.energyBalance / Math.max(1, stats.energyUse), 0, 1);
    stats.waterDeficit = clamp(-stats.waterBalance / Math.max(1, stats.waterUse), 0, 1);
    stats.blackout = nets.some((n) => n.energyDeficit > 0);
    stats.drought = nets.some((n) => n.waterDeficit > 0);

    // --- Rumore delle elisuperfici: colpisce i residenziali sottostanti ---
    const noise = new Map();
    for (const pad of grid.listByType('HEL')) {
      let hit = 0;
      for (let r = pad.row - 1; r >= 0 && hit < CONFIG.HELIPAD.NOISE_DEPTH; r--) {
        const below = grid.get(pad.col, r);
        if (!below) break;
        if (below.type !== 'RES') continue;
        noise.set(below.id, (noise.get(below.id) || 0) + CONFIG.HELIPAD.NOISE_PENALTY);
        hit++;
      }
    }
    stats.noisedHomes = noise.size;

    // --- Passata 2: effetti, sinergie, tasse e malus cella per cella ---
    let happinessSum = 0;
    let pollutionRate = 0;

    grid.each((cell, col, row) => {
      const def = BlockFactory.def(cell.type);
      const e = def.effects;
      const eff = this._efficiency(cell);
      const net = netOf(cell) || { outputMul: 1, popMul: 1 };
      const typeMul = cell.type === 'RES' ? resMul
        : cell.type === 'COM' ? comMul
        : cell.type === 'IND' ? indMul : 1;

      const entry = { coins: 0, happiness: 0, population: 0, pollution: 0, taxes: 0, links: [] };
      entry.coins += (e.coins || 0) * eff * typeMul;
      entry.happiness += (e.happiness || 0) * eff;
      entry.population += (e.population || 0) * eff * typeMul;
      entry.pollution += (e.pollution || 0) * (cell.burning > 0 ? 1.5 : eff);

      // MATRICE DI SINERGIA: una applicazione per ogni vicino compatibile
      const neigh = grid.neighborList(col, row);
      for (const rule of def.synergy) {
        for (const n of neigh) {
          if (!rule.with.includes(n.type)) continue;
          const dCoins = rule.coins || 0;
          const dHappy = rule.happiness || 0;
          entry.coins += dCoins * eff * typeMul;
          entry.happiness += dHappy * eff;
          entry.links.push({ type: n.type, id: n.id, label: rule.label });
          if (dCoins + dHappy >= 0) stats.synergyBonus += dCoins + dHappy;
          else stats.malus += Math.abs(dCoins + dHappy);
        }
      }

      // Rumore aereo sulle abitazioni sotto un'elisuperficie
      const noiseHit = noise.get(cell.id);
      if (noiseHit) { entry.happiness -= noiseHit; stats.malus += noiseHit; }

      if (cell.burning > 0) entry.happiness -= 6;
      if (cell.integrity < 50) entry.happiness -= 2;

      // Popolazione e gettito fiscale: la colonna insicura rende meno
      const pop = entry.population * net.popMul;
      if (pop > 0) {
        const secure = taxMul(col);
        entry.taxes = pop * CONFIG.ECONOMY.TAX_PER_POP * secure;
        if (secure < 1) stats.insecureTaxLoss += pop * CONFIG.ECONOMY.TAX_PER_POP * (1 - secure);
      }

      perCell.set(cell.id, entry);
      stats.income += Math.max(0, entry.coins) * net.outputMul;
      stats.taxes += entry.taxes;
      stats.population += pop;
      happinessSum += entry.happiness;
      pollutionRate += entry.pollution;
    });

    stats.population = Math.round(stats.population);
    stats.pollutionRate = pollutionRate;
    stats.upkeep = Math.round(stats.upkeep);
    stats.taxes = Math.round(stats.taxes);
    stats.insecureTaxLoss = Math.round(stats.insecureTaxLoss);
    stats.income = Math.round(stats.income) + stats.taxes;
    stats.netIncome = Math.round(stats.income - stats.upkeep);

    // Indice di felicita: media dei contributi + penalita ambientali
    const denom = Math.max(4, stats.blocks);
    let happiness = CONFIG.ECONOMY.BASE_HAPPINESS + (happinessSum / denom) * 5;
    happiness -= this.pollution * 0.32;
    happiness -= 14 * stats.energyDeficit;
    happiness -= 9 * stats.waterDeficit;
    stats.happiness = Math.round(clamp(happiness, 0, 100));

    this.stats = stats;
    return stats;
  }

  /** Applica un turno: incassa, paga manutenzione, aggiorna inquinamento. */
  applyTurn(grid, mods = {}, weather = null, turn = 0) {
    const stats = this.evaluate(grid, mods);

    // v1.1.0 - Turismo VIP: le elisuperfici incassano a intervalli regolari
    const pads = grid.listByType('HEL');
    if (pads.length && turn > 0 && turn % CONFIG.HELIPAD.INTERVAL === 0) {
      stats.vip = pads.reduce((sum, p) => sum + CONFIG.HELIPAD.INCOME * this._efficiency(p), 0);
      stats.vip = Math.round(stats.vip);
      this.earn(stats.vip);
      this.bus.emit(EVT.VIP_ARRIVAL, { pads, amount: stats.vip });
    }

    if (stats.netIncome >= 0) this.earn(stats.netIncome);
    else this.coins = Math.max(0, this.coins + stats.netIncome);

    // Valore di regime: densita di emissioni per blocco, scalata a indice 0..MAX.
    // Una citta grande e pulita inquina meno di una piccola e sporca.
    const density = stats.blocks > 0 ? stats.pollutionRate / stats.blocks : 0;
    let target = clamp(density * CONFIG.ECONOMY.POLLUTION_SCALE, 0, CONFIG.ECONOMY.POLLUTION_MAX);
    if (weather && weather.isRaining) target -= CONFIG.WEATHER.RAIN_POLLUTION_WASH * 3;
    const before = this.pollution;
    this.pollution = clamp(
      this.pollution + (target - this.pollution) * CONFIG.ECONOMY.POLLUTION_INERTIA,
      0, CONFIG.ECONOMY.POLLUTION_MAX
    );
    const pollutionDelta = this.pollution - before;
    stats.pollutionTarget = target;

    const gained = Math.round(
      stats.population * 0.5 + stats.happiness * 0.25 + Math.max(0, stats.netIncome) * 0.12
    );
    this.score += gained;

    const summary = {
      income: stats.income, upkeep: stats.upkeep, net: stats.netIncome,
      vip: stats.vip, pollutionDelta, scoreGained: gained, stats
    };
    this.bus.emit(EVT.ECONOMY_UPDATE, summary);
    return summary;
  }

  /**
   * Anteprima non distruttiva: cosa renderebbe un blocco piazzato in (col,row),
   * incluse le sinergie che riceve E quelle che regala ai vicini.
   */
  previewPlacement(grid, col, row, type) {
    const def = BlockFactory.def(type);
    const e = def.effects;
    const out = {
      coins: e.coins || 0, happiness: e.happiness || 0, population: e.population || 0,
      pollution: e.pollution || 0, energy: e.energy || 0, water: e.water || 0, links: []
    };

    const neigh = [
      { dir: 'up', cell: grid.get(col, row + 1) },
      { dir: 'down', cell: grid.get(col, row - 1) },
      { dir: 'left', cell: grid.get(col - 1, row) },
      { dir: 'right', cell: grid.get(col + 1, row) }
    ].filter((n) => n.cell);

    for (const rule of def.synergy) {
      for (const n of neigh) {
        if (!rule.with.includes(n.cell.type)) continue;
        const dc = rule.coins || 0, dh = rule.happiness || 0;
        out.coins += dc; out.happiness += dh;
        out.links.push({ dir: n.dir, with: n.cell.type, positive: dc + dh >= 0, label: rule.label });
      }
    }

    for (const n of neigh) {
      for (const rule of BlockFactory.def(n.cell.type).synergy) {
        if (!rule.with.includes(type)) continue;
        const dc = rule.coins || 0, dh = rule.happiness || 0;
        out.coins += dc; out.happiness += dh;
        out.links.push({ dir: n.dir, with: n.cell.type, positive: dc + dh >= 0, label: rule.label, reverse: true });
      }
    }
    return out;
  }

  serialize() {
    return {
      coins: this.coins, score: this.score, pollution: this.pollution,
      totalEarned: this.totalEarned, totalSpent: this.totalSpent, finesPaid: this.finesPaid
    };
  }

  deserialize(data) {
    if (!data) return;
    this.coins = typeof data.coins === 'number' ? data.coins : CONFIG.START.COINS;
    this.score = data.score || 0;
    this.pollution = data.pollution || 0;
    this.totalEarned = data.totalEarned || 0;
    this.totalSpent = data.totalSpent || 0;
    this.finesPaid = data.finesPaid || 0;
  }
}
