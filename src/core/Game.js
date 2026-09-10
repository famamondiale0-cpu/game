/**
 * Game.js - Orchestratore: possiede tutti i sistemi e definisce le regole.
 *
 * FLUSSO DI UN TURNO (un turno = un piazzamento o un passaggio):
 *   1. validazione e pagamento
 *   2. il blocco cade nella colonna (gravita a griglia) e si assesta
 *   3. ECONOMIA   -> incassi, manutenzione, inquinamento
 *   4. EVENTI     -> incendi in corso, poi eventuale nuovo disastro
 *   5. FISICA     -> stress, torsione, crolli
 *   6. controllo Zenith / sconfitta
 */

import { CONFIG, getLevelGoal } from '../config/Config.js';
import { Grid } from './Grid.js';
import { BlockFactory, DRAW_WEIGHTS } from './BlockFactory.js';
import { EconomyEngine } from '../systems/EconomyEngine.js';
import { PhysicsSystem } from '../systems/PhysicsSystem.js';
import { WeatherSystem } from '../systems/WeatherSystem.js';
import { EventSystem } from '../systems/EventSystem.js';
import { ParticleEngine } from '../systems/ParticleEngine.js';
import { SoundEngine } from '../systems/SoundEngine.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { RenderEngine } from '../render/RenderEngine.js';
import { Engine, STATE } from './Engine.js';
import { EventBus, EVT } from '../utils/EventBus.js';
import { Random } from '../utils/Random.js';
import { clamp, formatNumber } from '../utils/Utils.js';

export class Game {
  constructor(canvas) {
    this.bus = new EventBus();
    this.rng = new Random();

    this.grid = new Grid();
    this.economy = new EconomyEngine(this.bus);
    this.physics = new PhysicsSystem(this.bus);
    this.weather = new WeatherSystem(this.bus, this.rng);
    this.events = new EventSystem(this.bus, this.rng);
    this.particles = new ParticleEngine();
    this.sound = new SoundEngine();
    this.save = new SaveSystem(this.bus);
    this.render = new RenderEngine(canvas, this.bus, this.particles);
    this.engine = new Engine(this.bus);

    this.turn = 0;
    this.level = 1;
    this.hand = [];
    this.queue = [];
    this.selected = 0;
    this.mode = 'build';         // 'build' | 'demolish'
    this.best = this.save.loadBest();
    this.lastPlacement = null;

    this.engine.bind((dt, state) => this.update(dt, state), () => this.draw());
    this._wireEffects();
  }

  // --- Ciclo di vita ---------------------------------------------------------

  newGame(seed = null) {
    this.rng = new Random(seed === null ? (Date.now() >>> 0) : seed);
    this.weather.rng = this.rng;
    this.events.rng = this.rng;

    this.grid.clear();
    this.economy.reset();
    this.physics.reset();
    this.weather.reset();
    this.events.reset();
    this.particles.clear();

    this.turn = 0;
    this.level = 1;
    this.selected = 0;
    this.mode = 'build';
    this.hand = [];
    this.queue = [];
    for (let i = 0; i < CONFIG.START.HAND_SIZE; i++) this.hand.push(this._drawType());
    for (let i = 0; i < 3; i++) this.queue.push(this._drawType());

    this.economy.evaluate(this.grid, this.events.modifiers);
    this.physics.analyze(this.grid, this.weather);

    this.engine.setState(STATE.PLAY);
    this.bus.emit(EVT.HAND_CHANGED, { hand: this.hand, queue: this.queue, selected: this.selected });
    this.bus.emit(EVT.TURN_END, this.snapshot());
    this.bus.emit(EVT.LOG, { text: 'Nuova partita: ' + this.goal.name + '. Costruisci fino allo Zenith!', kind: 'good' });
  }

  start() {
    this.render.resize();
    this.engine.start();
  }

  get goal() { return getLevelGoal(this.level); }

  /**
   * Costo corrente di un tipo: cresce con il numero di copie gia costruite
   * (curva di domanda). Demolire fa riscendere il prezzo.
   */
  costOf(type) {
    const base = BlockFactory.cost(type);
    const built = this.grid.listByType(type).length;
    const mult = Math.min(CONFIG.ECONOMY.COST_CAP, 1 + CONFIG.ECONOMY.COST_GROWTH * built);
    return Math.round(base * mult);
  }

  /** Stato sintetico letto dalla UI a ogni aggiornamento. */
  snapshot() {
    const s = this.economy.stats;
    return {
      turn: this.turn, level: this.level, goal: this.goal,
      coins: Math.round(this.economy.coins), score: Math.round(this.economy.score),
      pollution: this.economy.pollution, stats: s,
      height: this.grid.maxHeight(), blocks: this.grid.count(),
      stability: this.physics.report.stability,
      imbalance: this.physics.report.effectiveImbalance,
      weather: this.weather.snapshot(),
      fires: this.events.fireCount, nextEvent: this.events.countdown,
      modifiers: this.events.modifiers, best: this.best,
      state: this.engine.state, mode: this.mode
    };
  }

  // --- Mazzo e mano ----------------------------------------------------------

  _drawType() {
    // il mazzo si adatta: se manca energia o acqua, aumenta la probabilita
    const w = { ...DRAW_WEIGHTS };
    const s = this.economy.stats;
    if (s.blackout) w.POW += 14;
    if (s.drought) w.WAT += 12;
    if (this.economy.pollution > CONFIG.ECONOMY.POLLUTION_TOLERANCE * 0.8) w.PAR += 10;
    if (this.physics.report.maxStress > 0.85) w.SUP += 12;
    return this.rng.weighted(w);
  }

  selectCard(index) {
    if (index < 0 || index >= this.hand.length) return;
    this.selected = index;
    this.mode = 'build';
    this.sound.select();
    this.bus.emit(EVT.SELECTION, { index, type: this.hand[index] });
  }

  get selectedType() { return this.hand[this.selected] || null; }

  /** Scarta la carta selezionata pagando una piccola penale. */
  discardSelected() {
    const type = this.selectedType;
    if (!type) return false;
    if (!this.economy.spend(CONFIG.START.DISCARD_COST)) {
      this.bus.emit(EVT.LOG, { text: 'Monete insufficienti per scartare.', kind: 'bad' });
      this.sound.error();
      return false;
    }
    this.hand[this.selected] = this.queue.shift();
    this.queue.push(this._drawType());
    this.sound.click();
    this.bus.emit(EVT.HAND_CHANGED, { hand: this.hand, queue: this.queue, selected: this.selected });
    this.bus.emit(EVT.TURN_END, this.snapshot());
    return true;
  }

  toggleMode() {
    this.mode = this.mode === 'build' ? 'demolish' : 'build';
    this.sound.click();
    this.bus.emit(EVT.TURN_END, this.snapshot());
  }

  // --- Regole di piazzamento -------------------------------------------------

  /** Verifica se il tipo puo essere piazzato nella colonna: motivo se no. */
  canPlace(col, type) {
    if (this.engine.state !== STATE.PLAY) return { ok: false, reason: 'Partita in pausa' };
    if (col < 0 || col >= this.grid.cols) return { ok: false, reason: 'Fuori griglia' };
    const row = this.grid.landingRow(col);
    if (row < 0) return { ok: false, reason: 'Colonna piena' };
    const def = BlockFactory.def(type);
    if (def.requiresSupport && row === 0) return { ok: false, reason: 'Il parco richiede un blocco sotto' };
    const cost = this.costOf(type);
    if (!this.economy.canAfford(cost)) return { ok: false, reason: 'Servono ' + cost + ' monete' };
    return { ok: true, row, cost };
  }

  /** Piazza la carta selezionata nella colonna indicata e chiude il turno. */
  placeSelected(col) {
    const type = this.selectedType;
    if (!type) return false;
    const check = this.canPlace(col, type);
    if (!check.ok) {
      this.sound.error();
      this.bus.emit(EVT.LOG, { text: check.reason, kind: 'bad' });
      this.render.shake(3);
      return false;
    }

    const def = BlockFactory.def(type);
    const cost = check.cost;
    this.economy.spend(cost);

    const row = check.row;
    const cell = BlockFactory.create(type, col, row, this.turn + 1);
    cell.anim.fall = this.grid.rows - row + 1.5;   // parte da sopra la griglia
    cell.anim.vy = 6;
    this.grid.set(col, row, cell);
    this.lastPlacement = { col, row, type };

    this.sound.place(def.weight);
    this.render.floaterAtCell(col, row, '-' + cost, '#ff8a80', 13);
    this.bus.emit(EVT.BLOCK_PLACED, { cell, col, row, type });

    // pesca una nuova carta dalla coda
    this.hand[this.selected] = this.queue.shift();
    this.queue.push(this._drawType());
    this.bus.emit(EVT.HAND_CHANGED, { hand: this.hand, queue: this.queue, selected: this.selected });

    this.endTurn({ placedRow: row, col });
    return true;
  }

  /** Demolisce un blocco: costa una tassa, restituisce parte del valore. */
  demolish(col, row) {
    if (this.engine.state !== STATE.PLAY) return false;
    const cell = this.grid.get(col, row);
    if (!cell) return false;

    const def = BlockFactory.def(cell.type);
    const fee = CONFIG.ECONOMY.DEMOLISH_FEE;
    if (!this.economy.canAfford(fee)) {
      this.sound.error();
      this.bus.emit(EVT.LOG, { text: 'Servono ' + fee + ' monete per demolire.', kind: 'bad' });
      return false;
    }
    this.economy.spend(fee);
    const refund = Math.round(def.cost * CONFIG.ECONOMY.DEMOLISH_REFUND);
    this.economy.earn(refund);

    this.grid.clearAt(col, row);
    this.events.extinguish(cell);
    const moves = this.grid.compactColumn(col);
    for (const m of moves) { m.cell.anim.fall = (m.from - m.to); m.cell.anim.vy = 0; }

    this.render.burstAtCell(col, row, def.color);
    this.render.floaterAtCell(col, row, '+' + refund, '#ffd54f', 13);
    this.sound.demolish();
    this.render.shake(4);
    this.bus.emit(EVT.BLOCK_DESTROYED, { cell, col, row, reason: 'demolizione' });

    this.economy.evaluate(this.grid, this.events.modifiers);
    this.physics.analyze(this.grid, this.weather);
    this.bus.emit(EVT.TURN_END, this.snapshot());
    return true;
  }

  /** Passa il turno senza costruire: utile per accumulare liquidita. */
  skipTurn() {
    if (this.engine.state !== STATE.PLAY) return false;
    this.bus.emit(EVT.LOG, { text: 'Turno passato: la citta lavora da sola.', kind: 'info' });
    this.endTurn({ skipped: true });
    return true;
  }

  // --- Chiusura del turno ----------------------------------------------------

  endTurn(info = {}) {
    this.turn++;

    // 1. ECONOMIA
    const weatherTurn = this.weather.onTurn();
    const summary = this.economy.applyTurn(this.grid, this.events.modifiers, this.weather);
    this._economyFeedback(summary);

    // 2. EVENTI (incendi in corso + eventuale disastro)
    const evtResult = this.events.onTurn({
      grid: this.grid, economy: this.economy, physics: this.physics,
      weather: this.weather, turn: this.turn
    });
    if (evtResult.event) this._eventFeedback(evtResult.event);

    // 3. FISICA: stress, torsione, crolli
    const collapses = this.physics.resolveTurn(this.grid, this.weather);
    if (collapses.length) {
      this.sound.collapse(collapses.length);
      this.bus.emit(EVT.LOG, {
        text: collapses.length + ' blocchi crollati (' + collapses[0].reason + ')', kind: 'bad'
      });
    }

    // 4. Ricalcolo finale e controllo obiettivi
    this.economy.evaluate(this.grid, this.events.modifiers);
    this.physics.analyze(this.grid, this.weather);
    this.best = this.save.saveBest(this.economy.score);

    if (weatherTurn.waterBonus > 0 && this.turn % 2 === 0) {
      this.bus.emit(EVT.LOG, { text: weatherTurn.notes[0], kind: 'info' });
    }

    this.sound.setMood(this.weather.phase, clamp(this.grid.count() / 60, 0, 1));
    this.bus.emit(EVT.TURN_END, this.snapshot());

    if (info.placedRow === this.grid.rows - 1) this._checkZenith();
    else this._checkDeadEnd();

    this.autosave();
  }

  /** Feedback visivo/sonoro dei flussi economici. */
  _economyFeedback(summary) {
    const s = summary.stats;
    for (const cell of this.grid.list()) {
      const entry = s.perCell.get(cell.id);
      if (!entry) continue;
      if (entry.coins >= 8) {
        const p = this.render.cellCenter(cell.col, cell.row);
        this.particles.coin(p.x, p.y, Math.min(5, Math.round(entry.coins / 8)));
      }
    }
    if (summary.net > 0) {
      this.render.floaterAtCell(
        Math.floor(this.grid.cols / 2), Math.min(this.grid.rows - 1, this.grid.maxHeight() + 1),
        '+' + formatNumber(summary.net), '#ffd54f', 18
      );
      this.sound.coin(Math.round(summary.net / 20));
    } else if (summary.net < 0) {
      this.bus.emit(EVT.LOG, { text: 'Bilancio negativo: ' + summary.net + ' monete.', kind: 'warn' });
    }
    if (s.blackout) this.bus.emit(EVT.LOG, { text: 'BLACKOUT: serve piu energia!', kind: 'bad' });
    if (s.drought) this.bus.emit(EVT.LOG, { text: 'Carenza idrica: costruisci un serbatoio.', kind: 'warn' });
  }

  _eventFeedback(event) {
    switch (event.id) {
      case 'QUAKE': this.sound.quake(); this.render.flashScreen(0.25); break;
      case 'FIRE': this.sound.fire(); break;
      case 'INSPECTION': this.sound.alarm(); break;
      case 'IMMIGRATION': this.sound.coin(3); break;
      case 'GRANT': this.sound.coin(4); break;
      default: break;
    }

  }

  // --- Vittoria e sconfitta --------------------------------------------------

  /** Raggiunta la riga 20: si sale di livello solo se gli obiettivi sono centrati. */
  _checkZenith() {
    const g = this.goal;
    const s = this.economy.stats;
    const ok = s.population >= g.population
      && s.happiness >= g.happiness
      && this.economy.pollution <= g.maxPollution;

    if (ok) this.levelUp();
    else {
      this.gameOver('SATURAZIONE STRUTTURALE',
        'Hai toccato lo Zenith senza soddisfare i requisiti del distretto.');
    }
  }

  /** Nessuna mossa possibile: partita finita. */
  _checkDeadEnd() {
    let free = 0;
    for (let c = 0; c < this.grid.cols; c++) if (this.grid.landingRow(c) >= 0) free++;
    if (free === 0) {
      this.gameOver('CITTA SATURA', 'Ogni colonna e piena: non c e piu spazio per costruire.');
    }
  }

  levelUp() {
    const g = this.goal;
    this.economy.earn(g.reward);
    this.economy.score += 1000 * this.level;
    this.level++;
    this.engine.setState(STATE.LEVELUP);
    this.sound.levelUp();
    this.render.flashScreen(0.5);
    this.render.shake(10);

    // fuochi d'artificio sui blocchi esistenti
    this.grid.each((cell, col, row) => {
      if (this.rng.chance(0.35)) this.render.burstAtCell(col, row, BlockFactory.def(cell.type).colorLight);
    });

    this.bus.emit(EVT.LEVEL_UP, {
      level: this.level, previous: g, reward: g.reward,
      next: this.goal, snapshot: this.snapshot()
    });
    this.bus.emit(EVT.LOG, { text: 'DISTRETTO COMPLETATO! +' + g.reward + ' monete.', kind: 'good' });
  }

  /** Conferma del giocatore: si riparte da una nuova base al livello successivo. */
  continueToNextLevel() {
    this.grid.clear();
    this.particles.clear();
    this.physics.reset();
    this.events.reset();
    this.economy.evaluate(this.grid, this.events.modifiers);
    this.physics.analyze(this.grid, this.weather);
    this.hand = [];
    this.queue = [];
    for (let i = 0; i < CONFIG.START.HAND_SIZE; i++) this.hand.push(this._drawType());
    for (let i = 0; i < 3; i++) this.queue.push(this._drawType());
    this.selected = 0;
    this.engine.setState(STATE.PLAY);
    this.bus.emit(EVT.HAND_CHANGED, { hand: this.hand, queue: this.queue, selected: this.selected });
    this.bus.emit(EVT.TURN_END, this.snapshot());
    this.bus.emit(EVT.LOG, { text: 'Livello ' + this.level + ' - ' + this.goal.name, kind: 'good' });
  }

  gameOver(title, reason) {
    if (this.engine.state === STATE.GAMEOVER) return;
    this.engine.setState(STATE.GAMEOVER);
    this.best = this.save.saveBest(this.economy.score);
    this.sound.gameOver();
    this.render.shake(16);
    this.render.flashScreen(0.35);
    this.bus.emit(EVT.GAME_OVER, {
      title, reason, score: Math.round(this.economy.score),
      best: this.best, level: this.level, turn: this.turn,
      snapshot: this.snapshot()
    });
    this.bus.emit(EVT.LOG, { text: title + ' - ' + reason, kind: 'bad' });
  }

  // --- Loop ------------------------------------------------------------------

  update(dt, state) {
    const playing = state === STATE.PLAY;
    if (playing) {
      this.weather.update(dt);
      this.physics.update(dt, this.weather);
      if (this.weather.isRaining && Math.random() < dt * 2) this.sound.rainLoop(this.weather.rain);
    }
    if (state !== STATE.PAUSE) {
      this.render.update(dt, this);
      this.particles.update(dt, this.weather.windVector);
    }
    this.sound.update();
  }

  draw() { this.render.render(this); }

  // --- Persistenza -----------------------------------------------------------

  getState() {
    return {
      rng: this.rng.serialize(),
      turn: this.turn,
      level: this.level,
      grid: this.grid.serialize(),
      economy: this.economy.serialize(),
      weather: this.weather.serialize(),
      events: this.events.serialize(),
      hand: this.hand.slice(),
      queue: this.queue.slice()
    };
  }

  getMeta() {
    const s = this.economy.stats;
    return {
      level: this.level, turn: this.turn,
      score: Math.round(this.economy.score),
      population: s.population, happiness: s.happiness,
      height: this.grid.maxHeight(), name: this.goal.name
    };
  }

  saveToSlot(slot) { return this.save.save(slot, this.getState(), this.getMeta()); }

  autosave() {
    if (this.turn % 3 !== 0) return;
    this.save.save(CONFIG.SAVE.AUTOSLOT, this.getState(), { ...this.getMeta(), auto: true });
  }

  loadFromSlot(slot) {
    const data = this.save.load(slot);
    if (!data) {
      this.bus.emit(EVT.LOG, { text: 'Slot ' + (slot + 1) + ' vuoto.', kind: 'warn' });
      return false;
    }
    this.applyState(data.state);
    this.bus.emit(EVT.LOADED, { slot, meta: data.meta });
    this.bus.emit(EVT.LOG, { text: 'Partita caricata dallo slot ' + (slot + 1), kind: 'good' });
    return true;
  }

  applyState(state) {
    this.rng.deserialize(state.rng);
    this.weather.rng = this.rng;
    this.events.rng = this.rng;
    this.turn = state.turn || 0;
    this.level = state.level || 1;
    this.grid.deserialize(state.grid);
    this.economy.deserialize(state.economy);
    this.weather.deserialize(state.weather);
    this.events.deserialize(state.events);
    this.hand = (state.hand || []).filter((t) => BlockFactory.exists(t));
    this.queue = (state.queue || []).filter((t) => BlockFactory.exists(t));
    while (this.hand.length < CONFIG.START.HAND_SIZE) this.hand.push(this._drawType());
    while (this.queue.length < 3) this.queue.push(this._drawType());
    this.selected = 0;
    this.mode = 'build';
    this.particles.clear();
    this.economy.evaluate(this.grid, this.events.modifiers);
    this.physics.analyze(this.grid, this.weather);
    this.render.computeLayout(this.grid.cols, this.grid.rows);
    this.engine.setState(STATE.PLAY);
    this.bus.emit(EVT.HAND_CHANGED, { hand: this.hand, queue: this.queue, selected: this.selected });
    this.bus.emit(EVT.TURN_END, this.snapshot());
  }

  // --- Collegamenti effetti --------------------------------------------------

  _wireEffects() {
    this.bus.on(EVT.FLOATER, (p) => {
      this.render.floaterAtCell(p.col, p.row, p.text, p.color, p.size);
    });

    this.bus.on(EVT.BLOCK_LANDED, (p) => {
      this.sound.land(BlockFactory.weight(p.cell.type));
    });

    this.bus.on(EVT.BLOCK_DESTROYED, (p) => {
      if (p.reason === 'demolizione') return;
      this.render.burstAtCell(p.col, p.row, BlockFactory.def(p.cell.type).color);
    });

    this.bus.on(EVT.WEATHER_CHANGE, (p) => {
      if (p.type === 'lightning') { this.sound.thunder(); this.render.flashScreen(0.5); }
    });
  }
}

export { STATE };
