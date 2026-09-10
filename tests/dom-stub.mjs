/** Stub minimale di DOM + Canvas 2D per smoke test headless in Node. */

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, on) { if (on === undefined) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); } else if (on) this.set.add(c); else this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}

export class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = new FakeClassList();
    this.children = [];
    this.listeners = {};
    this._html = '';
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.title = '';
  }
  set innerHTML(v) { this._html = v; if (v === '') this.children = []; }
  get innerHTML() { return this._html; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstChild() { return this.children[0] || null; }
  appendChild(n) { this.children.push(n); n.parentElement = this; return n; }
  prepend(n) { this.children.unshift(n); n.parentElement = this; return n; }
  replaceChild(fresh, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) this.children[i] = fresh; else this.children.push(fresh);
    return fresh;
  }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  dispatch(type, ev = {}) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 760, right: 1280, bottom: 760 }; }
  focus() {}
}

function fakeGradient() { return { addColorStop() {} }; }

export function fakeContext() {
  const noop = () => {};
  return {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: 'left',
    shadowColor: '', shadowBlur: 0,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop, resetTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    fillText: noop, strokeText: noop, setLineDash: noop, measureText: () => ({ width: 20 }),
    createLinearGradient: fakeGradient, createRadialGradient: fakeGradient, createPattern: () => null,
    drawImage: noop
  };
}

export function installDom() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };

  const canvas = new FakeElement('canvas');
  canvas.width = 1280; canvas.height = 760;
  canvas.style = { width: '', height: '', setProperty() {} };
  const ctx = fakeContext();
  ctx.canvas = canvas;
  canvas.getContext = () => ctx;
  canvas.parentElement = new FakeElement('main');

  const body = new FakeElement('body');
  const registry = new Map([['game', canvas]]);

  const document = {
    readyState: 'complete',
    hidden: false,
    body,
    documentElement: new FakeElement('html'),
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => registry.get(id) || null,
    querySelector: (sel) => (sel === '#game' ? canvas : new FakeElement()),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const window = {
    devicePixelRatio: 1,
    innerWidth: 1280, innerHeight: 760,
    localStorage,
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    document
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
  return { canvas, ctx, document, window, localStorage };
}
