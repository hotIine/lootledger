// { [itemId]: { [quality]: { value, time } } }

export function notePrice(book, itemId, quality, value, time) {
  if (!itemId || !(value > 0)) return;
  book[itemId] ??= {};
  book[itemId][quality] = { value, time };
}

// Same as StatisticsAnalysis: min of 1-2 values, otherwise drop the high/low
// and take the one closest to the mean.
export function priceOf(book, itemId) {
  const values = Object.values(book[itemId] ?? {}).map((entry) => entry.value).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  if (values.length < 3) return values[0];
  const middle = values.slice(1, -1);
  const average = middle.reduce((sum, v) => sum + v, 0) / middle.length;
  return middle.reduce((best, v) => (Math.abs(v - average) < Math.abs(best - average) ? v : best));
}

// median of recent sell_price_min, skipping Black Market
const MAX_LISTING_AGE = 30 * 24 * 3600e3;

export function marketPrice(records, now) {
  const prices = records
    .filter((r) => r.city !== 'Black Market' && r.sell_price_min > 0
      && now - Date.parse(`${r.sell_price_min_date}Z`) < MAX_LISTING_AGE)
    .map((r) => r.sell_price_min).sort((a, b) => a - b);
  return prices.length ? prices[Math.floor(prices.length / 2)] : 0;
}
