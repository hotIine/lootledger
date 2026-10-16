import { isTrash } from './items.js';

const CORPSE_WINDOW_MS = 3 * 60 * 1000;
const LOOTING_BURST_GAP_MS = 60 * 1000;
const EVENT_ORDER = { death: 0, pickup: 1, deposit: 2 };
const SAME_PICKUP_MS = 2 * 60 * 1000;

export function reconcile({ pickups, deaths, deposits, isFriendly, actions = [] }) {
  const state = { units: [], excess: [], deathAt: new Map(), lastActive: new Map(), isFriendly };
  for (const event of timeline(pickups, deaths, deposits)) applyEvent(state, event);
  const applied = new Set(actions.filter((action) => applyAction(state, action) > 0).map((action) => action.batch));
  const unapplied = new Set(actions.map((action) => action.batch).filter((batch) => !applied.has(batch)));
  return { units: state.units, excess: state.excess.filter((e) => e.qty > 0), unapplied };
}

export function unitRef(unit) {
  return { pickup: { looter: unit.pickedBy, key: unit.key, from: unit.from, time: unit.time }, holder: unit.holder };
}

export function countByPickup(units) {
  const counts = new Map();
  for (const unit of units) {
    const id = `${unit.eventId}|${unit.holder}`;
    if (!counts.has(id)) counts.set(id, { unit, qty: 0 });
    counts.get(id).qty += 1;
  }
  return [...counts.values()];
}

export function findPickup(pickups, ref) {
  let best = null;
  for (const p of pickups) {
    if (p.looter !== ref.looter || p.key !== ref.key || p.from !== ref.from) continue;
    const gap = Math.abs(p.time - ref.time);
    if (gap <= SAME_PICKUP_MS && (!best || gap < Math.abs(best.time - ref.time))) best = p;
  }
  return best;
}

export function isSamePickup(unit, pickup) {
  return Boolean(pickup) && unit.pickedBy === pickup.looter && unit.key === pickup.key && unit.from === pickup.from
    && Math.abs(unit.time - pickup.time) <= SAME_PICKUP_MS;
}

export function deathTimeAfter(pickups, player, time) {
  let end = time;
  for (const p of pickups) {
    if (p.looter !== player || p.time <= end) continue;
    if (p.time - end > LOOTING_BURST_GAP_MS) break;
    end = p.time;
  }
  return end + 1;
}

function timeline(pickups, deaths, deposits) {
  const tagged = [
    ...deaths.map((e) => ({ type: 'death', e })),
    ...pickups.map((e) => ({ type: 'pickup', e })),
    ...deposits.map((e) => ({ type: 'deposit', e })),
  ];
  return tagged.sort((a, b) => a.e.time - b.e.time || EVENT_ORDER[a.type] - EVENT_ORDER[b.type]);
}

function applyEvent(state, { type, e }) {
  if (type === 'death') registerDeath(state, e.player, e.time);
  else if (type === 'pickup') applyPickup(state, e);
  else applyDeposit(state, e);
}

function applyPickup(state, pickup) {
  if (pickup.from) lootCorpse(state, pickup);
  state.lastActive.set(pickup.looter, pickup.time);
  if (!isTrash(pickup.itemId)) createUnits(state, pickup);
}

function registerDeath(state, player, time, key) {
  const deathAt = state.deathAt.get(player);
  const isActiveSince = (state.lastActive.get(player) ?? -Infinity) > deathAt;
  if (deathAt !== undefined && time - deathAt <= CORPSE_WINDOW_MS && !isActiveSince) return deathAt;
  if (deathAt !== undefined && isActiveSince && isOldBag(state, player, deathAt, key)) return deathAt;
  state.deathAt.set(player, time);
  for (const unit of heldBy(state, player)) {
    setStatus(unit, 'dropped', player, time);
    unit.droppedAt = time;
  }
  return time;
}

function isOldBag(state, player, deathAt, key) {
  if (key === undefined) return false;
  const isLeftInBag = state.units.some((u) => u.status === 'dropped' && u.holder === player
    && u.droppedAt === deathAt && u.key === key);
  return isLeftInBag && !heldBy(state, player).some((u) => u.key === key);
}

function lootCorpse(state, pickup) {
  const deathAt = registerDeath(state, pickup.from, pickup.time, pickup.key);
  const takenStatus = state.isFriendly(pickup.looter) ? 'recovered' : 'lost';
  const dropped = state.units.filter((u) => u.status === 'dropped' && u.holder === pickup.from
    && u.key === pickup.key && u.droppedAt === deathAt);
  const fromCorpse = take(dropped, pickup.qty);
  fromCorpse.forEach((u) => setStatus(u, takenStatus, pickup.looter, pickup.time));
}

function createUnits(state, pickup) {
  for (let n = 0; n < pickup.qty; n++) {
    state.units.push({
      id: `${pickup.id}:${n}`, eventId: pickup.id, key: pickup.key, itemId: pickup.itemId,
      itemName: pickup.itemName, enchant: pickup.enchant, value: pickup.unitValue,
      pickedBy: pickup.looter, from: pickup.from, time: pickup.time,
      holder: pickup.looter, status: 'held', statusBy: '', statusAt: 0, transferredFrom: [],
    });
  }
}

function applyDeposit(state, row) {
  const held = heldBy(state, row.player).filter((u) => u.key === row.key).reverse();
  const settled = take(held, row.amount);
  settled.forEach((u) => setStatus(u, 'deposited', row.player, row.time));
  state.excess.push({
    id: row.id, player: row.player, key: row.key, itemName: row.itemName,
    enchant: row.enchant, time: row.time, qty: row.amount - settled.length,
  });
}

function applyAction(state, action) {
  const movable = action.type === 'transfer' ? ['held', 'dropped'] : ['held'];
  const gap = (u) => Math.abs(u.time - action.pickup?.time);
  const candidates = state.units.filter((u) => movable.includes(u.status) && u.holder === action.holder
    && isSamePickup(u, action.pickup)).sort((a, b) => gap(a) - gap(b));
  const chosen = take(candidates, action.qty ?? candidates.length);
  if (action.type === 'transfer') transfer(state, chosen, action.to);
  if (action.type === 'resolve') {
    chosen.forEach((u) => { setStatus(u, 'resolved', '', 0); u.note = action.note ?? ''; });
  }
  return chosen.length;
}

function transfer(state, units, to) {
  for (const unit of units) {
    if (unit.status === 'dropped') unit.takenFromBody = true;
    unit.transferredFrom.push(unit.holder);
    unit.holder = to;
    setStatus(unit, 'held', '', 0);
    const excess = state.excess.find((e) => e.player === to && e.key === unit.key && e.qty > 0);
    if (!excess) continue;
    excess.qty -= 1;
    setStatus(unit, 'deposited', to, excess.time);
  }
}

function heldBy(state, player) {
  return state.units.filter((u) => u.status === 'held' && u.holder === player);
}

function take(list, count) {
  return list.slice(0, Math.max(0, count));
}

function setStatus(unit, status, by, at) {
  unit.status = status;
  unit.statusBy = by;
  unit.statusAt = at;
}
