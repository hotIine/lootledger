import { itemType } from './items.js';
import { deathTimeAfter } from './reconcile.js';

const MIN_DEPOSITORS = 2;
const MIN_ITEMS = 2;
const REJECTION_MATCH_MS = 30 * 1000;

export function inferDeaths(units, pickups, knownDeaths, rejectedIds) {
  const bursts = new Map();
  const burstsPerItem = countBurstsPerItem(units, pickups);
  for (const unit of units.filter((u) => u.status === 'deposited')) {
    const time = deathTimeAfter(pickups, unit.pickedBy, unit.time);
    const id = `death:${unit.pickedBy}:${time}`;
    if (!bursts.has(id)) {
      bursts.set(id, { id, player: unit.pickedBy, time, start: unit.time, depositors: new Set(), items: new Set(), isSurvived: false });
    }
    const burst = bursts.get(id);
    burst.start = Math.min(burst.start, unit.time);
    if (burstsPerItem.get(`${unit.pickedBy}|${unit.key}`) !== 1) continue;
    if (unit.holder === unit.pickedBy) burst.isSurvived = true;
    else if (itemType(unit.itemId) !== 'consumable') {
      burst.depositors.add(unit.holder);
      burst.items.add(unit.key);
    }
  }
  return [...bursts.values()].filter((b) => !b.isSurvived && b.depositors.size >= MIN_DEPOSITORS && b.items.size >= MIN_ITEMS
    && !isRejected(b, rejectedIds) && !isAlreadyKnown(b, pickups, knownDeaths))
    .map((b) => ({ kind: 'death', id: b.id, player: b.player, time: b.time, depositors: [...b.depositors] }));
}

function isRejected(burst, rejectedIds) {
  return [...rejectedIds].some((id) => {
    const [kind, player, time] = id.split(':');
    return kind === 'death' && player === burst.player && Math.abs(Number(time) - burst.time) <= REJECTION_MATCH_MS;
  });
}

function countBurstsPerItem(units, pickups) {
  const bursts = new Map();
  for (const unit of units) {
    const id = `${unit.pickedBy}|${unit.key}`;
    if (!bursts.has(id)) bursts.set(id, new Set());
    bursts.get(id).add(deathTimeAfter(pickups, unit.pickedBy, unit.time));
  }
  return new Map([...bursts].map(([id, set]) => [id, set.size]));
}

function isAlreadyKnown(burst, pickups, knownDeaths) {
  const next = pickups.find((p) => p.looter === burst.player && p.time > burst.time)?.time ?? Infinity;
  return knownDeaths.some((d) => d.player === burst.player && d.time >= burst.start && d.time < next);
}
