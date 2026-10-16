export const MIN_ITEMS = 5000;

export function parseItemList(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+):\s*(\S+)\s*(?::\s*(.*?))?\s*$/.exec(line);
    if (match) items[Number(match[1])] = [match[2], match[3] || match[2]];
  }
  return Array.from(items, (item) => item ?? null);
}

export function countItems(items) {
  return items.filter(Boolean).length;
}
