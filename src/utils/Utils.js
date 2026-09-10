/** Utils.js - Helper matematici, easing, colore e formattazione condivisi. */

export const clamp = (v, min, max) => (v < min ? min : (v > max ? max : v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** Interpolazione esponenziale indipendente dal framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function mixColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
}

/** amount > 0 schiarisce, amount < 0 scurisce. */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return amount >= 0
    ? rgbToHex(lerp(r, 255, amount), lerp(g, 255, amount), lerp(b, 255, amount))
    : rgbToHex(lerp(r, 0, -amount), lerp(g, 0, -amount), lerp(b, 0, -amount));
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

export function formatNumber(n) {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(v);
}

export function formatSigned(n) {
  const v = Math.round(n);
  return (v > 0 ? '+' : '') + formatNumber(v);
}

export function formatClock(hour) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((((hour % 1) + 1) % 1) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Rettangolo arrotondato compatibile anche senza ctx.roundRect. */
export function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Aggiunge un valore a un accumulatore numerico di un oggetto. */
export function bump(obj, key, value) {
  obj[key] = (obj[key] || 0) + value;
  return obj[key];
}
