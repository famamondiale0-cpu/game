/**
 * RenderEngine.js - Disegno su Canvas 2D: cielo dinamico, parallasse, blocchi,
 * camera shake, zoom, inclinazione strutturale e micro-animazioni (juice).
 *
 * Coordinate: la logica usa (col, row) con row 0 in basso; qui si converte in
 * pixel schermo con origine in alto a sinistra.
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from '../core/BlockFactory.js';
import { clamp, lerp, damp, roundRect, rgba, shade, mixColor } from '../utils/Utils.js';
import { visualRng, hash01 } from '../utils/Random.js';
import { EVT } from '../utils/EventBus.js';

export class RenderEngine {
  constructor(canvas, bus, particles) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.bus = bus;
    this.particles = particles;

    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.cell = CONFIG.GRID.CELL;
    this.originX = 0;
    this.originY = 0;

    this.shakeAmount = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.flash = 0;
    this.time = 0;

    this.currentTilt = 0;
    this.armedCell = null;      // bersaglio confermabile su touch
    this.hoverRow = null;
    this.ghostRow = null;
    this.ghostSpan = null;
    this.quality = 1;           // scala della densita di particelle
    this.hoverCol = -1;
    this.ghostType = null;
    this.ghostValid = true;
    this.ghostPreview = null;

    this._emitTimers = { smoke: 0, leaf: 0, fire: 0, rain: 0, spark: 0 };
    this._buildBackdrop();

    this.bus.on(EVT.SHAKE, (p) => this.shake(p.power || 6, p.duration));
    window.addEventListener('resize', () => this.resize());
  }

  /** Stelle e skyline procedurali, generate una volta sola (deterministiche). */
  _buildBackdrop() {
    this.stars = [];
    for (let i = 0; i < 130; i++) {
      this.stars.push({
        x: visualRng.next(), y: visualRng.range(0, 0.62),
        r: visualRng.range(0.5, 1.7), tw: visualRng.range(0.4, 2.4), ph: visualRng.range(0, 6.28)
      });
    }
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      this.clouds.push({
        x: visualRng.next(), y: visualRng.range(0.05, 0.42),
        w: visualRng.range(0.16, 0.4), h: visualRng.range(0.02, 0.055),
        speed: visualRng.range(0.004, 0.016), puffs: visualRng.int(3, 6)
      });
    }
    // tre livelli di skyline: piu lontano = piu chiaro e piu lento
    this.skyline = CONFIG.RENDER.PARALLAX.map((depth, layer) => {
      const buildings = [];
      let x = -0.1;
      while (x < 1.2) {
        const w = visualRng.range(0.03, 0.085) * (1 + layer * 0.25);
        const h = visualRng.range(0.08, 0.3) * (0.55 + layer * 0.45);
        buildings.push({ x, w, h, windows: visualRng.int(2, 5), seed: visualRng.next() });
        x += w * visualRng.range(1.02, 1.5);
      }
      return { depth, buildings };
    });
  }

  resize() {
    const parent = this.canvas.parentElement || document.body;
    const rect = parent.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, Math.floor(rect.width));
    this.height = Math.max(320, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.computeLayout();
  }

  /** Calcola dimensione cella e origine per far entrare tutta la griglia. */
  computeLayout(cols = CONFIG.GRID.COLS, rows = CONFIG.GRID.ROWS) {
    const narrow = this.width < 620;
    const pad = narrow ? 10 : CONFIG.RENDER.PADDING;
    const curb = narrow ? 26 : 46;               // spazio per il marciapiede
    const availW = this.width - pad * 2;
    const availH = this.height - pad * 2 - curb;
    this.cell = Math.floor(Math.min(availW / cols, availH / rows));
    this.gridW = this.cell * cols;
    this.gridH = this.cell * rows;
    this.originX = Math.round((this.width - this.gridW) / 2);
    this.originY = Math.round(this.height - this.gridH - (narrow ? 24 : 40));
    this.groundY = this.originY + this.gridH;
    this.cols = cols;
    this.rows = rows;
  }

  // --- Conversioni di coordinate --------------------------------------------

  cellX(col) { return this.originX + col * this.cell; }
  cellY(row) { return this.originY + (this.rows - 1 - row) * this.cell; }
  cellCenter(col, row) { return { x: this.cellX(col) + this.cell / 2, y: this.cellY(row) + this.cell / 2 }; }

  /**
   * Da pixel schermo a coordinate di griglia (row dal basso).
   * Applica la trasformazione INVERSA di inclinazione e zoom, altrimenti su una
   * torre pendente il click in cima cadrebbe sulla colonna sbagliata.
   */
  screenToCell(px, py) {
    const pivotX = this.originX + this.gridW / 2;
    const pivotY = this.groundY;
    const tilt = -(this.currentTilt || 0);
    const inv = 1 / (this.zoom || 1);
    let dx = (px - pivotX), dy = (py - pivotY);
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    const rx = (dx * cos - dy * sin) * inv;
    const ry = (dx * sin + dy * cos) * inv;
    px = pivotX + rx;
    py = pivotY + ry;

    const col = Math.floor((px - this.originX) / this.cell);
    const rowFromTop = Math.floor((py - this.originY) / this.cell);
    const row = (this.rows - 1) - rowFromTop;
    return { col, row, inside: col >= 0 && col < this.cols && row >= 0 && row < this.rows };
  }

  shake(power, duration) {
    this.shakeAmount = Math.max(this.shakeAmount, power);
    if (duration) this.shakeHold = Math.max(this.shakeHold || 0, duration);
  }

  /** Impulso di flash bianco (fulmini, esplosioni). */
  flashScreen(amount = 0.6) { this.flash = Math.max(this.flash, amount); }

  // --- Aggiornamento animazioni e camera ------------------------------------

  update(dt, game) {
    this.time += dt;
    const weather = game.weather;

    // Camera shake con decadimento esponenziale
    if (this.shakeHold > 0) this.shakeHold -= dt;
    else this.shakeAmount = Math.max(0, this.shakeAmount - this.shakeAmount * CONFIG.RENDER.SHAKE_DECAY * dt - dt * 2);
    const s = this.shakeAmount;
    this.shakeX = (Math.random() * 2 - 1) * s;
    this.shakeY = (Math.random() * 2 - 1) * s;

    this.zoom = damp(this.zoom, this.zoomTarget, 4, dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    if (weather.lightning > 0.9) this.flashScreen(0.55);

    this._animateBlocks(dt, game);
    this._ambientEmitters(dt, game);
  }

  /** Caduta con gravita, impatto, squash and stretch e recupero elastico. */
  _animateBlocks(dt, game) {
    const G = CONFIG.RENDER.FALL_GRAVITY;
    const MAXV = CONFIG.RENDER.FALL_MAX_SPEED;
    game.grid.each((cell, col, row) => {
      const a = cell.anim;
      if (a.fall > 0) {
        a.vy = Math.min(MAXV, a.vy + G * dt);
        a.fall -= a.vy * dt;
        if (a.fall <= 0) {
          const impact = clamp(a.vy / MAXV, 0.15, 1);
          a.fall = 0; a.vy = 0; a.falling = false;
          a.sy = 1 - 0.34 * impact;
          a.sx = 1 + 0.3 * impact;
          this.onImpact(cell, col, row, impact, game);
        }
      }
      a.sx = damp(a.sx, 1, CONFIG.RENDER.SQUASH_RECOVER, dt);
      a.sy = damp(a.sy, 1, CONFIG.RENDER.SQUASH_RECOVER, dt);
      a.flash = Math.max(0, a.flash - dt * 2.4);
      a.glow = Math.max(0, a.glow - dt * 1.6);
      if (a.born < 1) a.born = Math.min(1, a.born + dt * 4);
    });
  }

  /** Effetti d'impatto: polvere, onda d'urto, scossa e suono. */
  onImpact(cell, col, row, impact, game) {
    const c = this.cellCenter(col, row);
    const def = BlockFactory.def(cell.type);
    const y = c.y + this.cell * 0.42;
    this.particles.dust(c.x, y, Math.max(2, Math.round((6 + impact * 14) * this.quality)), mixColor(def.colorLight, '#e8e0d0', 0.5));
    if (impact > 0.55) this.particles.ring(c.x, y, rgba(def.colorLight, 0.9), this.cell * 0.3, 0.35);
    this.shake(2 + impact * (def.weight / 10));
    this.bus.emit(EVT.BLOCK_LANDED, { cell, col, row, impact });
  }

  /** Emettitori ambientali: fumo, foglie, lucciole, braci, pioggia. */
  _ambientEmitters(dt, game) {
    const t = this._emitTimers;
    const weather = game.weather;
    const night = weather.isNight;

    t.smoke += dt; t.leaf += dt; t.fire += dt; t.rain += dt; t.spark += dt;

    const q = this.quality;
    if (t.smoke > 0.14 / Math.max(0.25, q)) {
      t.smoke = 0;
      for (const cell of game.grid.listByType('IND')) {
        if (cell.anim.fall > 0 || visualRng.chance(0.45)) continue;
        const p = this.cellCenter(cell.col, cell.row);
        const smokeColor = game.economy.pollution > 70 ? '#6b6257' : '#9a9a9a';
        this.particles.smoke(p.x + this.cell * 0.22, p.y - this.cell * 0.44, 1, smokeColor);
      }
      for (const cell of game.grid.listByType('POW')) {
        if (cell.anim.fall > 0 || visualRng.chance(0.6)) continue;
        const p = this.cellCenter(cell.col, cell.row);
        this.particles.smoke(p.x - this.cell * 0.18, p.y - this.cell * 0.44, 0.8, '#c9c9c9');
      }
    }

    if (t.leaf > 0.3 / Math.max(0.25, q)) {
      t.leaf = 0;
      for (const cell of game.grid.listByType('PAR')) {
        if (cell.anim.fall > 0) continue;
        const p = this.cellCenter(cell.col, cell.row);
        if (night) { if (visualRng.chance(0.5)) this.particles.firefly(p.x + visualRng.range(-14, 14), p.y - 6); }
        else if (visualRng.chance(0.35)) this.particles.leaf(p.x + visualRng.range(-16, 16), p.y - this.cell * 0.2);
      }
    }

    if (t.spark > 0.5) {
      t.spark = 0;
      for (const cell of game.grid.listByType('POW')) {
        if (visualRng.chance(0.82)) continue;
        const p = this.cellCenter(cell.col, cell.row);
        this.particles.spark(p.x + visualRng.range(-8, 8), p.y - this.cell * 0.1, 3, '#ffe082');
      }
    }

    if (t.fire > 0.06) {
      t.fire = 0;
      game.grid.each((cell, col, row) => {
        if (cell.burning <= 0) return;
        const p = this.cellCenter(col, row);
        this.particles.ember(p.x, p.y);
      });
    }

    // Pioggia: spawn lungo tutta la larghezza sopra lo schermo
    if (weather.rain > 0.05 && t.rain > 0.016) {
      t.rain = 0;
      const drops = Math.max(1, Math.round(weather.rain * 9 * this.quality));
      for (let i = 0; i < drops; i++) {
        this.particles.raindrop(
          visualRng.range(-80, this.width + 80), -20,
          520 + weather.rain * 420, weather.windVector * 220
        );
      }
    }
  }

  // --- Disegno ---------------------------------------------------------------

  render(game) {
    const ctx = this.ctx;
    const weather = game.weather;
    const light = weather.lightLevel;

    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);

    this.drawSky(ctx, weather, game.season && game.season.current);
    this.drawStars(ctx, weather);
    this.drawCelestial(ctx, weather);
    this.drawClouds(ctx, weather);
    this.drawSkyline(ctx, weather);
    this.drawGround(ctx, weather);
    this.drawGridGuides(ctx, game);

    // La torre si inclina in base al centro di massa e al vento
    const tilt = game.physics.visualTilt();
    this.currentTilt = tilt;   // memorizzato per l'inversione in screenToCell
    ctx.save();
    const pivotX = this.originX + this.gridW / 2;
    const pivotY = this.groundY;
    ctx.translate(pivotX, pivotY);
    ctx.rotate(tilt);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-pivotX, -pivotY);

    this.drawGhost(ctx, game);
    this.drawBlocks(ctx, game, light);
    this.drawCenterOfMass(ctx, game);
    ctx.restore();

    this.particles.draw(ctx);
    this.drawWeatherOverlay(ctx, weather);
    ctx.restore();

    this.drawVignette(ctx, weather);
    if (this.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.7) + ')';
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawSky(ctx, weather, season) {
    let c = weather.skyColors();
    // v1.1.0: ogni stagione tinge leggermente il cielo
    if (season && season.tint) {
      c = {
        top: mixColor(c.top, season.tint, 0.1),
        mid: mixColor(c.mid, season.tint, 0.14),
        bot: mixColor(c.bot, season.tint, 0.18)
      };
    }
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, c.top);
    g.addColorStop(0.55, c.mid);
    g.addColorStop(1, c.bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawStars(ctx, weather) {
    const alpha = clamp(1 - weather.lightLevel * 1.8, 0, 1) * (1 - weather.info.dark);
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(this.time * s.tw + s.ph);
      ctx.globalAlpha = alpha * tw;
      ctx.beginPath();
      ctx.arc(s.x * this.width, s.y * this.height, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Sole e luna percorrono un arco in base all'ora. */
  drawCelestial(ctx, weather) {
    const h = weather.hour;
    const dayT = (h - 6) / 12;
    const nightT = h < 6 ? (h + 6) / 12 : (h - 18) / 12;

    const draw = (t, radius, color, glow) => {
      if (t < -0.05 || t > 1.05) return null;
      const x = lerp(this.width * 0.1, this.width * 0.9, t);
      const y = this.height * 0.72 - Math.sin(clamp(t, 0, 1) * Math.PI) * this.height * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
      g.addColorStop(0, glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, radius * 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      return { x, y };
    };

    if (h >= 5.8 && h <= 18.4) {
      draw(dayT, 22, '#FFF3C4', 'rgba(255,225,150,0.35)');
    } else {
      const moon = draw(nightT, 16, '#EDEFF7', 'rgba(200,215,255,0.22)');
      if (moon) {
        ctx.fillStyle = 'rgba(180,190,210,0.5)';
        ctx.beginPath(); ctx.arc(moon.x - 5, moon.y - 3, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(moon.x + 4, moon.y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawClouds(ctx, weather) {
    ctx.save();
    ctx.globalAlpha = 0.16 + weather.info.dark * 0.6;
    for (const c of this.clouds) {
      c.x += (c.speed + weather.windVector * 0.06) * 0.016;
      if (c.x > 1.3) c.x = -0.35;
      if (c.x < -0.4) c.x = 1.25;
      const x = c.x * this.width, y = c.y * this.height;
      const w = c.w * this.width, h = c.h * this.height;
      ctx.fillStyle = weather.isNight ? '#2a3350' : '#ffffff';
      for (let i = 0; i < c.puffs; i++) {
        const px = x + (i / c.puffs) * w;
        const py = y + Math.sin(i * 1.7) * h * 0.35;
        ctx.beginPath();
        ctx.ellipse(px, py, w / c.puffs * 0.9, h * (0.7 + (i % 2) * 0.4), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Skyline di sfondo su tre livelli di parallasse. */
  drawSkyline(ctx, weather) {
    const night = weather.isNight;
    const base = this.groundY + 40;
    this.skyline.forEach((layer) => {
      const depth = layer.depth;
      const offset = (this.time * 2 + weather.windVector * 6) * depth;
      const tint = night
        ? mixColor('#0B1026', '#1D2748', depth)
        : mixColor('#2B4C7A', '#7EA8CE', clamp(depth * 1.4, 0, 1));
      for (const b of layer.buildings) {
        const x = ((b.x * this.width + offset) % (this.width * 1.4)) - this.width * 0.2;
        const w = b.w * this.width;
        const h = b.h * this.height * (0.6 + depth);
        const y = base - h;
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, w, h);
        if (night) {
          ctx.fillStyle = 'rgba(255,214,140,' + (0.3 + depth * 0.3) + ')';
          const cols = b.windows;
          const rows = Math.max(2, Math.floor(h / 16));
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (hash01(Math.floor(b.seed * 100000) + r * 31 + c * 7) > 0.45) continue;
              ctx.fillRect(x + 3 + c * (w - 6) / cols, y + 5 + r * (h - 10) / rows, Math.max(1.5, (w / cols) * 0.4), 3);
            }
          }
        }
      }
    });
  }

  /** Terreno, marciapiede, strada e lampioni. */
  drawGround(ctx, weather) {
    const y = this.groundY;
    const dark = weather.isNight;
    const g = ctx.createLinearGradient(0, y, 0, this.height);
    g.addColorStop(0, dark ? '#23283A' : '#4A4F5E');
    g.addColorStop(1, dark ? '#12141F' : '#2C3040');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, this.width, this.height - y);

    ctx.fillStyle = dark ? '#31384D' : '#5C6478';
    ctx.fillRect(0, y, this.width, 6);

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 16]);
    ctx.beginPath();
    ctx.moveTo(0, y + 24);
    ctx.lineTo(this.width, y + 24);
    ctx.stroke();
    ctx.setLineDash([]);

    if (dark) {
      for (const lx of [this.originX - 18, this.originX + this.gridW + 18]) {
        const g2 = ctx.createRadialGradient(lx, y - 4, 0, lx, y - 4, 70);
        g2.addColorStop(0, 'rgba(255,200,120,0.35)');
        g2.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(lx, y - 4, 70, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /** Griglia di riferimento, colonna selezionata e linea dello Zenith. */
  drawGridGuides(ctx, game) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= this.cols; c++) {
      const x = this.cellX(c) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, this.originY); ctx.lineTo(x, this.groundY); ctx.stroke();
    }
    for (let r = 0; r <= this.rows; r++) {
      const y = this.originY + r * this.cell + 0.5;
      ctx.beginPath(); ctx.moveTo(this.originX, y); ctx.lineTo(this.originX + this.gridW, y); ctx.stroke();
    }

    if (this.hoverCol >= 0 && this.hoverCol < this.cols) {
      ctx.fillStyle = 'rgba(120,200,255,0.07)';
      ctx.fillRect(this.cellX(this.hoverCol), this.originY, this.cell, this.gridH);
    }

    const zy = this.originY + 0.5;
    ctx.strokeStyle = 'rgba(255,214,102,0.5)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(this.originX - 8, zy); ctx.lineTo(this.originX + this.gridW + 8, zy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Indicatore del centro di massa e della base d'appoggio. */
  drawCenterOfMass(ctx, game) {
    const rep = game.physics.report;
    if (!rep.footprint || rep.totalWeight <= 0) return;
    const comX = this.originX + rep.com.x * this.cell;
    const baseX = this.originX + rep.footprint.center * this.cell;
    const y = this.groundY + 14;
    const off = Math.abs(rep.effectiveImbalance);
    const color = off > CONFIG.PHYSICS.IMBALANCE_LIMIT ? '#ff5252' : off > 0.4 ? '#ffb300' : '#66bb6a';

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(baseX, y - 8); ctx.lineTo(baseX, y + 8); ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(comX, y - 9);
    ctx.lineTo(comX - 6, y + 3);
    ctx.lineTo(comX + 6, y + 3);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(baseX, y + 6); ctx.lineTo(comX, y + 6); ctx.stroke();
    ctx.restore();
  }

  /** Disegna una singola cella fantasma. */
  _ghostCell(ctx, def, col, row, ok, alpha) {
    const x = this.cellX(col), y = this.cellY(row);
    const w = this.cell, h = this.cell;
    ctx.globalAlpha = ok ? alpha : 0.4;
    ctx.fillStyle = ok ? def.color : '#8c2f2f';
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? rgba(def.colorLight, 0.9) : 'rgba(255,120,120,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6);
    ctx.stroke();
  }

  /** Anteprima del blocco selezionato: traiettoria, campata e resa attesa. */
  drawGhost(ctx, game) {
    // bersaglio armato in modalita demolizione (conferma a due tocchi)
    if (this.armedCell && game.mode === 'demolish') {
      const a = this.armedCell;
      if (game.grid.get(a.col, a.row)) {
        const x = this.cellX(a.col), y = this.cellY(a.row);
        const pulse = 0.45 + 0.35 * Math.abs(Math.sin(this.time * 6));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,90,80,' + pulse + ')';
        ctx.lineWidth = Math.max(2, this.cell * 0.08);
        roundRect(ctx, x + 2, y + 2, this.cell - 4, this.cell - 4, 7);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,90,80,0.16)';
        ctx.fill();
        ctx.restore();
      }
    }

    if (this.hoverCol < 0 || !this.ghostType) return;
    const col = this.hoverCol;
    const def = BlockFactory.def(this.ghostType);
    const anchored = !!def.anchored;
    const row = (anchored && this.ghostRow !== null && this.ghostRow !== undefined)
      ? this.ghostRow
      : (this.ghostValid && this.ghostRow !== null && this.ghostRow !== undefined
        ? this.ghostRow : game.grid.landingRow(col));
    if (row === null || row === undefined || row < 0 || row >= this.rows) return;

    const w = this.cell, h = this.cell;
    const x = this.cellX(col), y = this.cellY(row);
    const pulse = 0.55 + 0.2 * Math.sin(this.time * 5);
    const ok = this.ghostValid;

    ctx.save();

    // traiettoria di caduta (solo per i blocchi soggetti a gravita)
    if (!anchored) {
      ctx.strokeStyle = ok ? rgba(def.colorLight, 0.32) : 'rgba(255,90,90,0.35)';
      ctx.setLineDash([5, 7]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, this.originY);
      ctx.lineTo(x + w / 2, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // campata del ponte: si vedono tutti i segmenti e i due appoggi
    if (this.ghostSpan && ok) {
      for (const c of this.ghostSpan.cols) this._ghostCell(ctx, def, c, this.ghostSpan.row, true, pulse);
      ctx.strokeStyle = 'rgba(120,220,255,0.85)';
      ctx.lineWidth = 2;
      for (const anchor of [this.ghostSpan.left, this.ghostSpan.right]) {
        roundRect(ctx, this.cellX(anchor) + 2, this.cellY(this.ghostSpan.row) + 2, w - 4, h - 4, 6);
        ctx.stroke();
      }
    } else {
      this._ghostCell(ctx, def, col, row, ok, pulse);
    }

    ctx.globalAlpha = 0.85;
    ctx.font = '700 ' + Math.round(this.cell * 0.42) + 'px Rajdhani, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(def.short, x + w / 2, y + h * 0.62);

    // badge con la resa attesa
    const p = this.ghostPreview;
    if (p && ok) {
      const badges = [];
      if (p.cost) badges.push({ t: '-' + Math.round(p.cost), c: '#ff8a80' });
      if (p.coins) badges.push({ t: (p.coins > 0 ? '+' : '') + Math.round(p.coins), c: '#ffd54f' });
      if (p.happiness) badges.push({ t: (p.happiness > 0 ? '+' : '') + Math.round(p.happiness), c: p.happiness > 0 ? '#81c784' : '#ef5350' });
      if (p.population) badges.push({ t: '+' + Math.round(p.population), c: '#64b5f6' });
      ctx.font = '700 11px Rajdhani, system-ui, sans-serif';
      const side = col > this.cols - 3 ? -36 : w + 6;
      badges.forEach((b, i) => {
        const bx = x + side, by = y + 10 + i * 14;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRect(ctx, bx - 2, by - 9, 32, 13, 4); ctx.fill();
        ctx.fillStyle = b.c;
        ctx.textAlign = 'left';
        ctx.fillText(b.t, bx + 2, by + 1);
      });
    }
    ctx.restore();
  }

  /** Disegna tutti i blocchi della griglia con squash, caduta e stato. */
  drawBlocks(ctx, game, light) {
    const night = clamp(1 - light * 1.35, 0, 1);
    game.grid.each((cell, col, row) => {
      const a = cell.anim;
      const w = this.cell, h = this.cell;
      const baseX = this.cellX(col);
      const baseY = this.cellY(row) - a.fall * this.cell;

      const sx = a.sx, sy = a.sy;
      const dw = w * sx, dh = h * sy;
      const dx = baseX + (w - dw) / 2;
      const dy = baseY + (h - dh);          // ancorato al bordo inferiore

      ctx.save();
      ctx.translate(dx, dy);
      this.drawBlock(ctx, cell, dw, dh, night, game);
      ctx.restore();
    });
  }

  drawBlock(ctx, cell, w, h, night, game) {
    const def = BlockFactory.def(cell.type);
    const pad = Math.max(1, w * 0.035);
    const bw = w - pad * 2, bh = h - pad * 2;
    const dmg = clamp(cell.integrity / 100, 0, 1);

    // ombra proiettata
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(ctx, pad + 2, pad + 3, bw, bh, w * 0.12);
    ctx.fill();

    // corpo: gradiente verticale, scurito dal danno e dalla notte
    const top = mixColor(def.colorLight, def.color, 0.35);
    const bot = mixColor(def.color, def.colorDark, 0.55);
    const nightMix = 0.42 * night;
    const g = ctx.createLinearGradient(0, pad, 0, pad + bh);
    g.addColorStop(0, mixColor(mixColor(top, '#1a1f2e', nightMix), '#4a3b34', (1 - dmg) * 0.35));
    g.addColorStop(1, mixColor(mixColor(bot, '#0d1119', nightMix), '#3a2c26', (1 - dmg) * 0.35));
    ctx.fillStyle = g;
    roundRect(ctx, pad, pad, bw, bh, w * 0.12);
    ctx.fill();

    // bordo luminoso
    ctx.strokeStyle = rgba(def.colorLight, 0.35 + 0.25 * dmg);
    ctx.lineWidth = Math.max(1, w * 0.03);
    roundRect(ctx, pad, pad, bw, bh, w * 0.12);
    ctx.stroke();

    ctx.save();
    ctx.translate(pad, pad);
    this.drawBlockDetail(ctx, cell, def, bw, bh, night, game);
    ctx.restore();

    // crepe strutturali
    if (dmg < 0.92) this.drawCracks(ctx, cell, pad, bw, bh, 1 - dmg);

    // contorno di stress
    if (cell.stress > 0.85) {
      const over = clamp((cell.stress - 0.85) / 0.6, 0, 1);
      ctx.strokeStyle = 'rgba(255,' + Math.round(140 - over * 120) + ',60,' + (0.4 + 0.5 * Math.abs(Math.sin(this.time * 6))) + ')';
      ctx.lineWidth = Math.max(1.5, w * 0.05);
      roundRect(ctx, pad, pad, bw, bh, w * 0.12);
      ctx.stroke();
    }

    // incendio
    if (cell.burning > 0) this.drawFire(ctx, cell, pad, bw, bh);

    // flash bianco quando il blocco subisce danno
    if (cell.anim.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + (cell.anim.flash * 0.55) + ')';
      roundRect(ctx, pad, pad, bw, bh, w * 0.12);
      ctx.fill();
    }
  }

  drawCracks(ctx, cell, pad, w, h, severity) {
    ctx.save();
    ctx.strokeStyle = 'rgba(15,10,10,' + (0.25 + severity * 0.55) + ')';
    ctx.lineWidth = Math.max(0.8, w * 0.035 * severity);
    const lines = Math.ceil(severity * 4);
    for (let i = 0; i < lines; i++) {
      const s = hash01(cell.id * 97 + i * 13);
      const s2 = hash01(cell.id * 31 + i * 57);
      ctx.beginPath();
      ctx.moveTo(pad + s * w, pad);
      ctx.lineTo(pad + (s * 0.6 + 0.2) * w, pad + h * (0.35 + s2 * 0.3));
      ctx.lineTo(pad + s2 * w, pad + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFire(ctx, cell, pad, w, h) {
    const t = this.time * 8 + cell.id;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const fx = pad + w * (0.2 + 0.2 * i) + Math.sin(t + i) * w * 0.06;
      const fh = h * (0.35 + 0.22 * Math.abs(Math.sin(t * 0.9 + i * 1.7)));
      const g = ctx.createLinearGradient(fx, pad + h - fh, fx, pad + h);
      g.addColorStop(0, 'rgba(255,235,120,0.0)');
      g.addColorStop(0.4, 'rgba(255,170,40,0.75)');
      g.addColorStop(1, 'rgba(255,70,20,0.85)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx - w * 0.09, pad + h);
      ctx.quadraticCurveTo(fx, pad + h - fh, fx + w * 0.09, pad + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Dettagli specifici per tipo di blocco (facciate, alberi, ciminiere...). */
  drawBlockDetail(ctx, cell, def, w, h, night, game) {
    switch (cell.type) {
      case 'RES': this._detailRes(ctx, cell, def, w, h, night, game); break;
      case 'COM': this._detailCom(ctx, cell, def, w, h, night); break;
      case 'IND': this._detailInd(ctx, cell, def, w, h, night); break;
      case 'PAR': this._detailPar(ctx, cell, def, w, h, night); break;
      case 'POW': this._detailPow(ctx, cell, def, w, h, night); break;
      case 'WAT': this._detailWat(ctx, cell, def, w, h, night); break;
      case 'SUP': this._detailSup(ctx, cell, def, w, h, night); break;
      case 'BRG': this._detailBrg(ctx, cell, def, w, h, night); break;
      case 'HEL': this._detailHel(ctx, cell, def, w, h, night); break;
      case 'ECO': this._detailEco(ctx, cell, def, w, h, night); break;
      case 'BLK': this._detailBlk(ctx, cell, def, w, h, night); break;
      case 'POL': this._detailPol(ctx, cell, def, w, h, night); break;
      default: break;
    }
  }

  /** Residenziale: finestre che si accendono di notte (spente in blackout). */
  _detailRes(ctx, cell, def, w, h, night, game) {
    const cols = 3, rows = 3;
    const mw = w * 0.19, mh = h * 0.17;
    const gapX = (w - cols * mw) / (cols + 1);
    const gapY = (h - rows * mh) / (rows + 1);
    const blackout = game && game.economy.stats.blackout;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = gapX + c * (mw + gapX);
        const y = gapY + r * (mh + gapY);
        const lit = hash01(cell.id * 131 + r * 17 + c * 7) < 0.62 && !blackout;
        const flicker = 0.85 + 0.15 * Math.sin(this.time * 2 + cell.id + r + c);
        if (night > 0.25 && lit) {
          ctx.fillStyle = 'rgba(255,214,130,' + (night * flicker * 0.95) + ')';
          ctx.shadowColor = 'rgba(255,200,110,0.8)';
          ctx.shadowBlur = w * 0.18;
        } else {
          ctx.fillStyle = 'rgba(210,235,255,' + (0.22 + 0.2 * (1 - night)) + ')';
          ctx.shadowBlur = 0;
        }
        ctx.fillRect(x, y, mw, mh);
      }
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(def.colorDark, 0.6);
    ctx.fillRect(0, 0, w, h * 0.07);
  }

  /** Commerciale: vetrina, tenda a strisce e insegna al neon. */
  _detailCom(ctx, cell, def, w, h, night) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(w * 0.12, h * 0.16, w * 0.76, h * 0.34);

    const stripes = 5;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.75)' : rgba(def.colorDark, 0.8);
      ctx.fillRect(w * 0.1 + i * (w * 0.8 / stripes), h * 0.55, w * 0.8 / stripes, h * 0.12);
    }

    const glow = night > 0.2 ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2.2 + cell.id)) : 0.3;
    ctx.fillStyle = 'rgba(255,120,200,' + glow + ')';
    if (night > 0.2) { ctx.shadowColor = 'rgba(255,120,200,0.9)'; ctx.shadowBlur = w * 0.25; }
    ctx.fillRect(w * 0.22, h * 0.74, w * 0.56, h * 0.1);
    ctx.shadowBlur = 0;
  }

  /** Industriale: capannone a shed, ciminiera e strisce di pericolo. */
  _detailInd(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.85);
    ctx.fillRect(w * 0.62, -h * 0.1, w * 0.2, h * 0.42);
    ctx.fillStyle = rgba(def.colorLight, 0.5);
    ctx.fillRect(w * 0.6, -h * 0.12, w * 0.24, h * 0.06);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, w * 0.03);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.08 + i * 0.18), h * 0.42);
      ctx.lineTo(w * (0.17 + i * 0.18), h * 0.28);
      ctx.lineTo(w * (0.17 + i * 0.18), h * 0.42);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(240,180,40,0.55)';
    for (let i = 0; i < 4; i++) ctx.fillRect(w * (0.08 + i * 0.22), h * 0.78, w * 0.11, h * 0.08);
    if (night > 0.3) {
      ctx.fillStyle = 'rgba(255,80,60,' + (0.4 + 0.6 * Math.abs(Math.sin(this.time * 3))) + ')';
      ctx.beginPath(); ctx.arc(w * 0.72, -h * 0.12, w * 0.045, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Parco: prato, tronco, chioma che ondeggia al vento e cespugli. */
  _detailPar(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.55);
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.strokeStyle = '#6d4c2f';
    ctx.lineWidth = Math.max(1.5, w * 0.06);
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.78);
    ctx.lineTo(w * 0.5, h * 0.5);
    ctx.stroke();

    const sway = Math.sin(this.time * 1.4 + cell.id) * w * 0.02;
    const canopy = [
      { x: 0.5, y: 0.38, r: 0.26 }, { x: 0.32, y: 0.48, r: 0.19 },
      { x: 0.68, y: 0.48, r: 0.19 }, { x: 0.5, y: 0.58, r: 0.16 }
    ];
    for (const c of canopy) {
      ctx.fillStyle = mixColor(def.colorLight, def.colorDark, c.y);
      ctx.beginPath();
      ctx.arc(w * c.x + sway, h * c.y, w * c.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgba(def.colorDark, 0.8);
    ctx.beginPath(); ctx.arc(w * 0.18, h * 0.8, w * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.83, h * 0.82, w * 0.07, 0, Math.PI * 2); ctx.fill();
  }

  /** Centrale: torri di raffreddamento e simbolo dell'energia pulsante. */
  _detailPow(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.8);
    for (const cx of [0.28, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(w * (cx - 0.13), h * 0.9);
      ctx.lineTo(w * (cx - 0.08), h * 0.28);
      ctx.lineTo(w * (cx + 0.08), h * 0.28);
      ctx.lineTo(w * (cx + 0.13), h * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.time * 3 + cell.id));
    ctx.fillStyle = 'rgba(255,235,130,' + (0.5 + pulse * 0.45) + ')';
    if (night > 0.2) { ctx.shadowColor = 'rgba(255,200,60,0.9)'; ctx.shadowBlur = w * 0.3; }
    ctx.beginPath();
    ctx.moveTo(w * 0.52, h * 0.34);
    ctx.lineTo(w * 0.4, h * 0.6);
    ctx.lineTo(w * 0.5, h * 0.6);
    ctx.lineTo(w * 0.44, h * 0.86);
    ctx.lineTo(w * 0.64, h * 0.52);
    ctx.lineTo(w * 0.53, h * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /** Serbatoio: cisterna con livello d'acqua ondeggiante. */
  _detailWat(ctx, cell, def, w, h, night) {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, w * 0.14, h * 0.16, w * 0.72, h * 0.66, w * 0.12);
    ctx.fill();

    ctx.save();
    roundRect(ctx, w * 0.16, h * 0.18, w * 0.68, h * 0.62, w * 0.1);
    ctx.clip();
    const level = h * 0.36;
    ctx.fillStyle = rgba(def.colorDark, 0.85);
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h * 0.8);
    for (let x = 0; x <= w; x += w * 0.08) {
      const y = level + Math.sin(this.time * 2.4 + x * 0.08 + cell.id) * h * 0.03;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w * 0.84, h * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = rgba(def.colorLight, 0.6);
    ctx.lineWidth = Math.max(1, w * 0.035);
    roundRect(ctx, w * 0.14, h * 0.16, w * 0.72, h * 0.66, w * 0.12);
    ctx.stroke();
    ctx.fillStyle = rgba(def.colorDark, 0.7);
    ctx.fillRect(w * 0.22, h * 0.8, w * 0.08, h * 0.18);
    ctx.fillRect(w * 0.7, h * 0.8, w * 0.08, h * 0.18);
  }

  /** Trave: struttura reticolare in acciaio con bulloni. */
  _detailSup(ctx, cell, def, w, h, night) {
    ctx.strokeStyle = rgba(def.colorLight, 0.75);
    ctx.lineWidth = Math.max(1.5, w * 0.06);
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h * 0.12); ctx.lineTo(w * 0.88, h * 0.88);
    ctx.moveTo(w * 0.88, h * 0.12); ctx.lineTo(w * 0.12, h * 0.88);
    ctx.stroke();
    ctx.fillStyle = rgba(def.colorLight, 0.55);
    ctx.fillRect(0, h * 0.06, w, h * 0.1);
    ctx.fillRect(0, h * 0.84, w, h * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const p of [[0.16, 0.16], [0.84, 0.16], [0.16, 0.84], [0.84, 0.84]]) {
      ctx.beginPath(); ctx.arc(w * p[0], h * p[1], w * 0.045, 0, Math.PI * 2); ctx.fill();
    }
  }


  /** Ponte sospeso: impalcato, cavi e piloni. */
  _detailBrg(ctx, cell, def, w, h, night) {
    // impalcato
    ctx.fillStyle = rgba(def.colorLight, 0.75);
    ctx.fillRect(0, h * 0.44, w, h * 0.16);
    ctx.fillStyle = rgba(def.colorDark, 0.9);
    ctx.fillRect(0, h * 0.58, w, h * 0.06);

    // cavi sospesi
    ctx.strokeStyle = rgba(def.colorLight, 0.6);
    ctx.lineWidth = Math.max(1, w * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.16);
    ctx.quadraticCurveTo(w * 0.5, h * 0.44, w, h * 0.16);
    ctx.stroke();
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const cy = h * 0.16 + Math.sin(t * Math.PI) * h * 0.24;
      ctx.beginPath();
      ctx.moveTo(w * t, cy);
      ctx.lineTo(w * t, h * 0.44);
      ctx.stroke();
    }

    // luci di segnalazione notturne
    if (night > 0.3) {
      ctx.fillStyle = 'rgba(120,220,255,' + (0.5 + 0.4 * Math.abs(Math.sin(this.time * 2 + cell.id))) + ')';
      ctx.fillRect(w * 0.1, h * 0.4, w * 0.1, h * 0.04);
      ctx.fillRect(w * 0.8, h * 0.4, w * 0.1, h * 0.04);
    }
  }

  /** Elisuperficie: piazzola con la H e rotore che gira all'arrivo dei VIP. */
  _detailHel(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.9);
    ctx.fillRect(0, h * 0.34, w, h * 0.66);

    // cerchio della piazzola
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1.5, w * 0.05);
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.62, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    // la H
    ctx.lineWidth = Math.max(2, w * 0.07);
    ctx.beginPath();
    ctx.moveTo(w * 0.38, h * 0.48); ctx.lineTo(w * 0.38, h * 0.76);
    ctx.moveTo(w * 0.62, h * 0.48); ctx.lineTo(w * 0.62, h * 0.76);
    ctx.moveTo(w * 0.38, h * 0.62); ctx.lineTo(w * 0.62, h * 0.62);
    ctx.stroke();

    // luci perimetrali lampeggianti
    const blink = 0.35 + 0.65 * Math.abs(Math.sin(this.time * 3 + cell.id));
    ctx.fillStyle = 'rgba(255,90,80,' + blink + ')';
    for (const px of [0.12, 0.88]) {
      ctx.beginPath(); ctx.arc(w * px, h * 0.4, w * 0.05, 0, Math.PI * 2); ctx.fill();
    }

    // rotore in rotazione quando l'elicottero e in arrivo
    if (cell.vipTimer > 0) {
      const a = this.time * 18;
      ctx.strokeStyle = 'rgba(230,240,255,0.85)';
      ctx.lineWidth = Math.max(1.5, w * 0.05);
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - Math.cos(a) * w * 0.4, h * 0.2 - Math.sin(a) * h * 0.06);
      ctx.lineTo(w * 0.5 + Math.cos(a) * w * 0.4, h * 0.2 + Math.sin(a) * h * 0.06);
      ctx.stroke();
      ctx.fillStyle = '#2b3442';
      ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.26, w * 0.16, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Idroponico: telaio con vasche, fogliame e barra di maturazione. */
  _detailEco(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.55);
    ctx.fillRect(w * 0.08, h * 0.1, w * 0.84, h * 0.8);

    // ripiani di coltura
    for (let i = 0; i < 3; i++) {
      const y = h * (0.24 + i * 0.24);
      ctx.fillStyle = rgba(def.colorLight, 0.55);
      ctx.fillRect(w * 0.12, y, w * 0.76, h * 0.05);
      const sway = Math.sin(this.time * 1.6 + i + cell.id) * w * 0.02;
      ctx.fillStyle = mixColor(def.colorLight, def.colorDark, 0.35);
      for (let k = 0; k < 3; k++) {
        const cx = w * (0.24 + k * 0.26) + sway;
        ctx.beginPath();
        ctx.ellipse(cx, y - h * 0.05, w * 0.09, h * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // gocce di nutrimento
    ctx.fillStyle = 'rgba(150,230,255,0.65)';
    const drop = (this.time * 40 + cell.id * 13) % (h * 0.8);
    ctx.fillRect(w * 0.5, h * 0.1 + drop, w * 0.035, h * 0.06);

    // maturazione verso la prossima espansione
    const p = Math.min(1, (cell.growth || 0) / 5);
    if (p > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(w * 0.12, h * 0.92, w * 0.76, h * 0.05);
      ctx.fillStyle = '#8BF5C0';
      ctx.fillRect(w * 0.12, h * 0.92, w * 0.76 * p, h * 0.05);
    }
  }

  /** Mercato nero: vicolo con insegna spenta e traffici notturni. */
  _detailBlk(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.9);
    ctx.fillRect(0, h * 0.12, w, h * 0.88);

    // saracinesca semiaperta
    ctx.fillStyle = rgba(def.colorLight, 0.35);
    for (let i = 0; i < 4; i++) ctx.fillRect(w * 0.18, h * (0.2 + i * 0.07), w * 0.64, h * 0.035);
    ctx.fillStyle = 'rgba(10,8,20,0.92)';
    ctx.fillRect(w * 0.18, h * 0.5, w * 0.64, h * 0.36);

    // sagoma nell'ombra
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.6, w * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(w * 0.4, h * 0.66, w * 0.2, h * 0.2);

    // insegna al neon viola, piu intensa se la colonna e insicura
    const alert = cell.covered === false;
    const glow = (alert ? 0.6 : 0.3) + (alert ? 0.4 : 0.2) * Math.abs(Math.sin(this.time * (alert ? 5 : 1.6) + cell.id));
    ctx.fillStyle = 'rgba(186,104,255,' + glow + ')';
    if (night > 0.15 || alert) { ctx.shadowColor = 'rgba(186,104,255,0.9)'; ctx.shadowBlur = w * 0.28; }
    ctx.fillRect(w * 0.24, h * 0.06, w * 0.52, h * 0.07);
    ctx.shadowBlur = 0;
  }

  /** Stazione di polizia: lampeggianti blu e scudo. */
  _detailPol(ctx, cell, def, w, h, night) {
    ctx.fillStyle = rgba(def.colorDark, 0.85);
    ctx.fillRect(0, h * 0.2, w, h * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(w * 0.1, h * 0.34, w * 0.8, h * 0.24);

    // scudo
    ctx.fillStyle = rgba(def.colorLight, 0.9);
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.62);
    ctx.lineTo(w * 0.33, h * 0.74);
    ctx.lineTo(w * 0.36, h * 0.9);
    ctx.lineTo(w * 0.5, h * 0.97);
    ctx.lineTo(w * 0.64, h * 0.9);
    ctx.lineTo(w * 0.67, h * 0.74);
    ctx.closePath();
    ctx.fill();

    // lampeggianti alternati
    const t = Math.sin(this.time * 5 + cell.id) > 0;
    ctx.fillStyle = t ? 'rgba(80,160,255,0.95)' : 'rgba(40,70,140,0.5)';
    ctx.fillRect(w * 0.16, h * 0.12, w * 0.28, h * 0.09);
    ctx.fillStyle = t ? 'rgba(255,80,80,0.5)' : 'rgba(255,80,80,0.95)';
    ctx.fillRect(w * 0.56, h * 0.12, w * 0.28, h * 0.09);
    if (night > 0.25) {
      ctx.shadowColor = t ? 'rgba(80,160,255,0.8)' : 'rgba(255,80,80,0.8)';
      ctx.shadowBlur = w * 0.3;
      ctx.fillRect(w * (t ? 0.16 : 0.56), h * 0.12, w * 0.28, h * 0.09);
      ctx.shadowBlur = 0;
    }
  }

  /** Velo atmosferico: nebbia, scurimento da tempesta, bagliore dei fulmini. */
  drawWeatherOverlay(ctx, weather) {
    if (weather.condition === 'fog') {
      const g = ctx.createLinearGradient(0, this.height * 0.3, 0, this.height);
      g.addColorStop(0, 'rgba(200,205,215,0)');
      g.addColorStop(1, 'rgba(200,205,215,0.32)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (weather.info.dark > 0) {
      ctx.fillStyle = 'rgba(20,24,38,' + (weather.info.dark * 0.35) + ')';
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (weather.lightning > 0) {
      ctx.fillStyle = 'rgba(220,235,255,' + (weather.lightning * 0.35) + ')';
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  /** Vignettatura: piu marcata di notte, aiuta a leggere la HUD. */
  drawVignette(ctx, weather) {
    const strength = 0.28 + (1 - weather.lightLevel) * 0.3;
    const g = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + strength + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** Testo fluttuante ancorato a una cella (convertito in pixel schermo). */
  floaterAtCell(col, row, text, color, size) {
    const p = this.cellCenter(col, row);
    this.particles.floater(p.x, p.y - this.cell * 0.2, text, color, size || Math.max(12, this.cell * 0.34));
  }

  /** Esplosione completa in una cella: detriti, onda d'urto, scintille. */
  burstAtCell(col, row, color) {
    const p = this.cellCenter(col, row);
    this.particles.debris(p.x, p.y, color, 16);
    this.particles.ring(p.x, p.y, rgba(color, 0.9), this.cell * 0.35, 0.5);
    this.particles.spark(p.x, p.y, 6, '#ffd54f');
  }
}
