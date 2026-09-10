/** Smoke test: costruisce Game + UI con DOM simulato e gioca partite intere. */
import { installDom } from './dom-stub.mjs';
const dom = installDom();

const { Game } = await import('../src/core/Game.js');
const { UIController } = await import('../src/ui/UIController.js');
const { STATE } = await import('../src/core/Engine.js');
const { CONFIG } = await import('../src/config/Config.js');

let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (e ? ' -> ' + e : '')); } };

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.join(' ')); origError(...a); };

console.log('\n[Bootstrap]');
const game = new Game(dom.canvas);
const ui = new UIController(game);
game.ui = ui;
ok(true, 'Game e UIController costruiti senza eccezioni');

game.render.resize();
ok(game.render.cell > 0, 'layout calcolato, cella = ' + game.render.cell + 'px');

game.newGame(4242);
ok(game.hand.length === CONFIG.START.HAND_SIZE, 'mano iniziale da ' + CONFIG.START.HAND_SIZE + ' carte');
ok(game.queue.length === 3, 'coda di 3 carte');
ok(game.engine.state === STATE.PLAY, 'stato PLAY dopo newGame');

console.log('\n[Simulazione partita]');
const frame = (n = 6) => { for (let i = 0; i < n; i++) { game.update(1 / 60, game.engine.state); game.draw(); } };

let placed = 0, refused = 0;
for (let turn = 0; turn < 120 && game.engine.state === STATE.PLAY; turn++) {
  // sceglie la prima carta piazzabile in una colonna casuale
  let done = false;
  for (let i = 0; i < game.hand.length && !done; i++) {
    game.selectCard(i);
    const col = Math.floor(Math.random() * game.grid.cols);
    if (game.canPlace(col, game.selectedType).ok) { game.placeSelected(col); placed++; done = true; }
  }
  if (!done) { game.skipTurn(); refused++; }
  frame(4);
}
ok(placed > 20, 'piazzati ' + placed + ' blocchi in ' + game.turn + ' turni');
ok(errors.length === 0, 'nessun errore in console durante la partita', errors[0]);

const snap = game.snapshot();
ok(typeof snap.stats.population === 'number' && isFinite(snap.stats.population), 'popolazione finita: ' + snap.stats.population);
ok(isFinite(snap.coins) && snap.coins >= 0, 'monete valide: ' + Math.round(snap.coins));
ok(isFinite(game.physics.report.stability), 'stabilita numerica: ' + game.physics.report.stability.toFixed(2));
ok(game.particles.alive >= 0, 'particelle vive: ' + game.particles.alive);

console.log('\n[Demolizione e gravita]');
let target = null;
game.grid.each((cell, c, r) => { if (!target && r === 0 && game.grid.columnHeight(c) > 2) target = { c, r }; });
if (target) {
  const hBefore = game.grid.columnHeight(target.c);
  game.economy.coins += 500;
  game.demolish(target.c, target.r);
  ok(game.grid.columnHeight(target.c) === hBefore - 1, 'la colonna si compatta dopo la demolizione');
  ok(game.grid.get(target.c, 0) !== null || hBefore === 1, 'nessun buco lasciato alla base');
} else { ok(true, 'nessuna colonna adatta al test di demolizione (saltato)'); }

console.log('\n[Salvataggio / caricamento]');
const res = game.saveToSlot(1);
ok(res.ok, 'salvataggio nello slot 2 riuscito');
const state = game.getState();
const blocksBefore = game.grid.count();
const coinsBefore = Math.round(game.economy.coins);
const levelBefore = game.level;
game.newGame(1);
ok(game.grid.count() === 0, 'nuova partita: griglia vuota');
const loaded = game.loadFromSlot(1);
ok(loaded, 'caricamento dallo slot 2 riuscito');
ok(game.grid.count() === blocksBefore, 'blocchi ripristinati: ' + game.grid.count() + '/' + blocksBefore);
ok(Math.round(game.economy.coins) === coinsBefore, 'monete ripristinate');
ok(game.level === levelBefore, 'livello ripristinato');
const slots = game.save.listSlots();
ok(slots.length === CONFIG.SAVE.SLOTS, 'elenco slot: ' + slots.length);
ok(JSON.stringify(state).length > 100, 'stato JSON serializzabile (' + JSON.stringify(state).length + ' byte)');

console.log('\n[Vittoria e sconfitta]');
game.newGame(7);
game.economy.coins = 99999;
// riempie 9 colonne fino in cima, poi tenta lo Zenith senza obiettivi
const { BlockFactory } = await import('../src/core/BlockFactory.js');
for (let c = 0; c < game.grid.cols; c++) {
  for (let r = 0; r < game.grid.rows - 1; r++) game.grid.set(c, r, BlockFactory.create('SUP', c, r));
}
game.hand[0] = 'SUP';
game.selectCard(0);
game.placeSelected(0);
ok(game.engine.state === STATE.GAMEOVER, 'Zenith senza requisiti = saturazione strutturale');

game.newGame(8);
game.economy.coins = 99999;
for (let c = 0; c < game.grid.cols; c++) {
  game.grid.set(c, 0, BlockFactory.create('RES', c, 0));
  game.grid.set(c, 1, BlockFactory.create(c % 2 ? 'POW' : 'WAT', c, 1));
  for (let r = 2; r < game.grid.rows - 1; r++) game.grid.set(c, r, BlockFactory.create('PAR', c, r));
}
game.economy.pollution = 0;
game.economy.evaluate(game.grid, game.events.modifiers);
game.hand[0] = 'RES';
game.selectCard(0);
const statsPre = game.economy.stats;
game.placeSelected(0);
ok(game.engine.state === STATE.LEVELUP || game.engine.state === STATE.GAMEOVER,
   'lo Zenith chiude il livello (stato ' + game.engine.state + ', pop ' + statsPre.population + ')');
if (game.engine.state === STATE.LEVELUP) {
  game.continueToNextLevel();
  ok(game.level === 2 && game.grid.count() === 0, 'livello 2 avviato su una nuova base');
}

frame(30);
ok(errors.length === 0, 'nessun errore in console nell intera sessione', errors[0]);

console.log('\n=== ' + pass + ' test superati, ' + fail + ' falliti ===');
process.exit(fail ? 1 : 0);
