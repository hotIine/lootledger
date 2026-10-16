const STORAGE_KEY = 'loot-ledger-prices';

export function loadPrices() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function savePrices(book) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
    return '';
  } catch (error) {
    return `Could not save item values (${error.message}).`;
  }
}
