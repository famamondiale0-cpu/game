/**
 * EventBus.js - Pub/Sub minimale: disaccoppia i sistemi fra loro.
 * Nessun sistema importa direttamente la UI, tutto passa da qui.
 */
export class EventBus {
  constructor() { this.listeners = new Map(); }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => { off(); fn(payload); });
    return off;
  }

  off(type, fn) {
    const set = this.listeners.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); }
      catch (err) { console.error('[EventBus] handler fallito: ' + type, err); }
    }
  }

  clear() { this.listeners.clear(); }
}

/** Nomi degli eventi di gioco, centralizzati per evitare typo. */
export const EVT = {
  STATE_CHANGED: 'state:changed',
  TURN_END: 'turn:end',
  BLOCK_PLACED: 'block:placed',
  BLOCK_LANDED: 'block:landed',
  BLOCK_DESTROYED: 'block:destroyed',
  COLLAPSE: 'structure:collapse',
  ECONOMY_UPDATE: 'economy:update',
  WEATHER_CHANGE: 'weather:change',
  DISASTER: 'disaster',
  LOG: 'ui:log',
  FLOATER: 'fx:floater',
  SHAKE: 'fx:shake',
  LEVEL_UP: 'game:levelup',
  GAME_OVER: 'game:over',
  HAND_CHANGED: 'hand:changed',
  SELECTION: 'hand:selection',
  SAVED: 'save:done',
  LOADED: 'save:loaded'
};
