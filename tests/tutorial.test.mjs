/** Verifica del tutorial guidato: passi, attese e preparazione della mano. */
import { installDom } from './dom-stub.mjs';
const dom = installDom();

const { Game } = await import('../src/core/Game.js');
const { UIController } = await import('../src/ui/UIController.js');
const { TutorialSystem } = await import('../src/ui/TutorialSystem.js');
const { EVT } = await import('../src/utils/EventBus.js');

let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (e ? ' -> ' + e : '')); } };

const game = new Game(dom.canvas);
const ui = new UIController(game);
game.ui = ui;
game.render.resize();
game.newGame(99);

const tut = new TutorialSystem(game, ui);
ui.tutorial = tut;

console.log('\n[Struttura dei passi]');
ok(tut.steps.length >= 10, 'il tutorial ha ' + tut.steps.length + ' passi');
ok(tut.steps.every((s) => s.title && s.text), 'ogni passo ha titolo e testo');
ok(tut.steps.filter((s) => s.waitFor).length >= 3, 'almeno 3 passi richiedono un azione reale');
ok(tut.steps[tut.steps.length - 1].last === true, 'l ultimo passo chiude il tutorial');

console.log('\n[Avvio e avanzamento]');
ok(TutorialSystem.seen(game.save) === false, 'alla prima partita il tutorial non e stato visto');
ok(tut.start(), 'tutorial avviato');
ok(tut.active && tut.index === 0, 'siamo al primo passo');
ok(document.body.dataset.tutorial === 'on', 'il body segnala il tutorial attivo');
ok(tut.titleNode.innerHTML.includes('Benvenuto'), 'titolo del primo passo mostrato');
tut.next();
ok(tut.index === 1, 'avanzamento manuale al secondo passo');

console.log('\n[Bersagli illuminati]');
const gridStep = tut.steps.find((s) => s.target && s.target.canvas === 'grid');
const rectGrid = tut.targetRect(gridStep);
ok(rectGrid && rectGrid.w > 0 && rectGrid.h > 0, 'la griglia ha un rettangolo valido', JSON.stringify(rectGrid));
const domStep = tut.steps.find((s) => s.target && s.target.selector);
ok(tut.targetRect(domStep) !== null, 'gli elementi del DOM sono individuabili');
ok(tut.targetRect({ target: null }) === null, 'i passi senza bersaglio non illuminano nulla');
ok(tut.targetRect({ target: { canvas: 'column', col: 3 } }).w > 0, 'una singola colonna e illuminabile');

console.log('\n[Mano preparata e attesa dell azione]');
const stepIdx = tut.steps.findIndex((s) => s.waitFor && s.waitFor.event === EVT.SELECTION);
tut.start(stepIdx);
ok(game.hand[0] === 'RES', 'la mano viene forzata per rendere eseguibile l istruzione');
ok(tut.nextBtn.disabled === true, 'il pulsante Avanti resta bloccato');
ok(tut.hintNode.hidden === false, 'viene mostrato il suggerimento dell azione');
ok(tut.unsubs.length === 1, 'in ascolto dell azione del giocatore');

game.selectCard(1);                       // carta sbagliata: non deve sbloccare
ok(tut.nextBtn.disabled === true, 'una carta diversa non sblocca il passo');
game.selectCard(0);                       // RES: sblocca
ok(tut.unsubs.length === 0, 'azione corretta rilevata, ascolto chiuso');

console.log('\n[Piazzamento richiesto]');
const placeIdx = tut.steps.findIndex((s) => s.waitFor && s.waitFor.event === EVT.BLOCK_PLACED);
tut.start(placeIdx);
const idxBefore = tut.index;
game.hand[0] = 'RES'; game.selectCard(0);
game.placeSelected(4);
ok(tut.unsubs.length === 0, 'il piazzamento richiesto e stato riconosciuto');
ok(tut.index === idxBefore, 'l avanzamento e ritardato per far vedere l effetto');

console.log('\n[Chiusura]');
tut.stop(true);
ok(tut.active === false, 'tutorial chiuso');
ok(tut.root.hidden === true, 'overlay nascosto');
ok(TutorialSystem.seen(game.save) === true, 'la preferenza viene memorizzata');
ok(document.body.dataset.tutorial === 'off', 'il body torna normale');

console.log('\n=== ' + pass + ' test superati, ' + fail + ' falliti ===');
process.exit(fail ? 1 : 0);
