import { marketPrice } from '../core/priceBook.js';

const STORAGE_KEY = 'loot-ledger-market';
const API = 'https://east.albion-online-data.com/api/v2/stats/prices/';
const MAX_AGE = 24 * 3600e3;
const RETRY_AFTER = 60e3;
const BATCH_SIZE = 100;
const cache = load();
const pending = new Set();
let lastFailure = 0;

export function marketPriceOf(itemId) {
  return cache[itemId]?.value ?? 0;
}

export async function priceFromMarket(pickups) {
  const now = Date.now();
  if (now - lastFailure < RETRY_AFTER) return false;
  const wanted = [...new Set(pickups.map((p) => p.itemId))]
    .filter((id) => id && !pending.has(id) && !(now - (cache[id]?.time ?? 0) < MAX_AGE));
  if (wanted.length === 0) return false;
  wanted.forEach((id) => pending.add(id));
  try {
    for (let i = 0; i < wanted.length; i += BATCH_SIZE) await fetchBatch(wanted.slice(i, i + BATCH_SIZE), now);
    return true;
  } catch (error) {
    lastFailure = now;
    throw error;
  } finally {
    wanted.forEach((id) => pending.delete(id));
    save();
  }
}

async function fetchBatch(ids, now) {
  const response = await fetch(`${API}${ids.join(',')}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const records = await response.json();
  ids.forEach((id) => { cache[id] = { value: marketPrice(records.filter((r) => r.item_id === id), now), time: now }; });
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch {}
}
