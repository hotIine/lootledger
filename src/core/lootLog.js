import { enchantFromItemId, itemKey } from './items.js';

const REQUIRED_COLUMNS = ['timestamp_utc', 'looted_by__name', 'item_id', 'item_name', 'quantity', 'looted_from__name'];

export function parseLootLog(text, fileName) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new Error(`${fileName}: the file is empty`);
  const columns = lines[0].split(';').map((column) => column.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw new Error(`${fileName}: not a loot log export (missing columns: ${missing.join(', ')})`);
  }
  const result = { fileName, pickups: [], deaths: [], errors: [] };
  lines.slice(1).forEach((line, index) => {
    const lineNumber = index + 2;
    const row = toRecord(columns, line.split(';'));
    const event = toEvent(row, `${fileName}#${lineNumber}`);
    if (event?.kind === 'pickup') result.pickups.push(event);
    else if (event?.kind === 'death') result.deaths.push(event);
    else result.errors.push(`${fileName} line ${lineNumber}: could not read row`);
  });
  return result;
}

function toRecord(columns, values) {
  const record = {};
  columns.forEach((column, i) => { record[column] = (values[i] ?? '').trim(); });
  return record;
}

function toEvent(row, id) {
  const time = parseUtc(row.timestamp_utc);
  if (Number.isNaN(time)) return null;
  if (row.looted_by__name && row.item_id) return toPickup(row, id, time);
  if (row.died) return toDeath(row, id, time);
  return null;
}

function toPickup(row, id, time) {
  const qty = Number(row.quantity);
  if (!Number.isInteger(qty) || qty <= 0) return null;
  const enchant = enchantFromItemId(row.item_id);
  return {
    kind: 'pickup', id, time, qty, enchant,
    itemId: row.item_id,
    itemName: row.item_name || row.item_id,
    key: itemKey(row.item_name || row.item_id, enchant),
    looter: row.looted_by__name,
    looterGuild: row.looted_by__guild ?? '',
    looterAlliance: row.looted_by__alliance ?? '',
    from: row.looted_from__name,
    fromGuild: row.looted_from__guild ?? '',
    fromAlliance: row.looted_from__alliance ?? '',
    unitValue: Number(row.average_est_market_value) || 0,
    cluster: row.cluster ?? '',
  };
}

function toDeath(row, id, time) {
  return {
    kind: 'death', id, time,
    player: row.died,
    guild: row.died_player_guild ?? '',
    alliance: row.died_player_alliance ?? '',
    killer: row.killed_by ?? '',
  };
}

function parseUtc(value) {
  return Date.parse((value ?? '').replace(/(\.\d{3})\d+/, '$1'));
}
