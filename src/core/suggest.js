import { itemType } from './items.js';
import { countByPickup, unitRef } from './reconcile.js';

// Matches leftover deposits (beyond the depositor's own pickups) to players who owe.
// 1. Officer batches: 3+ distinct gear items lining up between A's debt and B's
//    extra deposits get credited to B.
// 2. Remaining spares settle everyone owing that item if there's enough, or a
//    lone ower. Otherwise nobody is cleared.

const STRONG_PAIR_ITEMS = 3;

export function suggestTransfers(units, excess, dismissedIds = new Set()) {
  const extra = groupExcess(excess);
  const used = new Set();
  const owed = settle(units.filter((u) => u.status === 'held'), extra, dismissedIds, used);
  const stillOwed = new Set(units.filter((u) => u.status === 'held' && !used.has(u)).map((u) => u.key));
  const dropped = settle(units.filter((u) => u.status === 'dropped'), withoutKeys(extra, stillOwed), dismissedIds, used);
  return [...owed, ...dropped];
}

function settle(units, extra, dismissedIds, used) {
  const strong = strongPairs(units.filter((u) => itemType(u.itemId) !== 'consumable'), extra, dismissedIds, used);
  return [...strong, ...leftovers(units.filter((u) => !used.has(u)), extra, dismissedIds, used)];
}

function strongPairs(units, extra, dismissedIds, used) {
  const owned = groupByHolder(units);
  const matches = [];
  for (const pair of rankPairs(owned, extra).filter((p) => !dismissedIds.has(p.id))) {
    const planned = plan(owned.get(pair.from), extra.get(pair.to));
    if (planned.length < STRONG_PAIR_ITEMS) continue;
    const items = planned.map((item) => take(item, owned.get(pair.from), extra.get(pair.to)));
    items.flatMap((item) => item.units).forEach((u) => used.add(u));
    matches.push(toMatch(pair, items));
  }
  return matches;
}

function leftovers(units, extra, dismissedIds, used) {
  const matches = new Map();
  for (const [key, holders] of holdersByKey(units)) {
    const owners = [...holders].filter(([, list]) => list.length > 0);
    const depositors = [...extra].filter(([to, wanted]) => (wanted.get(key)?.qty ?? 0) > 0 && !holders.has(to));
    const spares = depositors.reduce((sum, [, wanted]) => sum + wanted.get(key).qty, 0);
    const owed = owners.reduce((sum, [, list]) => sum + list.length, 0);
    if (owners.length === 0 || spares === 0 || (owners.length > 1 && spares < owed)) continue;
    for (const [to, wanted] of depositors) {
      for (const [from, list] of owners) creditSpares({ from, to, key, list, wanted, matches, dismissedIds, used });
    }
  }
  return [...matches.values()].map(({ pair, items }) => toMatch(pair, items));
}

function withoutKeys(extra, keys) {
  return new Map([...extra].map(([player, wanted]) => [player, new Map([...wanted].filter(([key]) => !keys.has(key)))]));
}

function creditSpares({ from, to, key, list, wanted, matches, dismissedIds, used }) {
  const id = `${from}->${to}`;
  const count = Math.min(wanted.get(key).qty, list.length);
  if (count === 0 || dismissedIds.has(id)) return;
  if (!matches.has(id)) matches.set(id, { pair: { id, from, to }, items: [] });
  const item = take({ key, count }, new Map([[key, list]]), wanted);
  item.units.forEach((u) => used.add(u));
  matches.get(id).items.push(item);
}

function holdersByKey(units) {
  const byKey = new Map();
  for (const [holder, keys] of groupByHolder(units)) {
    for (const [key, list] of keys) {
      if (!byKey.has(key)) byKey.set(key, new Map());
      byKey.get(key).set(holder, list);
    }
  }
  return byKey;
}

function plan(owned, wanted) {
  return [...wanted].map(([key, entry]) => ({ key, count: Math.min(entry.qty, owned.get(key)?.length ?? 0) }))
    .filter((item) => item.count > 0);
}

function take({ key, count }, owned, wanted) {
  const entry = wanted.get(key);
  entry.qty -= count;
  return { key, itemName: entry.itemName, enchant: entry.enchant, units: owned.get(key).splice(0, count) };
}

function toMatch(pair, items) {
  const units = items.flatMap((item) => item.units);
  return { ...pair, items, qty: units.length, value: units.reduce((sum, u) => sum + u.value, 0) };
}

export function suggestionToActions(suggestion) {
  return countByPickup(suggestion.items.flatMap((item) => item.units)).map(({ unit, qty }) => ({
    type: 'transfer', ...unitRef(unit), to: suggestion.to, qty, batch: suggestion.id,
  }));
}


function groupByHolder(units) {
  const byHolder = new Map();
  for (const unit of units) {
    if (!byHolder.has(unit.holder)) byHolder.set(unit.holder, new Map());
    const byKey = byHolder.get(unit.holder);
    if (!byKey.has(unit.key)) byKey.set(unit.key, []);
    byKey.get(unit.key).push(unit);
  }
  return byHolder;
}

function groupExcess(excess) {
  const byPlayer = new Map();
  for (const e of excess) {
    if (!byPlayer.has(e.player)) byPlayer.set(e.player, new Map());
    const byKey = byPlayer.get(e.player);
    const entry = byKey.get(e.key) ?? { qty: 0, itemName: e.itemName, enchant: e.enchant };
    entry.qty += e.qty;
    byKey.set(e.key, entry);
  }
  return byPlayer;
}

function rankPairs(held, extra) {
  const pairs = [];
  for (const [to, wanted] of extra) {
    for (const [from, owned] of held) {
      if (from === to) continue;
      const matches = [...wanted].map(([key, entry]) => Math.min(entry.qty, owned.get(key)?.length ?? 0));
      const distinctItems = matches.filter((count) => count > 0).length;
      const units = matches.reduce((a, b) => a + b, 0);
      if (units > 0) pairs.push({ id: `${from}->${to}`, from, to, distinctItems, units });
    }
  }
  // distinct gear is evidence, matching potions aren't
  return pairs.sort((a, b) => b.distinctItems - a.distinctItems || b.units - a.units || a.id.localeCompare(b.id));
}
