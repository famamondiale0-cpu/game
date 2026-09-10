/**
 * WeatherSystem.js - Ciclo giorno/notte, condizioni atmosferiche e vento.
 *
 * Espone al resto del gioco:
 *   hour (0..24), lightLevel (0 notte, 1 pieno giorno), phase,
 *   condition, wind (0..1), windVector (con segno = direzione),
 *   palette del cielo interpolata fra le fasi del giorno.
 */

import { CONFIG } from '../config/Config.js';
import { clamp, mixColor, damp } from '../utils/Utils.js';
import { EVT } from '../utils/EventBus.js';

/** Keyframe del cielo: ora -> colori alto/medio/basso. */
const SKY_KEYS = [
  { h: 0,    top: '#060A1E', mid: '#101A3C', bot: '#1B2450' },
  { h: 5,    top: '#0D1436', mid: '#2A2A5E', bot: '#5B3F6B' },
  { h: 6.5,  top: '#2B4C86', mid: '#D77A5A', bot: '#F2B36B' },
  { h: 8,    top: '#4E8DD1', mid: '#8FC0E8', bot: '#CFE6F5' },
  { h: 12,   top: '#2F7FD1', mid: '#69B4EC', bot: '#B9E2F7' },
  { h: 16,   top: '#3B84C9', mid: '#8CBFE2', bot: '#E4D8B8' },
  { h: 18.5, top: '#2E4C8A', mid: '#E0705A', bot: '#F6C06A' },
  { h: 20,   top: '#141C46', mid: '#4A2E63', bot: '#8A4560' },
  { h: 22,   top: '#080D28', mid: '#161F47', bot: '#242E5C' },
  { h: 24,   top: '#060A1E', mid: '#101A3C', bot: '#1B2450' }
];

const CONDITIONS = {
  clear:  { label: 'Sereno',   icon: '☀️',       weight: 30, wind: 'CALM',  rain: 0,    dark: 0.00 },
  cloudy: { label: 'Nuvoloso', icon: '☁️',       weight: 22, wind: 'CALM',  rain: 0,    dark: 0.14 },
  wind:   { label: 'Ventoso',  icon: '🌬️', weight: 18, wind: 'WINDY', rain: 0,    dark: 0.06 },
  rain:   { label: 'Pioggia',  icon: '🌧️', weight: 18, wind: 'WINDY', rain: 0.55, dark: 0.28 },
  storm:  { label: 'Tempesta', icon: '⛈️',       weight: 8,  wind: 'STORM', rain: 1.0,  dark: 0.42 },
  fog:    { label: 'Nebbia',   icon: '🌫️', weight: 4,  wind: 'CALM',  rain: 0,    dark: 0.2 }
};

export class WeatherSystem {
  constructor(bus, rng) {
    this.bus = bus;
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.hour = CONFIG.WEATHER.START_HOUR;
    this.day = 1;
    this.condition = 'clear';
    this.nextChange = this.rng.range(CONFIG.WEATHER.CHANGE_EVERY[0], CONFIG.WEATHER.CHANGE_EVERY[1]);
    this.wind = 0.12;
    this.windTarget = 0.12;
    this.windDir = this.rng.chance(0.5) ? 1 : -1;
    this.rain = 0;
    this.rainTarget = 0;
    this.lightning = 0;
    this.nextLightning = 4;
    this.timer = 0;
  }

  get info() { return CONDITIONS[this.condition]; }
  get isRaining() { return this.rain > 0.15; }
  get isStorm() { return this.condition === 'storm'; }
  get windVector() { return this.wind * this.windDir; }

  /** 0 = notte fonda, 1 = pieno giorno. */
  get lightLevel() {
    const h = this.hour;
    let l;
    if (h < 5) l = 0;
    else if (h < 7.5) l = (h - 5) / 2.5;
    else if (h < 17.5) l = 1;
    else if (h < 20) l = 1 - (h - 17.5) / 2.5;
    else l = 0;
    return clamp(l, 0, 1) * (1 - this.info.dark * 0.55);
  }

  get isNight() { return this.hour < 6.2 || this.hour >= 19.4; }

  get phase() {
    const h = this.hour;
    if (h < 5.5) return 'notte';
    if (h < 8) return 'alba';
    if (h < 17) return 'giorno';
    if (h < 20) return 'tramonto';
    return 'notte';
  }

  update(dt) {
    // DAY_LENGTH secondi reali = 24 ore di gioco
    const hoursPerSecond = 24 / CONFIG.WEATHER.DAY_LENGTH;
    this.hour += dt * hoursPerSecond;
    while (this.hour >= 24) { this.hour -= 24; this.day++; }

    this.timer += dt;
    if (this.timer >= this.nextChange) {
      this.timer = 0;
      this.nextChange = this.rng.range(CONFIG.WEATHER.CHANGE_EVERY[0], CONFIG.WEATHER.CHANGE_EVERY[1]);
      this.roll();
    }

    this.wind = damp(this.wind, this.windTarget, 0.9, dt);
    this.rain = damp(this.rain, this.rainTarget, 1.6, dt);
    this.wind = clamp(this.wind + Math.sin(this.hour * 7.3) * 0.02, 0, 1);

    if (this.isStorm) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.nextLightning = this.rng.range(2.5, 8);
        this.lightning = 1;
        this.bus.emit(EVT.WEATHER_CHANGE, { type: 'lightning', weather: this.snapshot() });
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 2.6);
  }

  /** Estrae una nuova condizione meteo (pesata, con inerzia sulla precedente). */
  roll(force = null) {
    const prev = this.condition;
    if (force && CONDITIONS[force]) {
      this.condition = force;
    } else {
      const weights = {};
      for (const [key, def] of Object.entries(CONDITIONS)) {
        weights[key] = key === prev ? def.weight * 0.35 : def.weight;
      }
      this.condition = this.rng.weighted(weights);
    }

    const range = CONFIG.WEATHER[this.info.wind + '_WIND'] || CONFIG.WEATHER.CALM_WIND;
    this.windTarget = this.rng.range(range[0], range[1]);
    if (this.rng.chance(0.35)) this.windDir *= -1;
    this.rainTarget = this.info.rain;

    if (prev !== this.condition) {
      this.bus.emit(EVT.WEATHER_CHANGE, { type: 'condition', from: prev, to: this.condition, weather: this.snapshot() });
      this.bus.emit(EVT.LOG, { text: 'Meteo: ' + this.info.label + ' ' + this.info.icon, kind: 'info' });
    }
  }

  /** Colori del cielo interpolati fra i keyframe orari. */
  skyColors() {
    const h = this.hour;
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (h >= SKY_KEYS[i].h && h <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    }
    const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
    const dark = this.info.dark;
    const grey = '#3A4152';
    return {
      top: mixColor(mixColor(a.top, b.top, t), grey, dark),
      mid: mixColor(mixColor(a.mid, b.mid, t), grey, dark),
      bot: mixColor(mixColor(a.bot, b.bot, t), grey, dark)
    };
  }

  /** Effetti meteo applicati a ogni turno di gioco. */
  onTurn() {
    const out = { waterBonus: 0, notes: [] };
    if (this.isRaining) {
      out.waterBonus = CONFIG.WEATHER.RAIN_WATER_BONUS * (this.isStorm ? 1.5 : 1);
      out.notes.push('La pioggia ricarica i serbatoi');
    }
    return out;
  }

  snapshot() {
    return {
      hour: this.hour, day: this.day, condition: this.condition,
      label: this.info.label, icon: this.info.icon,
      wind: this.wind, windDir: this.windDir, rain: this.rain,
      light: this.lightLevel, phase: this.phase, isNight: this.isNight
    };
  }

  serialize() {
    return {
      hour: this.hour, day: this.day, condition: this.condition,
      wind: this.wind, windDir: this.windDir, timer: this.timer, nextChange: this.nextChange
    };
  }

  deserialize(data) {
    if (!data) return;
    this.hour = typeof data.hour === 'number' ? data.hour : CONFIG.WEATHER.START_HOUR;
    this.day = data.day || 1;
    this.condition = CONDITIONS[data.condition] ? data.condition : 'clear';
    this.wind = this.windTarget = data.wind || 0.1;
    this.windDir = data.windDir || 1;
    this.rain = this.rainTarget = this.info.rain;
    this.timer = data.timer || 0;
    this.nextChange = data.nextChange || 30;
  }
}

export { CONDITIONS };
