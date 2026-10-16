import { itemLabel } from './items.js';

export const STATUS_LABELS = {
  held: 'Outstanding',
  deposited: 'Deposited',
  dropped: 'Dropped on death (not seen picked up)',
  lost: 'Taken by enemy after death',
  recovered: 'Picked up by guildmate after death',
  resolved: 'Marked resolved',
};

const LOST = new Set(['dropped', 'lost']);

export function summarizePlayers(units, excess, affiliations) {
  const players = new Map();
  const row = (name) => {
    if (!players.has(name)) players.set(name, emptyRow(name, affiliations.get(name)));
    return players.get(name);
  };
  for (const unit of units) {
    if (unit.status !== 'recovered') add(row(unit.pickedBy).pickedUp, unit.value);
    if (unit.status === 'held') add(row(unit.holder).outstanding, unit.value);
    if (unit.status === 'deposited') add(row(unit.statusBy).deposited, unit.value);
    if (LOST.has(unit.status)) add(row(unit.holder).lost, unit.value);
  }
  for (const e of excess) row(e.player).extra.qty += e.qty;
  return [...players.values()].sort((a, b) => b.outstanding.value - a.outstanding.value
    || b.outstanding.qty - a.outstanding.qty || a.name.localeCompare(b.name));
}

function emptyRow(name, affiliation) {
  const counter = () => ({ qty: 0, value: 0 });
  return {
    name, guild: affiliation?.guild ?? '', alliance: affiliation?.alliance ?? '',
    pickedUp: counter(), deposited: counter(), outstanding: counter(),
    lost: counter(), extra: counter(),
  };
}

function add(counter, value) {
  counter.qty += 1;
  counter.value += value;
}

export function totals(players) {
  const sum = (field) => players.reduce((acc, p) => ({
    qty: acc.qty + p[field].qty, value: acc.value + p[field].value,
  }), { qty: 0, value: 0 });
  return {
    pickedUp: sum('pickedUp'), deposited: sum('deposited'), outstanding: sum('outstanding'),
    lost: sum('lost'), extra: sum('extra'),
  };
}

export function playerItems(units, excess, player) {
  const groups = new Map();
  for (const unit of units.filter((u) => u.holder === player || u.pickedBy === player)) {
    const { outcome, detail } = outcomeFor(unit, player);
    const id = `${unit.key}|${outcome}|${detail}|${unit.takenFromBody ? 'body' : ''}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id, key: unit.key, label: itemLabel(unit.itemName, unit.enchant), outcome, detail,
        qty: 0, value: 0, units: [],
      });
    }
    const group = groups.get(id);
    group.qty += 1;
    group.value += unit.value;
    group.units.push(unit);
  }
  const extras = excess.filter((e) => e.player === player).map((e) => ({
    id: `extra|${e.id}`, key: e.key, itemName: e.itemName, enchant: e.enchant, label: itemLabel(e.itemName, e.enchant), outcome: 'extra', detail: '', qty: e.qty, value: 0, units: [],
  }));
  return [...groups.values(), ...extras];
}

function outcomeFor(unit, player) {
  if (unit.holder === player) return { outcome: unit.status, detail: unit.statusBy };
  if (unit.status === 'deposited') return { outcome: 'deposited-by-other', detail: unit.statusBy };
  return { outcome: 'transferred', detail: unit.holder };
}

export function formatSilver(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}m`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(Math.round(value));
}
