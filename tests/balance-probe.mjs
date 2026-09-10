/** Sonda di bilanciamento: gioca N partite con una euristica e riporta le medie. */
import { installDom } from './dom-stub.mjs';
const dom = installDom();
const { Game } = await import('../src/core/Game.js');
const { STATE } = await import('../src/core/Engine.js');
const { BlockFactory } = await import('../src/core/BlockFactory.js');

function candidates(game, type) {
  const def = BlockFactory.def(type);
  const out = [];
  if (!def.anchored) {
    for (let col = 0; col < game.grid.cols; col++) out.push({ col, row: null });
    return out;
  }
  // blocchi ancorati: si valutano le celle libere con un appoggio vicino
  for (let row = 0; row < game.grid.rows; row++) {
    for (let col = 0; col < game.grid.cols; col++) {
      if (!game.grid.isEmpty(col, row)) continue;
      if (game.grid.solidNeighbors(col, row) === 0 && row !== 0) {
        if (!def.spanning) continue;
      }
      out.push({ col, row });
    }
  }
  return out;
}

function bestMove(game) {
  let best = null;
  const s = game.economy.stats;
  const goalsMet = s.population >= game.goal.population &&
                   s.happiness >= game.goal.happiness &&
                   game.economy.pollution <= game.goal.maxPollution;

  for (let i = 0; i < game.hand.length; i++) {
    const type = game.hand[i];
    const def = BlockFactory.def(type);
    for (const spot of candidates(game, type)) {
      const chk = game.canPlace(spot.col, type, spot.row);
      if (!chk.ok) continue;
      const prev = game.economy.previewPlacement(game.grid, spot.col, chk.row, type);
      let score = prev.coins * 1.2 + prev.happiness * 2 + prev.population * 1.5 - prev.pollution * 3;

      if (s.energyDeficit > 0 && type === 'POW') score += 40;
      if (s.waterDeficit > 0 && type === 'WAT') score += 34;
      if (game.economy.pollution > 45 && (type === 'PAR' || type === 'ECO')) score += 22;
      if (game.security.insecureColumns.size && type === 'POL') score += 45;
      if (type === 'BLK' && game.economy.coins < 250) score += 30;
      if (type === 'HEL') score += 14;
      if (type === 'BRG') score += 26 + (s.starvedDistricts || 0) * 30;
      if (type === 'ECO' && game.grid.listByType('WAT').length) score += 18;

      const height = game.grid.columnHeight(spot.col);
      score += goalsMet ? height * 2.2 : -height * 1.6;
      score -= Math.abs(spot.col - (game.grid.cols - 1) / 2) * 0.4;
      if (def.isSupport) score += chk.row < 4 ? 16 : -8;
      score -= (chk.cost || def.cost) * 0.05;

      if (!best || score > best.score) best = { score, i, col: spot.col, row: spot.row };
    }
  }
  return best;
}

const runs = 6;
const out = [];
for (let r = 0; r < runs; r++) {
  const game = new Game(dom.canvas);
  game.render.resize();
  let collapses = 0, disasters = 0;
  const reasons = {};
  game.bus.on('structure:collapse', (p) => { collapses += p.cells.length; for (const c of p.cells) reasons[c.reason] = (reasons[c.reason]||0)+1; });
  const built = {};
  game.bus.on('block:placed', (p) => { built[p.type] = (built[p.type]||0)+1; });
  game.bus.on('disaster', () => disasters++);
  game.newGame(1000 + r * 77);

  let guard = 0;
  while (game.engine.state === STATE.PLAY && guard++ < 400) {
    const mv = bestMove(game);
    if (mv) { game.selectCard(mv.i); game.placeSelected(mv.col, mv.row); }
    else game.skipTurn();
    for (let f = 0; f < 3; f++) game.update(1 / 60, game.engine.state);
    if (game.engine.state === STATE.LEVELUP) game.continueToNextLevel();
  }
  const s = game.snapshot();
  out.push({
    turni: game.turn, livello: game.level, punti: Math.round(s.score),
    pop: s.stats.population, felicita: s.stats.happiness,
    monete: Math.round(s.coins), inquin: Math.round(s.pollution),
    blocchi: s.blocks, altezza: s.height, crolli: collapses, eventi: disasters,
    stabilita: +s.stability.toFixed(2), esito: game.engine.state,
    cause: Object.entries(reasons).map((e)=>e[0]+':'+e[1]).join(' '),
    costruiti: Object.entries(built).map((e)=>e[0]+':'+e[1]).join(' ')
  });
}

const avg = (k) => (out.reduce((a, b) => a + b[k], 0) / out.length).toFixed(1);
console.table(out.map(function(o){return {turni:o.turni,livello:o.livello,altezza:o.altezza,crolli:o.crolli,cause:o.cause,costruiti:o.costruiti,inquin:o.inquin};}));
console.log('MEDIE -> turni ' + avg('turni') + ' | livello ' + avg('livello') +
            ' | punti ' + avg('punti') + ' | monete ' + avg('monete') +
            ' | crolli ' + avg('crolli') + ' | eventi ' + avg('eventi') +
            ' | inquinamento ' + avg('inquin'));
