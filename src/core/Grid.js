/**
 * Grid.js - Matrice bidimensionale della citta + gravita a griglia.
 *
 * CONVENZIONE DI COORDINATE (importante):
 *   row 0  = fondamenta (suolo)
 *   row N-1= cima della griglia (Zenith)
 *   col 0  = sinistra
 * Il RenderEngine converte in coordinate schermo, la logica resta "bottom-up".
 */

import { CONFIG } from '../config/Config.js';
import { BlockFactory } from './BlockFactory.js';

export class Grid {
  constructor(cols = CONFIG.GRID.COLS, rows = CONFIG.GRID.ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.cells = [];
    this.clear();
  }

  clear() {
    this.cells = new Array(this.rows);
    for (let r = 0; r < this.rows; r++) this.cells[r] = new Array(this.cols).fill(null);
  }

  inBounds(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  get(col, row) {
    return this.inBounds(col, row) ? this.cells[row][col] : null;
  }

  isEmpty(col, row) { return this.inBounds(col, row) && this.cells[row][col] === null; }

  set(col, row, cell) {
    if (!this.inBounds(col, row)) return null;
    this.cells[row][col] = cell;
    if (cell) { cell.col = col; cell.row = row; }
    return cell;
  }

  clearAt(col, row) {
    if (!this.inBounds(col, row)) return null;
    const cell = this.cells[row][col];
    this.cells[row][col] = null;
    return cell;
  }

  /** Prima riga libera dal basso: dove atterra un blocco. -1 se la colonna e piena. */
  landingRow(col) {
    if (col < 0 || col >= this.cols) return -1;
    for (let r = 0; r < this.rows; r++) if (this.cells[r][col] === null) return r;
    return -1;
  }

  /** Altezza (numero di celle occupate) della colonna, contando dal basso. */
  columnHeight(col) {
    let h = 0;
    for (let r = 0; r < this.rows; r++) { if (this.cells[r][col]) h = r + 1; }
    return h;
  }

  maxHeight() {
    let max = 0;
    for (let c = 0; c < this.cols; c++) max = Math.max(max, this.columnHeight(c));
    return max;
  }

  count() {
    let n = 0;
    this.each(() => n++);
    return n;
  }

  isFull() { return this.count() >= this.cols * this.rows; }

  /** Vicini ortogonali (chiavi up/down/left/right, valori cella o null). */
  neighbors(col, row) {
    return {
      up: this.get(col, row + 1),
      down: this.get(col, row - 1),
      left: this.get(col - 1, row),
      right: this.get(col + 1, row)
    };
  }

  /** Lista dei soli vicini realmente occupati. */
  neighborList(col, row) {
    const n = this.neighbors(col, row);
    return [n.up, n.down, n.left, n.right].filter(Boolean);
  }

  /** Numero di lati occupati (per il rischio di soffocamento delle centrali). */
  enclosure(col, row) {
    const n = this.neighbors(col, row);
    let count = 0;
    // il suolo sotto la riga 0 conta come lato chiuso
    if (n.down || row === 0) count++;
    if (n.up) count++;
    if (n.left || col === 0) count++;
    if (n.right || col === this.cols - 1) count++;
    return count;
  }

  /** Itera tutte le celle occupate dal basso verso l'alto. */
  each(fn) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell) fn(cell, c, r);
      }
    }
  }

  list() {
    const out = [];
    this.each((cell) => out.push(cell));
    return out;
  }

  listByType(type) {
    const out = [];
    this.each((cell) => { if (cell.type === type) out.push(cell); });
    return out;
  }

  /**
   * Applica la gravita alla colonna: compatta le celle verso il basso
   * eliminando i buchi lasciati da demolizioni/crolli.
   * Restituisce [{ cell, from, to }] per animare la caduta.
   */
  compactColumn(col) {
    const moves = [];
    let write = 0;
    for (let r = 0; r < this.rows; r++) {
      const cell = this.cells[r][col];
      if (!cell) continue;
      if (r !== write) {
        this.cells[write][col] = cell;
        this.cells[r][col] = null;
        const from = cell.row;
        cell.row = write;
        moves.push({ cell, from, to: write });
      }
      write++;
    }
    return moves;
  }

  compactAll() {
    let moves = [];
    for (let c = 0; c < this.cols; c++) moves = moves.concat(this.compactColumn(c));
    return moves;
  }

  /** Peso totale che grava SOPRA la cella indicata (stessa colonna). */
  loadAbove(col, row) {
    let total = 0;
    for (let r = row + 1; r < this.rows; r++) {
      const cell = this.cells[r][col];
      if (cell) total += BlockFactory.weight(cell.type);
    }
    return total;
  }

  /** Numero di travi [SUP] presenti nella colonna da row in giu (inclusa). */
  supportsBelow(col, row) {
    let n = 0;
    for (let r = row; r >= 0; r--) {
      const cell = this.cells[r][col];
      if (cell && BlockFactory.def(cell.type).isSupport) n++;
    }
    return n;
  }

  /** Colonne che poggiano sul terreno: definiscono la base d'appoggio. */
  footprint() {
    let min = Infinity, max = -Infinity, n = 0;
    for (let c = 0; c < this.cols; c++) {
      if (this.cells[0][c]) { min = Math.min(min, c); max = Math.max(max, c); n++; }
    }
    if (n === 0) return { min: 0, max: this.cols - 1, width: this.cols, center: this.cols / 2, count: 0 };
    return { min, max, width: (max - min) + 1, center: (min + max + 1) / 2, count: n };
  }

  // --- Serializzazione ------------------------------------------------------

  serialize() {
    const cells = [];
    this.each((cell) => {
      cells.push({
        i: cell.id, t: cell.type, c: cell.col, r: cell.row,
        h: Math.round(cell.integrity), b: cell.burning, p: cell.placedTurn
      });
    });
    return { cols: this.cols, rows: this.rows, cells };
  }

  deserialize(data) {
    if (!data) return;
    this.cols = data.cols || CONFIG.GRID.COLS;
    this.rows = data.rows || CONFIG.GRID.ROWS;
    this.clear();
    let maxId = 0;
    for (const raw of (data.cells || [])) {
      if (!BlockFactory.exists(raw.t)) continue;
      const cell = BlockFactory.create(raw.t, raw.c, raw.r, raw.p || 0);
      cell.id = raw.i || cell.id;
      cell.integrity = typeof raw.h === 'number' ? raw.h : 100;
      cell.burning = raw.b || 0;
      maxId = Math.max(maxId, cell.id);
      this.set(raw.c, raw.r, cell);
    }
    BlockFactory.syncUid(maxId);
  }
}
