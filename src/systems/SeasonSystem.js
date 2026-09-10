/**
 * SeasonSystem.js - v1.1.0 - Ciclo delle stagioni e crisi termica.
 *
 * Il clima cambia ogni CONFIG.SEASONS.LENGTH turni seguendo l'ordine
 * Estate -> Autunno -> Inverno -> Primavera e restituisce un set di
 * moltiplicatori che gli altri sistemi applicano senza conoscere le stagioni:
 *
 *   resEnergyMult  consumo energetico dei residenziali (inverno: x2)
 *   fireMult       rischio incendio delle centrali (estate: x2,2)
 *   windMult       intensita del vento (autunno: x1,35)
 *   growthTurns    turni di crescita degli idroponici (primavera: piu rapida)
 */

import { CONFIG } from '../config/Config.js';
import { EVT } from '../utils/EventBus.js';

export const SEASONS = [
  {
    id: 'estate', name: 'Estate', icon: '☀️', tint: '#FFB74D',
    note: 'Caldo record: le centrali in sovraccarico rischiano di incendiarsi.'
  },
  {
    id: 'autunno', name: 'Autunno', icon: '🍂', tint: '#C77D3A',
    note: 'Raffiche costanti: il vento spinge di piu sulle strutture sbilanciate.'
  },
  {
    id: 'inverno', name: 'Inverno', icon: '❄️', tint: '#8FB6DE',
    note: 'Riscaldamento acceso: i residenziali consumano il doppio di energia.'
  },
  {
    id: 'primavera', name: 'Primavera', icon: '🌷', tint: '#8BD98B',
    note: 'Stagione della crescita: gli idroponici si espandono piu in fretta.'
  }
];

export class SeasonSystem {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.turn = 0;
    this.index = 0;
    this.turnsInSeason = 0;
  }

  get current() { return SEASONS[this.index]; }
  get id() { return this.current.id; }

  /** Turni mancanti al prossimo cambio di stagione. */
  get turnsLeft() { return Math.max(0, CONFIG.SEASONS.LENGTH - this.turnsInSeason); }

  /** Moltiplicatori applicati dagli altri sistemi. */
  get modifiers() {
    const S = CONFIG.SEASONS;
    const id = this.id;
    return {
      season: id,
      resEnergyMult: id === 'inverno' ? S.WINTER_ENERGY_MULT : 1,
      fireMult: id === 'estate' ? S.SUMMER_FIRE_MULT : 1,
      overloadIgnition: id === 'estate' ? S.SUMMER_OVERLOAD_IGNITION : 0,
      windMult: id === 'autunno' ? S.AUTUMN_WIND_MULT : 1,
      growthTurns: id === 'primavera' ? CONFIG.ECO.SPRING_TURNS : CONFIG.ECO.GROWTH_TURNS
    };
  }

  /** Avanza di un turno; emette un evento quando la stagione cambia. */
  onTurn(turn) {
    this.turn = turn;
    const next = Math.floor(turn / CONFIG.SEASONS.LENGTH) % SEASONS.length;
    this.turnsInSeason = turn % CONFIG.SEASONS.LENGTH;

    if (next === this.index) return null;
    const from = this.current;
    this.index = next;
    const to = this.current;

    this.bus.emit(EVT.SEASON_CHANGE, { from: from.id, to: to.id, season: to, modifiers: this.modifiers });
    this.bus.emit(EVT.LOG, { text: to.icon + ' ' + to.name + ': ' + to.note, kind: 'info' });
    return to;
  }

  serialize() { return { index: this.index, turnsInSeason: this.turnsInSeason }; }

  deserialize(data) {
    if (!data) return;
    this.index = Math.min(SEASONS.length - 1, Math.max(0, data.index | 0));
    this.turnsInSeason = data.turnsInSeason || 0;
  }
}
