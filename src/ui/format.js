export { formatSilver } from '../core/summary.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function formatClock(ms) {
  return new Date(ms).toISOString().slice(11, 16);
}

export function formatDateTime(ms) {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;
}

export function iconUrl(itemId, size) {
  return `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=${size}`;
}
