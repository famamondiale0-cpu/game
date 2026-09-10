/**
 * TutorialSystem.js - Onboarding guidato passo passo.
 *
 * Ogni passo puo:
 *  - illuminare un elemento del DOM (selettore CSS) o una zona del canvas
 *    (griglia intera, una colonna, una cella, la linea dello Zenith);
 *  - attendere un'azione reale del giocatore (selezione di una carta,
 *    piazzamento di un blocco) prima di sbloccare il passo successivo;
 *  - preparare la mano di carte, cosi l'istruzione e sempre eseguibile.
 *
 * Il riflettore e un semplice riquadro con un'ombra enorme: il "buco" nella
 * penombra e il riquadro stesso. Niente SVG, niente maschere costose.
 */

import { EVT } from '../utils/EventBus.js';
import { CONFIG } from '../config/Config.js';

export class TutorialSystem {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.bus = game.bus;
    this.active = false;
    this.index = 0;
    this.unsubs = [];

    this.root = document.getElementById('tutorial');
    this.spot = document.getElementById('tutorial-spot');
    this.card = document.getElementById('tutorial-card');
    this.titleNode = document.getElementById('tutorial-title');
    this.textNode = document.getElementById('tutorial-text');
    this.progressNode = document.getElementById('tutorial-progress');
    this.nextBtn = document.getElementById('tutorial-next');
    this.skipBtn = document.getElementById('tutorial-skip');
    this.hintNode = document.getElementById('tutorial-wait');

    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.next());
    if (this.skipBtn) this.skipBtn.addEventListener('click', () => this.stop(true));
    window.addEventListener('resize', () => { if (this.active) this._position(); });

    this.steps = this._buildSteps();
  }

  // --- Definizione dei passi -------------------------------------------------

  _buildSteps() {
    const G = CONFIG.GRID;
    return [
      {
        title: 'Benvenuto a Zenith Block',
        text: 'Sei l urbanista di una metropoli che puo crescere solo verso l alto. ' +
              'In pochi passi ti mostro tutto: durata circa un minuto.',
        target: null
      },
      {
        title: 'Il cantiere',
        text: 'Questa e la griglia: <b>' + G.COLS + ' colonne per ' + G.ROWS + ' piani</b>. ' +
              'I blocchi cadono verso il basso e si impilano, come dei mattoni.',
        target: { canvas: 'grid' }
      },
      {
        title: 'La linea dello Zenith',
        text: 'Lassu, in cima, c e lo <b>Zenith</b>. Arrivarci vince il distretto, ' +
              'ma solo se hai gia raggiunto gli obiettivi: altrimenti la torre collassa.',
        target: { canvas: 'zenith' }
      },
      {
        title: 'Le tue carte',
        text: 'In basso hai cinque carte. Ognuna costa monete. ' +
              'Tocca (o premi <kbd>1</kbd>) la carta <b>Residenziale</b> per selezionarla.',
        target: { selector: '#hand' },
        hand: ['RES', 'PAR', 'SUP', 'WAT', 'COM'],
        waitFor: { event: EVT.SELECTION, test: (p) => p.type === 'RES' },
        waitText: 'Seleziona la carta Residenziale 🏠'
      },
      {
        title: 'Costruisci',
        text: 'Punta una colonna al centro e conferma: su desktop basta un click, ' +
              'su telefono il primo tocco mira e il secondo costruisce.',
        target: { canvas: 'column', col: Math.floor(G.COLS / 2) },
        waitFor: { event: EVT.BLOCK_PLACED, test: (p) => p.type === 'RES' },
        waitText: 'Piazza il residenziale in una colonna 🏗️'
      },
      {
        title: 'Le risorse',
        text: 'Qui sopra tieni d occhio tutto: <b>monete</b>, <b>abitanti</b>, ' +
              '<b>energia</b>, <b>acqua</b>, <b>felicita</b> e <b>inquinamento</b>. ' +
              'Se energia o acqua vanno in rosso, la citta rende meno.',
        target: { selector: '.chips' }
      },
      {
        title: 'Le sinergie: il cuore del gioco',
        text: 'Ogni blocco guarda i <b>4 vicini</b>. Un parco accanto a una casa ' +
              'regala felicita; una fabbrica accanto a una casa la toglie. ' +
              'Prova: piazza un <b>Parco</b> sopra o accanto alla tua casa.',
        target: { canvas: 'grid' },
        hand: ['PAR', 'RES', 'SUP', 'WAT', 'COM'],
        waitFor: { event: EVT.BLOCK_PLACED, test: (p) => p.type === 'PAR' },
        waitText: 'Piazza un Parco 🌳'
      },
      {
        title: 'Peso e stabilita',
        text: 'Ogni blocco pesa. Se una colonna supera la <b>tolleranza</b> si crepa e crolla. ' +
              'Le <b>travi</b> raddoppiano la tenuta: mettine una alla base delle torri alte. ' +
              'Il triangolo a terra mostra il baricentro: se esce dalla base, la torre si piega.',
        target: { selector: '#panel-left' },
        mobilePanels: true
      },
      {
        title: 'Meteo, stagioni ed eventi',
        text: 'Il tempo scorre: giorno, notte, pioggia, tempeste. Ogni <b>20 turni</b> cambia stagione ' +
              '(in inverno le case consumano il doppio, in estate le centrali rischiano di incendiarsi). ' +
              'E ogni pochi turni scatta un evento: terremoto, incendio, ispezione.',
        target: { selector: '.weather-chip' }
      },
      {
        title: 'Blocchi speciali',
        text: '🌉 <b>Ponte sospeso</b>: unisce due torri e condivide le reti. ' +
              '🚁 <b>Elisuperficie</b>: turismo VIP, ma fa rumore. ' +
              '🌱 <b>Idroponico</b>: vicino all acqua cresce da solo. ' +
              '🕴️ <b>Mercato nero</b>: soldi subito, ma serve la 🚓 <b>polizia</b>.',
        target: { selector: '#panel-right' },
        mobilePanels: true
      },
      {
        title: 'Il tuo obiettivo',
        text: 'Qui vedi cosa serve per completare il distretto: abitanti, felicita e ' +
              'un tetto di inquinamento. Raggiungili, poi sali fino allo Zenith.',
        target: { selector: '#panel-left .card-box' },
        mobilePanels: true
      },
      {
        title: 'Tocca a te',
        text: 'Consiglio: <b>una trave alla base</b>, <b>parchi vicino alle case</b>, ' +
              '<b>fabbriche lontane</b>. Se ti serve liquidita, premi <kbd>N</kbd> per passare il turno. ' +
              'Buona costruzione, urbanista.',
        target: null,
        last: true
      }
    ];
  }

  // --- Ciclo di vita ---------------------------------------------------------

  get step() { return this.steps[this.index] || null; }

  /** true se il tutorial e gia stato completato in passato. */
  static seen(save) { return !!save.loadPrefs().tutorialDone; }

  start(fromIndex = 0) {
    if (!this.root) return false;
    this.active = true;
    this.index = fromIndex;
    this.root.hidden = false;
    document.body.dataset.tutorial = 'on';
    this._enter();
    return true;
  }

  stop(skipped = false) {
    this.active = false;
    this._clearWait();
    if (this.root) this.root.hidden = true;
    document.body.dataset.tutorial = 'off';
    const prefs = this.game.save.loadPrefs();
    this.game.save.savePrefs({ ...prefs, tutorialDone: true });
    this.bus.emit(EVT.LOG, {
      text: skipped ? 'Tutorial saltato: lo ritrovi nel menu.' : 'Tutorial completato. Buona costruzione!',
      kind: skipped ? 'info' : 'good'
    });
  }

  next() {
    if (!this.active) return;
    if (this.index >= this.steps.length - 1) { this.stop(false); return; }
    this.index++;
    this._enter();
  }

  /** Prepara e mostra il passo corrente. */
  _enter() {
    const step = this.step;
    if (!step) { this.stop(false); return; }
    this._clearWait();

    // mano preparata: l'istruzione deve essere sempre eseguibile
    if (step.hand) this.game.forceHand(step.hand);

    // su telefono i pannelli sono a scomparsa: si aprono quando servono
    const narrow = window.innerWidth <= 980;
    if (step.mobilePanels && narrow) this.ui.togglePanels(true);
    else if (narrow && document.body.dataset.panels === 'open' && !step.mobilePanels) this.ui.togglePanels(false);

    this.titleNode.innerHTML = step.title;
    this.textNode.innerHTML = step.text;
    this.progressNode.textContent = (this.index + 1) + ' / ' + this.steps.length;
    this.nextBtn.textContent = step.last ? 'Inizia a giocare' : 'Avanti';

    if (step.waitFor) {
      this.nextBtn.disabled = true;
      this.nextBtn.classList.add('waiting');
      this.hintNode.textContent = step.waitText || 'Completa l azione richiesta';
      this.hintNode.hidden = false;
      const off = this.bus.on(step.waitFor.event, (payload) => {
        if (step.waitFor.test && !step.waitFor.test(payload)) return;
        this._clearWait();
        // piccolo respiro perche il giocatore veda l'effetto della sua azione
        setTimeout(() => { if (this.active) this.next(); }, 850);
      });
      this.unsubs.push(off);
    } else {
      this.nextBtn.disabled = false;
      this.nextBtn.classList.remove('waiting');
      this.hintNode.hidden = true;
    }

    this._position();
  }

  _clearWait() {
    this.unsubs.forEach((off) => { try { off(); } catch (err) { /* gia rimosso */ } });
    this.unsubs = [];
    if (this.nextBtn) { this.nextBtn.disabled = false; this.nextBtn.classList.remove('waiting'); }
    if (this.hintNode) this.hintNode.hidden = true;
  }

  // --- Riflettore e posizionamento -------------------------------------------

  /** Rettangolo (in pixel schermo) della zona da illuminare. */
  targetRect(step) {
    if (!step || !step.target) return null;

    if (step.target.selector) {
      const node = document.querySelector(step.target.selector);
      if (!node || node.getBoundingClientRect === undefined) return null;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    const render = this.game.render;
    const canvas = render.canvas;
    if (!canvas || !canvas.getBoundingClientRect) return null;
    const box = canvas.getBoundingClientRect();
    const scale = render.width ? box.width / render.width : 1;
    const map = (x, y, w, h) => ({
      x: box.left + x * scale, y: box.top + y * scale, w: w * scale, h: h * scale
    });

    switch (step.target.canvas) {
      case 'grid':
        return map(render.originX, render.originY, render.gridW, render.gridH);
      case 'zenith':
        return map(render.originX - 6, render.originY - 4, render.gridW + 12, render.cell * 2);
      case 'column': {
        const col = step.target.col || 0;
        return map(render.cellX(col), render.originY, render.cell, render.gridH);
      }
      case 'cell': {
        const { col = 0, row = 0 } = step.target;
        return map(render.cellX(col), render.cellY(row), render.cell, render.cell);
      }
      default:
        return null;
    }
  }

  /** Posiziona riflettore e scheda, tenendo tutto dentro lo schermo. */
  _position() {
    const step = this.step;
    if (!step || !this.spot || !this.card) return;
    const rect = this.targetRect(step);
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    if (!rect) {
      // nessun bersaglio: penombra piena e scheda al centro
      this.spot.style.opacity = '0';
      this.card.dataset.place = 'center';
      this.card.style.left = '50%';
      this.card.style.top = '50%';
      this.card.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const pad = 8;
    this.spot.style.opacity = '1';
    this.spot.style.left = Math.max(0, rect.x - pad) + 'px';
    this.spot.style.top = Math.max(0, rect.y - pad) + 'px';
    this.spot.style.width = Math.min(vw, rect.w + pad * 2) + 'px';
    this.spot.style.height = Math.min(vh, rect.h + pad * 2) + 'px';

    // la scheda si mette dal lato con piu spazio libero
    const cardW = Math.min(360, vw - 24);
    const cardH = this.card.offsetHeight || 210;
    const spaceBelow = vh - (rect.y + rect.h);
    const spaceAbove = rect.y;
    const spaceRight = vw - (rect.x + rect.w);

    let left; let top;
    if (spaceRight > cardW + 24 && rect.h > 120) {
      left = rect.x + rect.w + 16;
      top = Math.min(Math.max(12, rect.y), vh - cardH - 12);
      this.card.dataset.place = 'right';
    } else if (spaceBelow > cardH + 24) {
      left = Math.min(Math.max(12, rect.x + rect.w / 2 - cardW / 2), vw - cardW - 12);
      top = rect.y + rect.h + 16;
      this.card.dataset.place = 'below';
    } else if (spaceAbove > cardH + 24) {
      left = Math.min(Math.max(12, rect.x + rect.w / 2 - cardW / 2), vw - cardW - 12);
      top = rect.y - cardH - 16;
      this.card.dataset.place = 'above';
    } else {
      left = Math.min(Math.max(12, vw / 2 - cardW / 2), vw - cardW - 12);
      top = vh - cardH - 16;
      this.card.dataset.place = 'bottom';
    }

    this.card.style.transform = 'none';
    this.card.style.left = Math.round(left) + 'px';
    this.card.style.top = Math.round(top) + 'px';
    this.card.style.width = cardW + 'px';
  }
}
