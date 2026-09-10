/**
 * ParticleEngine.js - Sistema di particelle a pool fisso (zero allocazioni
 * durante il gioco). Lavora in coordinate SCHERMO: chi emette converte prima.
 *
 * Tipi: dust, smoke, spark, debris, leaf, firefly, rain, splash, coin, ring, text.
 */

import { clamp } from '../utils/Utils.js';
import { visualRng as rng } from '../utils/Random.js';

const POOL = 2200;

export class ParticleEngine {
  constructor() {
    this.pool = new Array(POOL);
    for (let i = 0; i < POOL; i++) this.pool[i] = this._blank();
    this.cursor = 0;
    this.alive = 0;
  }

  _blank() {
    return {
      active: false, type: 'dust', x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, size: 3, color: '#fff', alpha: 1,
      gravity: 0, drag: 0.98, rot: 0, spin: 0, wind: 1,
      text: '', grow: 0, shape: 'circle'
    };
  }

  /** Prende la prossima particella libera (altrimenti ricicla la piu vecchia). */
  _spawn() {
    for (let i = 0; i < POOL; i++) {
      const idx = (this.cursor + i) % POOL;
      if (!this.pool[idx].active) { this.cursor = (idx + 1) % POOL; return this.pool[idx]; }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    return p;
  }

  emit(opts) {
    const p = this._spawn();
    p.active = true;
    p.type = opts.type || 'dust';
    p.shape = opts.shape || 'circle';
    p.x = opts.x; p.y = opts.y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.maxLife = opts.life || 1; p.life = p.maxLife;
    p.size = opts.size || 3;
    p.color = opts.color || '#ffffff';
    p.alpha = opts.alpha === undefined ? 1 : opts.alpha;
    p.gravity = opts.gravity === undefined ? 0 : opts.gravity;
    p.drag = opts.drag === undefined ? 0.985 : opts.drag;
    p.rot = opts.rot || 0;
    p.spin = opts.spin || 0;
    p.wind = opts.wind === undefined ? 1 : opts.wind;
    p.grow = opts.grow || 0;
    p.text = opts.text || '';
    return p;
  }

  clear() { for (const p of this.pool) p.active = false; }

  /** Polvere all'impatto di un blocco. */
  dust(x, y, count = 12, color = '#d9cbb2') {
    for (let i = 0; i < count; i++) {
      const dir = rng.chance(0.5) ? -1 : 1;
      this.emit({
        type: 'dust', x: x + rng.range(-14, 14), y: y + rng.range(-3, 3),
        vx: dir * rng.range(30, 150), vy: -rng.range(10, 70),
        life: rng.range(0.35, 0.8), size: rng.range(2, 6),
        color, gravity: 260, drag: 0.9, grow: 14
      });
    }
  }

  /** Fumo dalle ciminiere: sale, si allarga e si dissolve. */
  smoke(x, y, strength = 1, color = '#8b8b8b') {
    this.emit({
      type: 'smoke', x: x + rng.range(-3, 3), y,
      vx: rng.range(-8, 8), vy: -rng.range(14, 32) * strength,
      life: rng.range(1.6, 3.2), size: rng.range(4, 9),
      color, alpha: 0.42, gravity: -6, drag: 0.995, grow: 16, wind: 2.2
    });
  }

  spark(x, y, count = 8, color = '#ffe082') {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = rng.range(60, 260);
      this.emit({
        type: 'spark', shape: 'line', x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: rng.range(0.25, 0.6), size: rng.range(1.5, 3.5),
        color, gravity: 420, drag: 0.9
      });
    }
  }

  debris(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      this.emit({
        type: 'debris', shape: 'rect', x: x + rng.range(-16, 16), y: y + rng.range(-16, 16),
        vx: rng.range(-180, 180), vy: -rng.range(40, 260),
        life: rng.range(0.7, 1.5), size: rng.range(3, 9), color,
        gravity: 900, drag: 0.99, rot: rng.range(0, 6.28), spin: rng.range(-9, 9)
      });
    }
  }

  leaf(x, y, color = '#7fd39b') {
    this.emit({
      type: 'leaf', shape: 'leaf', x, y, vx: rng.range(-14, 14), vy: rng.range(8, 26),
      life: rng.range(1.8, 3.4), size: rng.range(3, 5.5), color,
      gravity: 12, drag: 0.995, rot: rng.range(0, 6.28), spin: rng.range(-3, 3), wind: 3
    });
  }

  firefly(x, y) {
    this.emit({
      type: 'firefly', x, y, vx: rng.range(-16, 16), vy: rng.range(-18, 4),
      life: rng.range(1.4, 3), size: rng.range(1.4, 2.6),
      color: '#f7ff8a', alpha: 0.9, gravity: -4, drag: 0.99, wind: 0.6
    });
  }

  raindrop(x, y, speed, windX) {
    this.emit({
      type: 'rain', shape: 'line', x, y, vx: windX, vy: speed,
      life: 2.4, size: rng.range(5, 11), color: '#9fd8ff', alpha: 0.5,
      gravity: 120, drag: 1, wind: 0.4
    });
  }

  splash(x, y) {
    for (let i = 0; i < 3; i++) {
      this.emit({
        type: 'splash', x, y, vx: rng.range(-40, 40), vy: -rng.range(20, 70),
        life: 0.3, size: rng.range(1, 2.4), color: '#bfe9ff', alpha: 0.7, gravity: 500
      });
    }
  }

  coin(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      this.emit({
        type: 'coin', shape: 'coin', x, y, vx: rng.range(-70, 70), vy: -rng.range(90, 200),
        life: rng.range(0.6, 1), size: rng.range(3, 5), color: '#ffd54f',
        gravity: 620, drag: 0.99, spin: rng.range(-8, 8)
      });
    }
  }

  ember(x, y) {
    this.emit({
      type: 'ember', x: x + rng.range(-10, 10), y: y + rng.range(-6, 6),
      vx: rng.range(-18, 18), vy: -rng.range(40, 110),
      life: rng.range(0.5, 1.2), size: rng.range(1.6, 4),
      color: rng.chance(0.5) ? '#ff9800' : '#ffd54f', alpha: 0.95,
      gravity: -30, drag: 0.97, wind: 1.6
    });
  }

  ring(x, y, color = '#ffffff', size = 10, life = 0.45) {
    this.emit({ type: 'ring', shape: 'ring', x, y, life, size, color, alpha: 0.7, grow: 320, drag: 1 });
  }

  floater(x, y, text, color = '#ffffff', size = 15) {
    this.emit({
      type: 'text', shape: 'text', x, y, vx: 0, vy: -46,
      life: 1.35, size, color, text, drag: 0.96, gravity: 26, alpha: 1
    });
  }

  update(dt, windX = 0) {
    let alive = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vx += windX * 60 * p.wind * dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.grow) p.size += p.grow * dt;
      alive++;
    }
    this.alive = alive;
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = p.alpha * (p.shape === 'text' ? Math.min(1, t * 2.2) : t);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;

      switch (p.shape) {
        case 'rect':
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
          ctx.restore();
          break;
        case 'line':
          ctx.lineWidth = Math.max(1, p.size * 0.28);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
          ctx.stroke();
          break;
        case 'ring':
          ctx.lineWidth = Math.max(1, 3 * t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'leaf':
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot + Math.sin(p.life * 6) * 0.5);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        case 'coin':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.scale(Math.abs(Math.cos(p.rot)) * 0.8 + 0.2, 1);
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        case 'text':
          ctx.font = '700 ' + p.size + 'px Rajdhani, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
          break;
        default:
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.4, p.size), 0, Math.PI * 2);
          ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
