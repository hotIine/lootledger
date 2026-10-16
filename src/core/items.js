import bundledItems from './itemIndex.js';

// Quality is ignored since the loot log doesn't record it.

export function itemKey(name, enchant) {
  return `${name.trim().toLowerCase()}@${enchant}`;
}

export function enchantFromItemId(itemId) {
  const match = /@(\d+)$/.exec(itemId);
  return match ? Number(match[1]) : 0;
}

export function itemLabel(name, enchant) {
  return enchant > 0 ? `${name} .${enchant}` : name;
}

export function itemTier(itemId) {
  const match = /^T(\d)_/.exec(itemId ?? '');
  return match ? Number(match[1]) : 0;
}

const TYPE_PATTERNS = [
  ['mount', /_MOUNT/],
  ['weapon', /_(MAIN|2H|OFF)_/],
  ['armor', /_(HEAD|ARMOR|SHOES)_/],
  ['cape', /_CAPE/],
  ['bag', /_BAG/],
  ['consumable', /_(POTION|MEAL)_?/],
];

export function isTrash(itemId) {
  return /_TRASH$/.test(itemId ?? '');
}

export function itemType(itemId) {
  return TYPE_PATTERNS.find(([, pattern]) => pattern.test(itemId ?? ''))?.[0] ?? 'other';
}

const TIER_WORDS = { "Beginner's": 1, "Novice's": 2, "Journeyman's": 3, "Adept's": 4, "Expert's": 5, "Master's": 6, "Grandmaster's": 7, "Elder's": 8 };

function splitTierWord(name) {
  const [first, ...rest] = name.trim().split(' ');
  return TIER_WORDS[first] ? { tier: TIER_WORDS[first], base: rest.join(' ').toLowerCase() } : { tier: 0, base: name.trim().toLowerCase() };
}

let itemList = bundledItems;
let idsByName = buildIdsByName(itemList);

export function useItemList(list) {
  itemList = list;
  idsByName = buildIdsByName(list);
}

// some names are shared; prefer the tiered item over quest/unique copies
function buildIdsByName(list) {
  const ids = new Map();
  for (const entry of list) {
    if (!entry) continue;
    const [id, name] = entry;
    const key = name.toLowerCase();
    const baseId = id.replace(/@\d+$/, '');
    const existing = ids.get(key);
    if (!existing || (existing.startsWith('UNIQUE_') && !baseId.startsWith('UNIQUE_'))) ids.set(key, baseId);
  }
  return ids;
}

export function itemAtIndex(index) {
  const entry = itemList[index];
  return entry ? { id: entry[0], name: entry[1] } : { id: `UNKNOWN_ITEM_${index}`, name: `Unknown item ${index}` };
}

// Chest rows only have names, so infer IDs (for icons) from loot rows,
// falling back to the item list.
export function buildItemIdLookup(pickups) {
  const byBase = new Map();
  for (const p of pickups) {
    const { tier, base } = splitTierWord(p.itemName);
    const idWithoutEnchant = p.itemId.replace(/@\d+$/, '');
    byBase.set(base, tier ? idWithoutEnchant.replace(/^T\d_/, '') : idWithoutEnchant);
  }
  return (name, enchant) => {
    const { tier, base } = splitTierWord(name);
    const pattern = byBase.get(base);
    const id = pattern ? (tier ? `T${tier}_${pattern}` : pattern) : idsByName.get(name.trim().toLowerCase());
    if (!id) return undefined;
    return enchant > 0 ? `${id}@${enchant}` : id;
  };
}
