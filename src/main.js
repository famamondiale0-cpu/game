/**
 * main.js - Bootstrap dell'applicazione.
 * Crea il Game, collega la UI, applica le preferenze salvate e avvia il loop.
 */

import { CONFIG } from './config/Config.js';
import { Game } from './core/Game.js';
import { STATE } from './core/Engine.js';
import { UIController } from './ui/UIController.js';

function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) { console.error('[Zenith] canvas #game non trovato'); return; }

  const game = new Game(canvas);
  const ui = new UIController(game);
  game.ui = ui;

  // Preferenze audio persistite
  const prefs = game.save.loadPrefs();
  if (prefs.muted) {
    game.sound.muted = true;
    const b = document.querySelector('[data-action="mute"]');
    if (b) b.textContent = '🔇';
  }
  if (prefs.music === false) {
    game.sound.musicOn = false;
    const b = document.querySelector('[data-action="music"]');
    if (b) b.textContent = '🎼';
  }

  // Adattamenti per telefoni e tablet: meno particelle, cassetto chiuso,
  // niente zoom a doppio tocco o trascinamento della pagina.
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (coarse) {
    game.render.quality = 0.55;
    document.body.dataset.panels = 'closed';
    document.body.dataset.touch = 'yes';
  }
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // Prepara una partita e mostra il menu iniziale sopra la scena viva
  game.newGame();
  game.start();
  game.engine.setState(STATE.MENU);
  if (coarse) ui.showHint('Tocca una colonna per mirare, tocca di nuovo per costruire');

  // L'audio puo partire solo dopo un gesto dell'utente
  const unlock = () => {
    game.sound.init();
    game.sound.resume();
    game.sound.setMood(game.weather.phase, 0.3);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const relayout = () => game.render.resize();
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);

  // Utile per il debug dalla console del browser
  window.ZENITH = { game, ui, CONFIG, STATE };
  console.log('%cZENITH BLOCK v' + CONFIG.VERSION, 'color:#4fc3f7;font-weight:700');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
