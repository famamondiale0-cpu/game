/** Test delle 5 meccaniche introdotte con la 1.1.0. */
import { installDom } from './dom-stub.mjs';
const dom = installDom();
const { Game } = await import('../src/core/Game.js');
const { BlockFactory } = await import('../src/core/BlockFactory.js');
const { CONFIG } = await import('../src/config/Config.js');
const { SEASONS } = await import('../src/systems/SeasonSystem.js');

let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l + (e ? ' -> ' + e : '')); } };
const game = new Game(dom.canvas);
game.render.resize();
let stats = null;
const fill = (col, rows, type) => { for (let r = 0; r < rows; r++) game.grid.set(col, r, BlockFactory.create(type, col, r)); };

console.log('\n[1. Ponti sospesi]');
game.newGame(11);
fill(1, 8, 'SUP');
fill(4, 8, 'SUP');
let span = game.bridges.findSpan(game.grid, 2, 6);
ok(span.ok && span.cols.length === 2, 'campata di 2 celle fra le colonne 1 e 4', JSON.stringify(span.reason || span.cols));
ok(game.bridges.findSpan(game.grid, 2, 2).ok === false, 'sotto il livello 5 il ponte e rifiutato');
game.economy.coins = 5000;
game.hand[0] = 'BRG'; game.selectCard(0);
const before = game.grid.count();
ok(game.placeSelected(2, 6), 'ponte costruito puntando la cella (2,6)');
ok(game.grid.count() === before + 2, 'la campata ha creato 2 segmenti', game.grid.count() - before);
ok(game.grid.get(2, 6).type === 'BRG' && game.grid.get(3, 6).type === 'BRG', 'segmenti al posto giusto');
ok(game.grid.components().length === 1, 'le due torri ora formano un unico distretto');
ok(game.bridges.windResistance(game.grid) < 1, 'resistenza al vento migliorata: ' + game.bridges.windResistance(game.grid).toFixed(2));
// il ponte non cade
game.grid.compactColumn(2);
ok(game.grid.get(2, 6) !== null, 'il ponte non e soggetto a gravita');

console.log('[2] Reti separate e condivisione tramite ponte');
game.newGame(12);
fill(0, 6, 'SUP');
game.grid.set(0, 6, BlockFactory.create('POW', 0, 6));
fill(5, 8, 'RES');
stats = game.economy.evaluate(game.grid, game.mods);
ok(stats.districts === 2, 'due distretti distinti', stats.districts);
ok(stats.starvedDistricts >= 1, 'la torre senza centrale e in deficit', 'isolati ' + stats.starvedDistricts);
game.economy.coins = 5000;
game.hand[0] = 'BRG'; game.selectCard(0);
ok(game.placeSelected(2, 6), 'ponte costruito fra le due torri');
stats = game.economy.evaluate(game.grid, game.mods);
ok(stats.districts === 1, 'le reti si sono fuse in un solo distretto', stats.districts);
ok(stats.starvedDistricts === 0, 'il deficit e rientrato grazie alla condivisione', 'isolati ' + stats.starvedDistricts);

console.log('\n[3. Elisuperficie e rumore]');
game.newGame(13);
fill(3, 4, 'RES');
game.economy.coins = 5000;
game.hand[0] = 'HEL'; game.selectCard(0);
ok(game.placeSelected(3), 'elisuperficie posata in cima alla colonna');
ok(game.grid.get(3, 4).type === 'HEL', 'la pista e sulla cima');
game.hand[game.selected] = 'RES'; game.selectCard(game.selected);
ok(game.canPlace(3, 'RES').ok === false, 'niente costruzioni sopra la pista');
stats = game.economy.evaluate(game.grid, game.mods);
ok(stats.noisedHomes === CONFIG.HELIPAD.NOISE_DEPTH, 'il rumore colpisce 2 residenziali', stats.noisedHomes);
const coinsPre = game.economy.coins;
game.turn = CONFIG.HELIPAD.INTERVAL - 1;
game.hand[game.selected] = 'SUP'; game.selectCard(game.selected);
game.placeSelected(8);
ok(game.economy.coins > coinsPre - 500, 'arrivo VIP incassato al turno ' + game.turn);

console.log('[4] Idroponici viventi');
game.newGame(14);
fill(2, 3, 'SUP');
game.grid.set(2, 3, BlockFactory.create('WAT', 2, 3));
game.economy.coins = 5000;
game.hand[0] = 'ECO'; game.selectCard(0);
ok(game.canPlace(2, 'ECO', 9).ok === false, 'senza appoggio la coltura non attecchisce');
ok(game.canPlace(3, 'ECO', 3).ok === true, 'accanto a un blocco solido si puo posare');
game.placeSelected(3, 3);
const eco = game.grid.get(3, 3);
ok(eco && eco.type === 'ECO', 'coltura posata a fianco del serbatoio');
ok(game.growth.wateredCells(game.grid).has(eco.id), 'la coltura ha accesso all acqua');
const cellsBefore = game.grid.count();
for (let i = 0; i < CONFIG.ECO.GROWTH_TURNS; i++) game.growth.onTurn(game.grid, game.season.modifiers, i);
ok(game.grid.count() === cellsBefore + 1, 'dopo 5 turni la coltura si e espansa', game.grid.count() - cellsBefore);
ok(game.grid.listByType('ECO').length === 2, 'due celle idroponiche');
stats = game.economy.evaluate(game.grid, game.mods);
ok(stats.pollutionRate < 0, 'le colture riducono l inquinamento: ' + stats.pollutionRate);
// senza acqua non cresce
game.newGame(15);
fill(2, 2, 'SUP');
game.grid.set(3, 1, BlockFactory.create('ECO', 3, 1));
for (let i = 0; i < 10; i++) game.growth.onTurn(game.grid, game.season.modifiers, i);
ok(game.grid.listByType('ECO').length === 1, 'senza acqua la coltura resta ferma');

console.log('[5] Mercato nero e polizia');
game.newGame(16);
game.economy.coins = 5000;
game.hand[0] = 'BLK'; game.selectCard(0);
ok(game.canPlace(4, 'BLK').ok === true, 'il mercato nero si posa al suolo');
const coinsBeforeBlk = game.economy.coins;
game.placeSelected(4);
ok(game.economy.coins > coinsBeforeBlk, 'incasso immediato ricevuto', game.economy.coins - coinsBeforeBlk);
game.security.analyze(game.grid);
ok(game.security.isInsecure(4), 'la colonna 4 e insicura');
ok(game.security.taxMultiplier(4) === 1 - CONFIG.BLACK_MARKET.TAX_PENALTY, 'gettito ridotto del 40%');
// residenziali nella colonna insicura
for (let r = 1; r < 4; r++) game.grid.set(4, r, BlockFactory.create('RES', 4, r));
stats = game.economy.evaluate(game.grid, game.mods);
ok(stats.insecureTaxLoss > 0, 'perdita fiscale registrata: ' + stats.insecureTaxLoss);
// la polizia risolve
game.grid.set(5, 0, BlockFactory.create('POL', 5, 0));
game.security.analyze(game.grid);
ok(!game.security.isInsecure(4), 'con la polizia vicina la colonna torna sicura');
stats = game.economy.evaluate(game.grid, game.mods);
ok(stats.insecureTaxLoss === 0, 'nessuna perdita fiscale con il presidio');
ok(game.canPlace(4, 'BLK', null).ok === false || game.grid.landingRow(4) > CONFIG.BLACK_MARKET.MAX_ROW,
   'sopra la terza riga il mercato nero e vietato');

console.log('[6] Stagioni e crisi termica');
game.newGame(17);
ok(game.season.id === 'estate', 'si parte in estate');
game.season.onTurn(CONFIG.SEASONS.LENGTH * 2);
ok(game.season.id === 'inverno', 'dopo 40 turni e inverno', game.season.id);
ok(game.season.modifiers.resEnergyMult === CONFIG.SEASONS.WINTER_ENERGY_MULT, 'in inverno i consumi RES raddoppiano');
fill(1, 4, 'RES');
const winterStats = game.economy.evaluate(game.grid, game.mods);
game.season.onTurn(0);
const summerStats = game.economy.evaluate(game.grid, game.mods);
ok(winterStats.energyUse === summerStats.energyUse * 2,
   'consumo invernale doppio: ' + winterStats.energyUse + ' contro ' + summerStats.energyUse);
ok(game.season.id === 'estate' && game.season.modifiers.overloadIgnition > 0, 'in estate le centrali rischiano l autocombustione');
game.season.onTurn(CONFIG.SEASONS.LENGTH);
ok(game.season.modifiers.windMult > 1, 'in autunno il vento e piu forte');
game.season.onTurn(CONFIG.SEASONS.LENGTH * 3);
ok(game.season.modifiers.growthTurns === CONFIG.ECO.SPRING_TURNS, 'in primavera le colture crescono prima');
ok(SEASONS.length === 4, 'quattro stagioni definite');

console.log('\n=== ' + pass + ' test superati, ' + fail + ' falliti ===');
process.exit(fail ? 1 : 0);
