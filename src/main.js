/**
 * main.js - Bootstrap dell'applicazione.
 * Crea il Game, collega la UI, applica le preferenze salvate e avvia il loop.
 */

import { CONFIG } from './config/Config.js';
import { Game } from './core/Game.js';
import { STATE } from './core/Engine.js';
import { UIController } from './ui/UIController.js';
import { TutorialSystem } from './ui/TutorialSystem.js';


/**
 * Registra il Service Worker (cache statica + funzionamento offline).
 * Percorso relativo: funziona anche in una sottocartella di GitHub Pages.
 * Su file:// i Service Worker non sono ammessi, quindi si esce in silenzio.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') {
    console.info('[Zenith] Service Worker non disponibile su file:// - avvia un server locale.');
    return;
  }
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      console.log('[Zenith] Service Worker registrato:', reg.scope);

      // Se e pronta una nuova versione, la si attiva al prossimo avvio
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[Zenith] Nuova versione disponibile: verra applicata al prossimo riavvio.');
          }
        });
      });
    } catch (err) {
      console.warn('[Zenith] Registrazione Service Worker fallita:', err);
    }
  });
}

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
  // Tutorial guidato: parte da solo alla primissima partita.
  const tutorial = new TutorialSystem(game, ui);
  ui.tutorial = tutorial;
  if (!TutorialSystem.seen(game.save)) {
    const off = game.bus.on('state:changed', ({ next }) => {
      if (next !== 'PLAY') return;
      off();
      setTimeout(() => tutorial.start(), 450);
    });
  }

  registerServiceWorker();

  window.ZENITH = { game, ui, tutorial, CONFIG, STATE };
  console.log('%cZENITH BLOCK v' + CONFIG.VERSION, 'color:#4fc3f7;font-weight:700');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
