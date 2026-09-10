// Test headless dei sistemi di gioco (nessun DOM richiesto).
import { Grid } from '../src/core/Grid.js';
import { BlockFactory } from '../src/core/BlockFactory.js';
import { EconomyEngine } from '../src/systems/EconomyEngine.js';
import { PhysicsSystem } from '../src/systems/PhysicsSystem.js';
import { WeatherSystem } from '../src/systems/WeatherSystem.js';
import { EventSystem } from '../src/systems/EventSystem.js';
import { EventBus } from '../src/utils/EventBus.js';
import { Random } from '../src/utils/Random.js';
import { CONFIG } from '../src/config/Config.js';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + extra : '')); }
};

const bus = new EventBus();
const rng = new Random(12345);

console.log('\n[Grid]');
const grid = new Grid();
ok(grid.cols === 10 && grid.rows === 20, 'griglia 10x20');
ok(grid.landingRow(3) === 0, 'primo blocco atterra a row 0');
grid.set(3, 0, BlockFactory.create('RES', 3, 0));
ok(grid.landingRow(3) === 1, 'secondo blocco atterra a row 1');
grid.set(3, 1, BlockFactory.create('PAR', 3, 1));
ok(grid.columnHeight(3) === 2, 'altezza colonna = 2');
ok(grid.neighbors(3, 0).up.type === 'PAR', 'vicino superiore corretto');
ok(grid.neighborList(3, 1).length === 1, 'lista vicini corretta');
grid.clearAt(3, 0);
const moves = grid.compactColumn(3);
ok(moves.length === 1 && grid.get(3, 0).type === 'PAR', 'compattazione dopo rimozione');

console.log('\n[EconomyEngine - matrice di sinergia]');
const eco = new EconomyEngine(bus);
const g2 = new Grid();
g2.set(0, 0, BlockFactory.create('RES', 0, 0));
g2.set(1, 0, BlockFactory.create('COM', 1, 0));
let stats = eco.evaluate(g2);
// 10 base + 5 di sinergia (RES adiacente) + 3 di tasse (5 abitanti x 0.6)
ok(Math.round(stats.income) === 18, 'COM accanto a RES: 15 + 3 di tasse', 'ottenuto ' + stats.income);
ok(stats.taxes === 3, 'gettito fiscale proporzionale agli abitanti', 'ottenuto ' + stats.taxes);

const g3 = new Grid();
g3.set(0, 0, BlockFactory.create('IND', 0, 0));
g3.set(1, 0, BlockFactory.create('IND', 1, 0));
stats = eco.evaluate(g3);
ok(Math.round(stats.income) === 70, 'due IND adiacenti rendono 70', 'ottenuto ' + stats.income);
ok(Math.abs(stats.pollutionRate - 4) < 0.001, 'inquinamento 2 IND = 4/turno', 'ottenuto ' + stats.pollutionRate);

const g4 = new Grid();
g4.set(0, 0, BlockFactory.create('RES', 0, 0));
g4.set(1, 0, BlockFactory.create('IND', 1, 0));
const st4 = new EconomyEngine(bus).evaluate(g4);
const resEntry = st4.perCell.get(g4.get(0, 0).id);
ok(Math.round(resEntry.happiness) === -3, 'RES accanto a IND perde 3 felicita', 'ottenuto ' + resEntry.happiness);

const g5 = new Grid();
g5.set(0, 0, BlockFactory.create('RES', 0, 0));
g5.set(1, 0, BlockFactory.create('PAR', 1, 0));
g5.set(0, 1, BlockFactory.create('COM', 0, 1));
const st5 = new EconomyEngine(bus).evaluate(g5);
const res2 = st5.perCell.get(g5.get(0, 0).id);
ok(Math.round(res2.happiness) === 4, 'RES con PAR e COM adiacenti guadagna 4 felicita', 'ottenuto ' + res2.happiness);

console.log('\n[EconomyEngine - anteprima]');
const prev = eco.previewPlacement(g5, 1, 1, 'RES');
ok(prev.links.length > 0, 'anteprima rileva sinergie con i vicini');
ok(prev.population === 5, 'anteprima RES da 5 popolazione');

console.log('\n[PhysicsSystem]');
const phys = new PhysicsSystem(bus);
const g6 = new Grid();
for (let r = 0; r < 12; r++) g6.set(2, r, BlockFactory.create('IND', 2, r));
phys.analyze(g6, null);
const base = g6.get(2, 0);
ok(base.load === 550, 'carico su fondamenta uguale a 11 x 50kg', 'ottenuto ' + base.load);
ok(base.stress > 1, 'colonna di 12 IND supera la tolleranza', 'stress ' + base.stress.toFixed(2));

const g7 = new Grid();
g7.set(2, 0, BlockFactory.create('SUP', 2, 0));
g7.set(2, 1, BlockFactory.create('IND', 2, 1));
g7.set(2, 2, BlockFactory.create('IND', 2, 2));
phys.analyze(g7, null);
ok(g7.get(2, 1).capacity === BlockFactory.def('IND').capacity * 2,
   'la trave raddoppia la tolleranza del blocco sopra', 'ottenuto ' + g7.get(2, 1).capacity);

const g8 = new Grid();
for (let r = 0; r < 8; r++) g8.set(0, r, BlockFactory.create('IND', 0, r));
g8.set(9, 0, BlockFactory.create('SUP', 9, 0));
const rep8 = phys.analyze(g8, null);
ok(rep8.imbalance < -0.3, 'centro di massa spostato a sinistra', 'imb ' + rep8.imbalance.toFixed(2));
ok(rep8.stability < 1, 'stabilita ridotta dallo sbilanciamento');

const g9 = new Grid();
for (let r = 0; r < 14; r++) g9.set(4, r, BlockFactory.create('IND', 4, r));
const before = g9.count();
let collapsed = 0;
for (let t = 0; t < 20; t++) collapsed += phys.resolveTurn(g9, null).length;
ok(collapsed > 0, 'il sovraccarico prolungato provoca crolli', collapsed + ' crolli');
ok(g9.count() < before, 'la griglia perde blocchi dopo il crollo');

console.log('\n[WeatherSystem]');
const weather = new WeatherSystem(bus, rng);
const startHour = weather.hour;
for (let i = 0; i < 600; i++) weather.update(1 / 60);
ok(weather.hour !== startHour, 'il tempo avanza');
ok(weather.lightLevel >= 0 && weather.lightLevel <= 1, 'lightLevel resta in [0,1]');
const sky = weather.skyColors();
ok(/^#[0-9a-f]{6}$/i.test(sky.top), 'colore del cielo valido', sky.top);
weather.hour = 23;
ok(weather.isNight === true, 'alle 23 e notte');
weather.hour = 12;
ok(weather.isNight === false, 'alle 12 e giorno');

console.log('\n[EventSystem]');
const g10 = new Grid();
for (let c = 0; c < 4; c++) g10.set(c, 0, BlockFactory.create('IND', c, 0));
const events = new EventSystem(bus, new Random(7));
const eco3 = new EconomyEngine(bus);
eco3.evaluate(g10);
const ctx = { grid: g10, economy: eco3, physics: phys, weather, turn: 1 };
events.trigger(ctx, 'FIRE');
ok(events.fireCount === 1, 'incendio innescato su un edificio');
for (let t = 0; t < 6; t++) { ctx.turn = t + 2; events.updateFires(ctx); }
ok(true, 'propagazione incendio eseguita senza errori');

eco3.pollution = 120;
const coinsBefore = eco3.coins;
events.trigger(ctx, 'INSPECTION');
ok(eco3.coins < coinsBefore, 'ispezione con inquinamento alto genera multa', 'monete ' + eco3.coins);

events.trigger(ctx, 'IMMIGRATION');
ok(events.modifiers.resMultiplier === CONFIG.EVENTS.IMMIGRATION_BONUS, 'immigrazione attiva il moltiplicatore');
for (let i = 0; i < CONFIG.EVENTS.IMMIGRATION_TURNS + 1; i++) events._tickTimed();
ok(events.modifiers.resMultiplier === 1, 'il moltiplicatore scade dopo N turni');

const quakeGrid = new Grid();
for (let r = 0; r < 10; r++) quakeGrid.set(5, r, BlockFactory.create('RES', 5, r));
const quakeCtx = { grid: quakeGrid, economy: eco3, physics: phys, weather, turn: 10 };
const beforeQ = quakeGrid.list().reduce((s, c) => s + c.integrity, 0);
events.trigger(quakeCtx, 'QUAKE');
const afterQ = quakeGrid.list().reduce((s, c) => s + c.integrity, 0);
ok(afterQ < beforeQ, 'il terremoto danneggia la struttura');

console.log('\n[Serializzazione]');
const gs = new Grid();
gs.set(1, 0, BlockFactory.create('RES', 1, 0));
gs.set(1, 1, BlockFactory.create('PAR', 1, 1));
gs.get(1, 0).integrity = 63;
const restored = new Grid();
restored.deserialize(JSON.parse(JSON.stringify(gs.serialize())));
ok(restored.count() === 2, 'griglia ripristinata con 2 blocchi');
ok(restored.get(1, 1).type === 'PAR', 'tipo di blocco ripristinato');
ok(restored.get(1, 0).integrity === 63, 'integrita ripristinata');

const r1 = new Random(999);
r1.next(); r1.next(); r1.next();
const r2 = new Random(1);
r2.deserialize(r1.serialize());
const r3 = new Random(999);
r3.next(); r3.next(); r3.next();
ok(Math.abs(r2.next() - r3.next()) < 1e-12, 'PRNG deterministico e serializzabile');

console.log('\n=== ' + pass + ' test superati, ' + fail + ' falliti ===');
process.exit(fail ? 1 : 0);
