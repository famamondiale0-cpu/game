/** Sonda di bilanciamento: gioca N partite con una euristica e riporta le medie. */
import { installDom } from './dom-stub.mjs';
const dom = installDom();
const { Game } = await import('../src/core/Game.js');
const { STATE } = await import('../src/core/Engine.js');
const { BlockFactory } = await import('../src/core/BlockFactory.js');

function bestMove(game) {
  let best = null;
  for (let i = 0; i < game.hand.length; i++) {
    const type = game.hand[i];
    for (let col = 0; col < game.grid.cols; col++) {
      const chk = game.canPlace(col, type);
      if (!chk.ok) continue;
      const prev = game.economy.previewPlacement(game.grid, col, chk.row, type);
      let score = prev.coins * 1.2 + prev.happiness * 2 + prev.population * 1.5 - prev.pollution * 3;
      const def = BlockFactory.def(type);
      const s = game.economy.stats;
      if (s.energyDeficit > 0 && type === 'POW') score += 40;
      if (s.waterDeficit > 0 && type === 'WAT') score += 34;
      if (game.economy.pollution > 45 && type === 'PAR') score += 22;
      // preferisce colonne basse e travi in basso: mantiene la torre in equilibrio
      const goalsMet = s.population >= game.goal.population && s.happiness >= game.goal.happiness && game.economy.pollution <= game.goal.maxPollution;
      score += goalsMet ? game.grid.columnHeight(col) * 2.2 : -game.grid.columnHeight(col) * 1.6;
      score -= Math.abs(col - (game.grid.cols - 1) / 2) * 0.4;
      if (def.isSupport) score += chk.row < 4 ? 16 : -8;
      score -= def.cost * 0.05;
      if (!best || score > best.score) best = { score, i, col };
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
    if (mv) { game.selectCard(mv.i); game.placeSelected(mv.col); }
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
