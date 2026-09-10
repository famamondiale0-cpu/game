/**
 * Engine.js - Game loop principale (requestAnimationFrame), deltaTime e
 * macchina a stati (BOOT / MENU / PLAY / PAUSE / GAMEOVER / LEVELUP).
 *
 * L'Engine non sa nulla di gioco: riceve callback update(dt)/render(alpha)
 * e garantisce un dt stabile con accumulatore a passo fisso per la logica
 * e rendering libero per la grafica.
 */

import { EVT } from '../utils/EventBus.js';

export const STATE = {
  BOOT: 'BOOT',
  MENU: 'MENU',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  LEVELUP: 'LEVELUP',
  GAMEOVER: 'GAMEOVER'
};

const FIXED_STEP = 1 / 60;
const MAX_FRAME = 0.25;

export class Engine {
  constructor(bus) {
    this.bus = bus;
    this.state = STATE.BOOT;
    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this.timeScale = 1;
    this.elapsed = 0;
    this.frame = 0;

    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    this.updateFn = () => {};
    this.renderFn = () => {};

    this._loop = this._loop.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /** Registra i callback del gioco. */
  bind(updateFn, renderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;
    return this;
  }

  setState(next) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.bus.emit(EVT.STATE_CHANGED, { prev, next });
  }

  isPlaying() { return this.state === STATE.PLAY; }
  /** In pausa "morbida": la grafica continua, la simulazione no. */
  isSimRunning() { return this.state === STATE.PLAY; }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  togglePause() {
    if (this.state === STATE.PLAY) this.setState(STATE.PAUSE);
    else if (this.state === STATE.PAUSE) this.setState(STATE.PLAY);
  }

  _onVisibility() {
    if (document.hidden && this.state === STATE.PLAY) this.setState(STATE.PAUSE);
    // al rientro azzera il delta per evitare un salto temporale enorme
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  _loop(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._loop);

    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_FRAME) dt = MAX_FRAME;   // anti "spiral of death" dopo un freeze

    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    const scaled = dt * this.timeScale;
    this.accumulator += scaled;
    this.elapsed += scaled;
    this.frame++;

    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 5) {
      this.updateFn(FIXED_STEP, this.state);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps === 5) this.accumulator = 0;

    this.renderFn(this.accumulator / FIXED_STEP, this.state);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._onVisibility);
  }
}
