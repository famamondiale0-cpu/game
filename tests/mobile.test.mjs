/** Verifica layout e controlli a tocco su viewport da telefono. */
import { installDom } from './dom-stub.mjs';

const PHONE = { left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844 };
const dom = installDom();
// il palcoscenico e il canvas riportano le misure di un telefono
dom.canvas.parentElement.getBoundingClientRect = () => ({ ...PHONE });
dom.canvas.getBoundingClientRect = () => ({ ...PHONE });
window.matchMedia = (q) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} });

const { Game } = await import('../src/core/Game.js');
const { UIController } = await import('../src/ui/UIController.js');
const { CONFIG } = await import('../src/config/Config.js');

let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (e ? ' -> ' + e : '')); } };

const game = new Game(dom.canvas);
const ui = new UIController(game);
game.ui = ui;
game.render.resize();
game.newGame(2024);

console.log('\n[Layout su schermo 390x844]');
const r = game.render;
ok(r.width === 390 && r.height === 844, 'canvas dimensionato sul viewport');
ok(r.cell >= 18, 'cella leggibile: ' + r.cell + 'px');
ok(r.gridW <= 390 && r.gridH <= 844, 'griglia dentro lo schermo: ' + r.gridW + 'x' + r.gridH);
ok(r.originX >= 0 && r.groundY <= 844, 'griglia interamente visibile');
ok(r.cell * CONFIG.GRID.COLS === r.gridW, 'larghezza coerente con 10 colonne');

console.log('\n[Controlli a tocco: due fasi]');
// carta deterministica: un residenziale si puo sempre posare a terra
game.hand[0] = 'RES';
game.selectCard(0);

// coordinate al centro della colonna 4, riga di atterraggio 0
const target = r.cellCenter(4, 0);
const touch = (type, x, y) => dom.canvas.dispatch(type, {
  pointerType: 'touch', clientX: x, clientY: y, button: 0, preventDefault() {}
});

const blocksBefore = game.grid.count();
touch('pointerdown', target.x, target.y);
touch('pointerup', target.x, target.y);
ok(game.grid.count() === blocksBefore, 'il primo tocco mira e NON costruisce');
ok(ui.armed && ui.armed.col === 4, 'colonna 4 armata', JSON.stringify(ui.armed));
ok(r.hoverCol === 4, 'anteprima mostrata sulla colonna mirata');
ok(r.ghostPreview !== null, 'badge di resa calcolati per l anteprima');

touch('pointerdown', target.x, target.y);
touch('pointerup', target.x, target.y);
ok(game.grid.count() === blocksBefore + 1, 'il secondo tocco costruisce');
ok(ui.armed === null, 'il bersaglio si disarma dopo il piazzamento');

// mirare altrove non deve costruire (la mano ha gia pescato una carta nuova)
game.hand[game.selected] = 'RES';
const other = r.cellCenter(8, 0);
touch('pointerdown', other.x, other.y);
touch('pointerup', other.x, other.y);
ok(game.grid.count() === blocksBefore + 1, 'cambiare colonna non costruisce');
ok(ui.armed.col === 8, 'il bersaglio si sposta sulla nuova colonna');

console.log('\n[Demolizione a due tocchi]');
game.economy.coins += 500;
ui.doAction('demolish');
ok(game.mode === 'demolish', 'modalita demolizione attiva');
ok(ui.armed === null, 'il cambio modalita azzera il bersaglio');
const built = game.grid.get(4, 0);
ok(!!built, 'blocco presente in colonna 4');
const c4 = r.cellCenter(4, 0);
touch('pointerdown', c4.x, c4.y);
touch('pointerup', c4.x, c4.y);
ok(game.grid.get(4, 0) === built, 'il primo tocco non demolisce');
ok(r.armedCell !== null, 'la cella da demolire e evidenziata');
touch('pointerdown', c4.x, c4.y);
touch('pointerup', c4.x, c4.y);
ok(game.grid.get(4, 0) !== built, 'il secondo tocco demolisce');
ui.doAction('demolish');

console.log('\n[Cassetto dei pannelli]');
ui.togglePanels(true);
ok(document.body.dataset.panels === 'open', 'cassetto aperto');
ui.togglePanels(false);
ok(document.body.dataset.panels === 'closed', 'cassetto chiuso');

console.log('\n[Suggerimenti e disegno]');
ui.showHint('prova');
ok(ui.el.hint.textContent === 'prova', 'suggerimento contestuale mostrato');
for (let i = 0; i < 20; i++) { game.update(1 / 60, game.engine.state); game.draw(); }
ok(true, 'il render gira sul viewport da telefono senza errori');

console.log('\n=== ' + pass + ' test superati, ' + fail + ' falliti ===');
process.exit(fail ? 1 : 0);
