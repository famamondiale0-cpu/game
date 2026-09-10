/**
 * UIController.js - Tutta l'interfaccia HTML/DOM sovrapposta al canvas:
 * HUD risorse, obiettivi, pannello struttura, mano di carte, log, modali,
 * input di mouse/tocco/tastiera.
 *
 * Non contiene logica di gioco: legge gli snapshot dal bus e chiama i metodi
 * pubblici di Game.
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory, BLOCK_TYPES } from '../core/BlockFactory.js';
import { EVT } from '../utils/EventBus.js';
import { STATE } from '../core/Engine.js';
import { clamp, formatNumber, formatClock } from '../utils/Utils.js';

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export class UIController {
  constructor(game) {
    this.game = game;
    this.bus = game.bus;
    this.canvas = game.render.canvas;
    this.logEntries = [];
    this.legendCosts = new Map();
    this.tooltipTimer = null;

    this.el = {
      stage: qs('#stage'),
      hand: qs('#hand'),
      queue: qs('#queue'),
      log: qs('#log'),
      tooltip: qs('#tooltip'),
      modal: qs('#modal'),
      modalTitle: qs('#modal-title'),
      modalBody: qs('#modal-body'),
      modalActions: qs('#modal-actions'),
      banner: qs('#banner'),
      hint: qs('#touch-hint')
    };

    this.values = {};
    qsa('[data-ui]').forEach((n) => { this.values[n.dataset.ui] = n; });
    this.bars = {};
    qsa('[data-bar]').forEach((n) => { this.bars[n.dataset.bar] = n; });

    this._bindBus();
    this._bindInput();
    this._bindButtons();
    this.buildLegend();
  }

  // --- Collegamento agli eventi di gioco -------------------------------------

  _bindBus() {
    this.bus.on(EVT.TURN_END, (snap) => this.updateHUD(snap));
    this.bus.on(EVT.HAND_CHANGED, (p) => this.renderHand(p));
    this.bus.on(EVT.SELECTION, () => this.renderHand({
      hand: this.game.hand, queue: this.game.queue, selected: this.game.selected
    }));
    this.bus.on(EVT.LOG, (p) => this.addLog(p.text, p.kind));
    this.bus.on(EVT.DISASTER, (p) => this.showBanner(p.def.icon + ' ' + p.def.name, p.detail, p.def.kind));
    this.bus.on(EVT.LEVEL_UP, (p) => this.showLevelUp(p));
    this.bus.on(EVT.GAME_OVER, (p) => this.showGameOver(p));
    this.bus.on(EVT.STATE_CHANGED, (p) => this.onStateChanged(p));
    this.bus.on(EVT.WEATHER_CHANGE, (p) => {
      if (p.type === 'condition') this.showBanner(p.weather.icon + ' ' + p.weather.label, 'Il meteo e cambiato', 'info');
    });
  }

  onStateChanged({ next }) {
    document.body.dataset.state = next;
    const btn = qs('[data-action="pause"]');
    if (btn) btn.textContent = next === STATE.PAUSE ? '▶' : '⏸';
    if (next === STATE.PAUSE) this.showPause();
    else if (next === STATE.MENU) this.showMenu();
    else if (next === STATE.PLAY) this.hideModal();
  }

  // --- HUD -------------------------------------------------------------------

  set(key, text) {
    const node = this.values[key];
    if (node && node.textContent !== String(text)) node.textContent = text;
  }

  bar(key, ratio, colorClass) {
    const node = this.bars[key];
    if (!node) return;
    node.style.width = clamp(ratio * 100, 0, 100) + '%';
    if (colorClass) node.dataset.tone = colorClass;
  }

  updateHUD(snap) {
    const s = snap.stats;
    this.set('coins', formatNumber(snap.coins));
    this.set('score', formatNumber(snap.score));
    this.set('population', formatNumber(s.population));
    this.set('happiness', Math.round(s.happiness) + '%');
    this.set('pollution', Math.round(snap.pollution));
    this.set('energy', Math.round(s.energyProd) + '/' + Math.round(s.energyUse));
    this.set('water', Math.round(s.waterProd) + '/' + Math.round(s.waterUse));
    this.set('income', (s.netIncome >= 0 ? '+' : '') + formatNumber(s.netIncome));
    this.set('turn', snap.turn);
    this.set('level', snap.level);
    this.set('levelName', snap.goal.name);
    this.set('height', snap.height + '/' + CONFIG.GRID.ROWS);
    this.set('blocks', snap.blocks);
    this.set('best', formatNumber(snap.best));

    // meteo e orologio
    this.set('clock', formatClock(snap.weather.hour));
    this.set('day', 'G' + snap.weather.day);
    this.set('weather', snap.weather.icon + ' ' + snap.weather.label);
    this.set('wind', Math.round(snap.weather.wind * 100) + '%');
    this.set('phase', snap.weather.phase);

    // barre di stato
    this.bar('happiness', s.happiness / 100, s.happiness > 60 ? 'good' : s.happiness > 35 ? 'warn' : 'bad');
    this.bar('pollution', snap.pollution / CONFIG.ECONOMY.POLLUTION_MAX,
      snap.pollution > CONFIG.ECONOMY.POLLUTION_TOLERANCE ? 'bad' : 'good');
    this.bar('energy', s.energyProd === 0 ? 0 : clamp(s.energyProd / Math.max(1, s.energyUse), 0, 1),
      s.blackout ? 'bad' : 'good');
    this.bar('water', s.waterProd === 0 ? 0 : clamp(s.waterProd / Math.max(1, s.waterUse), 0, 1),
      s.drought ? 'bad' : 'good');

    // obiettivi del livello
    const g = snap.goal;
    this.set('goalPop', Math.round(s.population) + ' / ' + g.population);
    this.set('goalHappy', Math.round(s.happiness) + ' / ' + g.happiness);
    this.set('goalPollution', Math.round(snap.pollution) + ' / ' + g.maxPollution);
    this.bar('goalPop', s.population / g.population, s.population >= g.population ? 'good' : 'warn');
    this.bar('goalHappy', s.happiness / g.happiness, s.happiness >= g.happiness ? 'good' : 'warn');
    this.bar('goalPollution', snap.pollution / g.maxPollution, snap.pollution <= g.maxPollution ? 'good' : 'bad');

    // struttura
    const st = this.game.physics.statusLabel();
    this.set('stability', Math.round(snap.stability * 100) + '%');
    this.set('structure', st.text);
    const stNode = this.values.structure;
    if (stNode) stNode.dataset.tone = st.kind;
    this.bar('stability', snap.stability, st.kind);
    this.set('weight', formatNumber(this.game.physics.report.totalWeight) + ' kg');
    this.set('stress', Math.round(this.game.physics.report.maxStress * 100) + '%');
    this.set('imbalance', (snap.imbalance >= 0 ? '→ ' : '← ') + Math.round(Math.abs(snap.imbalance) * 100) + '%');

    // v1.1.0 - stagione, distretti, ponti, sicurezza
    this.set('season', snap.season.icon + ' ' + snap.season.name);
    this.set('seasonLeft', snap.seasonTurnsLeft);
    this.set('districts', snap.districts + (snap.starvedDistricts ? ' (' + snap.starvedDistricts + ' isolati)' : ''));
    this.set('bridges', snap.bridges);
    this.set('windResist', Math.round(snap.windResistance * 100) + '%');
    const secNode = this.values.security;
    if (secNode) {
      const bad = snap.insecure.length > 0;
      secNode.textContent = bad
        ? 'colonne ' + snap.insecure.map((c) => c + 1).join(', ')
        : (snap.markets > 0 ? 'presidiata' : 'OK');
      secNode.dataset.tone = bad ? 'bad' : 'good';
    }

    // eventi
    this.set('nextEvent', snap.nextEvent + ' turni');
    this.set('fires', snap.fires);
    const modNode = this.values.modifiers;
    if (modNode) {
      const mods = [];
      if (snap.modifiers.resMultiplier > 1) mods.push('🧳 Immigrazione x' + snap.modifiers.resMultiplier);
      if (snap.fires > 0) mods.push('🔥 ' + snap.fires + ' incendi attivi');
      if (snap.stats.blackout) mods.push('⚡ Blackout');
      if (snap.stats.drought) mods.push('💧 Carenza idrica');
      if (snap.season.id === 'inverno') mods.push('❄️ Riscaldamento: consumi RES x2');
      if (snap.season.id === 'estate') mods.push('☀️ Caldo: centrali a rischio');
      if (snap.insecure.length) mods.push('🕴️ ' + snap.insecure.length + ' colonne insicure');
      if (snap.bridges) mods.push('🌉 ' + snap.bridges + ' ponti (-' + Math.round((1 - snap.windResistance) * 100) + '% vento)');
      modNode.textContent = mods.length ? mods.join(' · ') : 'Nessun effetto attivo';
    }

    for (const [type, node] of this.legendCosts) {
      if (node) node.textContent = this.game.costOf(type);
    }

    this.renderHand({ hand: this.game.hand, queue: this.game.queue, selected: this.game.selected });
    document.body.dataset.mode = snap.mode;
  }

  // --- Mano di carte ---------------------------------------------------------

  renderHand({ hand, queue, selected }) {
    if (!this.el.hand) return;
    const coins = this.game.economy.coins;

    if (this.el.hand.children.length !== hand.length) {
      this.el.hand.innerHTML = '';
      hand.forEach((type, i) => this.el.hand.appendChild(this._buildCard(type, i)));
    }

    hand.forEach((type, i) => {
      const card = this.el.hand.children[i];
      if (!card) return;
      const cost = this.game.costOf(type);
      if (card.dataset.type !== type) {
        const fresh = this._buildCard(type, i);
        this.el.hand.replaceChild(fresh, card);
        fresh.classList.add('dealt');
        return;
      }
      card.classList.toggle('selected', i === selected);
      card.classList.toggle('locked', coins < cost);
      const costNode = qs('.card-cost', card);
      if (costNode) costNode.textContent = cost;
    });

    if (this.el.queue) {
      this.el.queue.innerHTML = '';
      queue.forEach((type) => {
        const def = BlockFactory.def(type);
        const chip = document.createElement('div');
        chip.className = 'queue-chip';
        chip.style.setProperty('--c', def.color);
        chip.innerHTML = '<span>' + def.icon + '</span>';
        chip.title = def.name;
        this.el.queue.appendChild(chip);
      });
    }
  }

  _buildCard(type, index) {
    const def = BlockFactory.def(type);
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.type = type;
    card.dataset.index = index;
    card.style.setProperty('--c', def.color);
    card.style.setProperty('--c-dark', def.colorDark);
    card.style.setProperty('--c-light', def.colorLight);
    const cost = this.game.costOf(type);
    card.innerHTML =
      '<span class="card-key">' + (index + 1) + '</span>' +
      '<span class="card-icon">' + def.icon + '</span>' +
      '<span class="card-name">' + def.short + '</span>' +
      '<span class="card-cost">' + cost + '</span>';

    card.addEventListener('click', () => this.game.selectCard(index));
    card.addEventListener('mouseenter', (e) => this.showTooltip(type, e.currentTarget));
    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      clearTimeout(this._holdTimer);
      this._holdTimer = setTimeout(() => this.showTooltip(type, card), 420);
    });
    const endHold = () => { clearTimeout(this._holdTimer); setTimeout(() => this.hideTooltip(), 2600); };
    card.addEventListener('pointerup', endHold);
    card.addEventListener('pointercancel', endHold);
    card.addEventListener('mouseleave', () => this.hideTooltip());
    card.addEventListener('focus', (e) => this.showTooltip(type, e.currentTarget));
    card.addEventListener('blur', () => this.hideTooltip());
    return card;
  }

  /** Legenda dei blocchi nel pannello laterale. */
  buildLegend() {
    const box = qs('#legend');
    if (!box) return;
    box.innerHTML = '';
    this.legendCosts = new Map();
    for (const type of BLOCK_TYPES) {
      const def = BlockFactory.def(type);
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML =
        '<span class="legend-swatch" style="background:' + def.color + '"></span>' +
        '<span class="legend-name">' + def.icon + ' ' + def.name + '</span>' +
        '<span class="legend-cost">' + def.cost + '</span>';
      row.addEventListener('mouseenter', () => this.showTooltip(type, row));
      row.addEventListener('mouseleave', () => this.hideTooltip());
      box.appendChild(row);
      this.legendCosts.set(type, row.querySelector('.legend-cost'));
    }
  }

  // --- Tooltip ---------------------------------------------------------------

  showTooltip(type, anchor) {
    const tip = this.el.tooltip;
    if (!tip) return;
    const def = BlockFactory.def(type);
    const effects = BlockFactory.effectsText(type);
    const synergy = BlockFactory.synergyText(type);

    tip.innerHTML =
      '<div class="tip-head" style="--c:' + def.color + '">' + def.icon + ' ' + def.name +
      '<span class="tip-cost">' + this.game.costOf(type) + ' 🪙</span></div>' +
      '<p class="tip-desc">' + def.desc + '</p>' +
      '<div class="tip-grid">' +
        '<span>Peso</span><b>' + def.weight + ' kg</b>' +
        '<span>Tolleranza</span><b>' + def.capacity + ' kg</b>' +
        '<span>Prezzo base</span><b>' + def.cost + ' 🪙</b>' +
      '</div>' +
      (effects.length ? '<ul class="tip-list">' + effects.map((e) => '<li>' + e + '</li>').join('') + '</ul>' : '') +
      (synergy.length ? '<ul class="tip-list syn">' + synergy.map((e) => '<li>' + e + '</li>').join('') + '</ul>' : '');

    tip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = clamp(left, 8, window.innerWidth - tr.width - 8);
    let top = r.top - tr.height - 10;
    if (top < 8) top = r.bottom + 10;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  hideTooltip() { if (this.el.tooltip) this.el.tooltip.hidden = true; }

  // --- Log e banner ----------------------------------------------------------

  addLog(text, kind = 'info') {
    if (!this.el.log) return;
    const row = document.createElement('div');
    row.className = 'log-row ' + kind;
    row.innerHTML = '<span class="log-turn">T' + this.game.turn + '</span>' + text;
    this.el.log.prepend(row);
    this.logEntries.push(text);
    while (this.el.log.children.length > 60) this.el.log.lastChild.remove();
  }

  showBanner(title, subtitle, kind = 'info') {
    const b = this.el.banner;
    if (!b) return;
    b.className = 'banner show ' + kind;
    b.innerHTML = '<strong>' + title + '</strong><span>' + (subtitle || '') + '</span>';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { b.className = 'banner'; }, 3200);
  }

  // --- Input mouse / tocco ---------------------------------------------------

  _bindInput() {
    const c = this.canvas;
    this.armed = null;          // bersaglio in attesa di conferma (solo tocco)
    this.dragging = false;
    this.isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    const toCell = (ev) => {
      const rect = c.getBoundingClientRect();
      const x = (ev.clientX - rect.left) * (c.width / this.game.render.dpr / rect.width);
      const y = (ev.clientY - rect.top) * (c.height / this.game.render.dpr / rect.height);
      return this.game.render.screenToCell(x, y);
    };

    const aim = (hit) => {
      const r = this.game.render;
      r.hoverCol = (hit.col >= 0 && hit.col < this.game.grid.cols) ? hit.col : -1;
      r.hoverRow = hit.row;
      this.updateGhost();
    };

    c.addEventListener('pointermove', (ev) => {
      const touch = ev.pointerType === 'touch';
      if (touch && !this.dragging) return;   // senza dito appoggiato non c'e hover
      const hit = toCell(ev);
      aim(hit);
      if (touch && hit.inside) this._setArmed(hit, false);
    });

    c.addEventListener('pointerleave', () => {
      if (this.isTouch) return;
      this.game.render.hoverCol = -1;
      this.game.render.ghostPreview = null;
    });

    c.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.game.sound.init();
      this.game.sound.resume();
      const hit = toCell(ev);
      if (!hit.inside) return;

      if (ev.pointerType === 'touch') {
        // Due fasi: il primo tocco mira, il secondo conferma.
        this.dragging = true;
        this._gestureWasArmed = this._isArmed(hit);
        aim(hit);
        this._setArmed(hit, false);
      } else {
        this._commit(hit, ev.button === 2);
        this.updateGhost();
      }
    });

    c.addEventListener('pointerup', (ev) => {
      if (ev.pointerType !== 'touch') return;
      this.dragging = false;
      const hit = toCell(ev);
      if (!hit.inside) return;
      if (this._gestureWasArmed && this._isArmed(hit)) {
        this._commit(hit, false);
        this.clearArmed();
      } else {
        this._setArmed(hit, true);
      }
      this._gestureWasArmed = false;
    });

    c.addEventListener('pointercancel', () => { this.dragging = false; });
    c.addEventListener('contextmenu', (ev) => ev.preventDefault());

    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const dir = ev.deltaY > 0 ? 1 : -1;
      const n = this.game.hand.length;
      this.game.selectCard((this.game.selected + dir + n) % n);
      this.updateGhost();
    }, { passive: false });

    window.addEventListener('keydown', (ev) => this._onKey(ev));
  }

  /** In costruzione conta solo la colonna, in demolizione anche la riga. */
  _isArmed(hit) {
    if (!this.armed) return false;
    if (this.game.mode === 'demolish') return this.armed.col === hit.col && this.armed.row === hit.row;
    return this.armed.col === hit.col;
  }

  /** Arma un bersaglio e, se richiesto, mostra il suggerimento di conferma. */
  _setArmed(hit, withHint) {
    const changed = !this._isArmed(hit);
    this.armed = { col: hit.col, row: hit.row };
    this.game.render.armedCell = this.game.mode === 'demolish' ? this.armed : null;
    if (!withHint) return;

    if (this.game.mode === 'demolish') {
      const cell = this.game.grid.get(hit.col, hit.row);
      this.showHint(cell ? 'Tocca di nuovo per demolire' : 'Nessun blocco da demolire qui');
      return;
    }
    const type = this.game.selectedType;
    if (!type) return;
    const check = this.game.canPlace(hit.col, type);
    this.showHint(check.ok
      ? 'Tocca di nuovo per costruire (' + check.cost + ' 🪙)'
      : check.reason);
    if (changed) this.game.sound.select();
  }

  clearArmed() {
    this.armed = null;
    this.game.render.armedCell = null;
  }

  /** Esegue l'azione sul bersaglio: costruisci oppure demolisci. */
  _commit(hit, forceDemolish) {
    if (this.game.mode === 'demolish' || forceDemolish) {
      const cell = this.game.grid.get(hit.col, hit.row);
      if (cell) this.game.demolish(hit.col, hit.row);
      else this.game.sound.error();
    } else {
      this.game.placeSelected(hit.col, hit.row);
    }
  }

  /** Messaggio contestuale sopra la scena (usato soprattutto su telefono). */
  showHint(text) {
    const node = this.el.hint;
    if (!node) return;
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  togglePanels(force) {
    const open = force === undefined ? document.body.dataset.panels !== 'open' : force;
    document.body.dataset.panels = open ? 'open' : 'closed';
    this.game.sound.click();
  }

  /** Aggiorna l'anteprima (ghost) del blocco selezionato. */
  updateGhost() {
    const r = this.game.render;
    const type = this.game.selectedType;
    r.ghostType = this.game.mode === 'demolish' ? null : type;
    r.ghostSpan = null;
    if (!type || r.hoverCol < 0) { r.ghostPreview = null; r.ghostRow = null; return; }

    // i blocchi ancorati si posano nella cella puntata, non in fondo alla colonna
    const check = this.game.canPlace(r.hoverCol, type, r.hoverRow);
    r.ghostValid = check.ok;
    r.ghostRow = check.ok ? check.row : r.hoverRow;
    r.ghostSpan = check.span || null;
    r.ghostReason = check.ok ? null : check.reason;
    r.ghostPreview = check.ok
      ? this.game.economy.previewPlacement(this.game.grid, r.hoverCol, check.row, type)
      : null;
    if (check.ok && check.cost) r.ghostPreview.cost = check.cost;
  }

  _onKey(ev) {
    const k = ev.key.toLowerCase();
    if (k >= '1' && k <= '9') {
      const i = parseInt(k, 10) - 1;
      if (i < this.game.hand.length) { this.game.selectCard(i); this.updateGhost(); }
      return;
    }
    const r = this.game.render;
    switch (k) {
      case 'arrowleft': case 'a':
        r.hoverCol = clamp((r.hoverCol < 0 ? 0 : r.hoverCol - 1), 0, this.game.grid.cols - 1);
        this.updateGhost(); ev.preventDefault(); break;
      case 'arrowright': case 'd':
        r.hoverCol = clamp((r.hoverCol < 0 ? 0 : r.hoverCol + 1), 0, this.game.grid.cols - 1);
        this.updateGhost(); ev.preventDefault(); break;
      case 'arrowup': case 'w':
        r.hoverRow = clamp((r.hoverRow || 0) + 1, 0, this.game.grid.rows - 1);
        this.updateGhost(); ev.preventDefault(); break;
      case 's':
        r.hoverRow = clamp((r.hoverRow || 0) - 1, 0, this.game.grid.rows - 1);
        this.updateGhost(); ev.preventDefault(); break;
      case 'arrowdown': case ' ': case 'enter':
        if (r.hoverCol >= 0) { this.game.placeSelected(r.hoverCol, r.hoverRow); this.updateGhost(); }
        ev.preventDefault(); break;
      case 'x': this.game.toggleMode(); this.clearArmed(); this.updateGhost(); break;
      case 'n': this.game.skipTurn(); break;
      case 'q': this.game.discardSelected(); break;
      case 'p': case 'escape': this.game.engine.togglePause(); break;
      case 'm': this.toggleMute(); break;
      case 'h': this.showHelp(); break;
      default: break;
    }
  }

  // --- Pulsanti --------------------------------------------------------------

  _bindButtons() {
    qsa('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.sound.init();
        this.game.sound.resume();
        this.doAction(btn.dataset.action, btn);
      });
    });
  }

  doAction(action, btn) {
    const g = this.game;
    switch (action) {
      case 'new': this.hideModal(); g.newGame(); break;
      case 'pause': g.engine.togglePause(); break;
      case 'skip': g.skipTurn(); break;
      case 'discard': g.discardSelected(); break;
      case 'demolish': g.toggleMode(); this.clearArmed(); this.updateGhost();
        this.showHint(g.mode === 'demolish' ? 'Modalita demolizione attiva' : 'Modalita costruzione attiva');
        break;
      case 'save': this.showSlots('save'); break;
      case 'load': this.showSlots('load'); break;
      case 'help': this.showHelp(); break;
      case 'tutorial':
        this.hideModal();
        if (this.tutorial) setTimeout(() => this.tutorial.start(), 200);
        break;
      case 'menu': this.showMenu(); break;
      case 'mute': this.toggleMute(btn); break;
      case 'music': this.toggleMusic(btn); break;
      case 'close': this.hideModal(); break;
      case 'panels': this.togglePanels(); break;
      case 'panels-close': this.togglePanels(false); break;
      case 'continue-level': this.hideModal(); g.continueToNextLevel(); break;
      default: break;
    }
  }

  toggleMute(btn) {
    this.game.sound.init();
    const muted = this.game.sound.toggleMute();
    const node = btn || qs('[data-action="mute"]');
    if (node) node.textContent = muted ? '🔇' : '🔊';
    this.game.save.savePrefs({ muted, music: this.game.sound.musicOn });
  }

  toggleMusic(btn) {
    this.game.sound.init();
    const on = !this.game.sound.musicOn;
    this.game.sound.setMusic(on);
    const node = btn || qs('[data-action="music"]');
    if (node) node.textContent = on ? '🎵' : '🎼';
    this.game.save.savePrefs({ muted: this.game.sound.muted, music: on });
  }

  // --- Modali ----------------------------------------------------------------

  showModal(title, bodyHTML, actions = [], kind = '') {
    const m = this.el.modal;
    if (!m) return;
    this.el.modalTitle.innerHTML = title;
    this.el.modalBody.innerHTML = bodyHTML;
    this.el.modalActions.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'primary' : '');
      btn.textContent = a.label;
      btn.addEventListener('click', () => { this.game.sound.click(); a.onClick(); });
      this.el.modalActions.appendChild(btn);
    }
    m.dataset.kind = kind;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('show'));
  }

  hideModal() {
    const m = this.el.modal;
    if (!m) return;
    m.classList.remove('show');
    setTimeout(() => { m.hidden = true; }, 180);
  }

  showMenu() {
    const hasAuto = this.game.save.hasSlot(CONFIG.SAVE.AUTOSLOT);
    const actions = [{ label: '▶ Nuova partita', primary: true, onClick: () => { this.hideModal(); this.game.newGame(); } }];
    if (hasAuto) {
      actions.push({
        label: '⟳ Riprendi', onClick: () => {
          this.hideModal();
          this.game.loadFromSlot(CONFIG.SAVE.AUTOSLOT);
        }
      });
    }
    actions.push({ label: '💾 Carica slot', onClick: () => this.showSlots('load') });
    actions.push({ label: '🎓 Tutorial guidato', onClick: () => this.doAction('tutorial') });
    actions.push({ label: '❔ Come si gioca', onClick: () => this.showHelp() });

    this.showModal(
      '<span class="logo-mark">ZENITH</span> BLOCK',
      '<p class="lead">Costruisci una metropoli verticale su una griglia di ' +
      CONFIG.GRID.COLS + 'x' + CONFIG.GRID.ROWS +
      '. Bilancia risorse, sinergie e statica: raggiungi lo Zenith rispettando gli obiettivi del distretto.</p>' +
      '<div class="menu-grid">' +
        '<div><b>🏠 Sinergie</b><span>Ogni blocco reagisce ai 4 vicini</span></div>' +
        '<div><b>🏗️ Statica</b><span>Peso, tolleranza e centro di massa</span></div>' +
        '<div><b>🌩️ Eventi</b><span>Terremoti, incendi, ispezioni</span></div>' +
        '<div><b>🌗 Ciclo</b><span>Giorno, notte e meteo dinamico</span></div>' +
      '</div>',
      actions, 'menu'
    );
  }

  showPause() {
    this.showModal('⏸ Pausa',
      '<p class="lead">La simulazione e sospesa.</p>' + this._statsTable(),
      [
        { label: '▶ Riprendi', primary: true, onClick: () => this.game.engine.togglePause() },
        { label: '💾 Salva', onClick: () => this.showSlots('save') },
        { label: '🏠 Menu', onClick: () => this.showMenu() }
      ], 'pause');
  }

  showHelp() {
    this.showModal('❔ Come si gioca',
      '<div class="help">' +
        '<p><b>Obiettivo.</b> Porta la torre alla riga ' + CONFIG.GRID.ROWS +
        ' (linea ZENITH) avendo raggiunto popolazione, felicita e limite di inquinamento del distretto. ' +
        'Se tocchi lo Zenith senza i requisiti scatta la saturazione strutturale e la partita finisce.</p>' +
        '<p><b>Piazzamento.</b> Scegli una carta (tasti 1-5 o click), punta una colonna e clicca: il blocco cade fino a fermarsi.</p>' +
        '<p><b>Sinergie.</b> Ogni blocco guarda i 4 vicini ortogonali. Un residenziale accanto a Parco o Commercio guadagna felicita, accanto a Industria o Centrale la perde.</p>' +
        '<p><b>Statica.</b> Ogni blocco ha un peso e una tolleranza. Le travi raddoppiano la tolleranza della colonna. Se il centro di massa (triangolo a terra) esce dalla base, la torre si torce e cede.</p>' +
        '<p><b>Eventi.</b> Ogni pochi turni scatta un evento: terremoto, incendio (si propaga, usa i serbatoi), ispezione ecologica, ondata migratoria.</p>' +
        '<div class="keys">' +
          '<span><kbd>1</kbd>-<kbd>5</kbd> carta</span><span><kbd>&#8592;</kbd><kbd>&#8594;</kbd> colonna</span>' +
          '<span><kbd>Spazio</kbd> piazza</span><span><kbd>X</kbd> demolisci</span>' +
          '<span><kbd>N</kbd> passa turno</span><span><kbd>Q</kbd> scarta</span>' +
          '<span><kbd>P</kbd> pausa</span><span><kbd>M</kbd> audio</span>' +
        '</div>' +
      '</div>',
      [
        { label: 'Ho capito', primary: true, onClick: () => this.hideModal() },
        { label: '🎓 Tutorial guidato', onClick: () => this.doAction('tutorial') }
      ], 'help');
  }

  showSlots(mode) {
    const slots = this.game.save.listSlots();
    const rows = slots.map((s) => {
      const label = s.slot === CONFIG.SAVE.AUTOSLOT ? 'Slot ' + (s.slot + 1) + ' (auto)' : 'Slot ' + (s.slot + 1);
      if (s.empty) return '<button class="slot empty" data-slot="' + s.slot + '">' + label + '<span>vuoto</span></button>';
      const d = new Date(s.savedAt);
      return '<button class="slot" data-slot="' + s.slot + '">' + label +
        '<span>Liv. ' + (s.meta.level || 1) + ' - T' + (s.meta.turn || 0) + ' - ' + formatNumber(s.meta.score || 0) + ' pt</span>' +
        '<small>' + d.toLocaleString('it-IT') + '</small></button>';
    }).join('');

    this.showModal(mode === 'save' ? '💾 Salva partita' : '📂 Carica partita',
      '<div class="slots">' + rows + '</div>',
      [{ label: 'Chiudi', onClick: () => this.hideModal() }], 'slots');

    qsa('.slot', this.el.modalBody).forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = parseInt(btn.dataset.slot, 10);
        if (mode === 'save') { this.game.saveToSlot(slot); this.hideModal(); }
        else if (!btn.classList.contains('empty')) {
          if (this.game.loadFromSlot(slot)) this.hideModal();
        }
      });
    });
  }

  _statsTable() {
    const s = this.game.snapshot();
    return '<div class="stats-table">' +
      '<div><span>Livello</span><b>' + s.level + ' - ' + s.goal.name + '</b></div>' +
      '<div><span>Turno</span><b>' + s.turn + '</b></div>' +
      '<div><span>Punteggio</span><b>' + formatNumber(s.score) + '</b></div>' +
      '<div><span>Popolazione</span><b>' + formatNumber(s.stats.population) + '</b></div>' +
      '<div><span>Felicita</span><b>' + Math.round(s.stats.happiness) + '%</b></div>' +
      '<div><span>Inquinamento</span><b>' + Math.round(s.pollution) + '</b></div>' +
      '<div><span>Altezza</span><b>' + s.height + '/' + CONFIG.GRID.ROWS + '</b></div>' +
      '<div><span>Stabilita</span><b>' + Math.round(s.stability * 100) + '%</b></div>' +
      '</div>';
  }

  showLevelUp(p) {
    this.showModal('🏆 Distretto completato!',
      '<p class="lead">Hai raggiunto lo Zenith di <b>' + p.previous.name + '</b> e incassato ' +
      formatNumber(p.reward) + ' monete.</p>' + this._statsTable() +
      '<p class="next-goal">Prossimo distretto: <b>' + p.next.name + '</b> - ' +
      p.next.population + ' abitanti, ' + p.next.happiness + '% felicita, max ' + p.next.maxPollution + ' inquinamento.</p>',
      [{ label: '▲ Sali di livello', primary: true, onClick: () => this.doAction('continue-level') }], 'levelup');
  }

  showGameOver(p) {
    this.showModal('💥 ' + p.title,
      '<p class="lead">' + p.reason + '</p>' +
      '<div class="score-final"><span>Punteggio</span><b>' + formatNumber(p.score) + '</b>' +
      '<small>Record: ' + formatNumber(p.best) + '</small></div>' + this._statsTable(),
      [
        { label: '↻ Rigioca', primary: true, onClick: () => { this.hideModal(); this.game.newGame(); } },
        { label: '🏠 Menu', onClick: () => this.showMenu() }
      ], 'gameover');
  }
}
