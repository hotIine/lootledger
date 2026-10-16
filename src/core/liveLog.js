// Converts capture events into StatisticsAnalysis-format loot rows.
import { itemAtIndex } from './items.js';
import { notePrice, priceOf } from './priceBook.js';
import mapNames from './mapNames.js';

export const LOOT_LOG_HEADER = 'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;'
  + 'looted_from__alliance;looted_from__guild;looted_from__name;died;died_player_guild;killed_by;killed_by_guild;'
  + 'average_est_market_value;cluster;died_player_alliance;killed_by_alliance';

export function createLiveLog(startedAt, prices = {}) {
  const stamp = new Date(startedAt).toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
  return { fileName: `live-${stamp}.csv`, players: new Map(), self: null, map: '', pickups: 0, deaths: 0, prices };
}

export function applyCaptureEvent(log, event) {
  switch (event.type) {
    case 'self':
      log.self = { name: event.name, guild: event.guild, alliance: event.alliance };
      log.map = mapNames[event.map] ?? event.map ?? '';
      notePlayer(log, event);
      return null;
    case 'player':
      notePlayer(log, event);
      return null;
    case 'loot':
      log.pickups += 1;
      return lootRow(log, event);
    case 'death':
      log.deaths += 1;
      return deathRow(log, event);
    case 'value':
      notePrice(log.prices, itemAtIndex(event.item).id, event.quality, event.value, Date.parse(event.time));
      return null;
    default:
      return null;
  }
}

function notePlayer(log, { name, guild, alliance }) {
  if (name) log.players.set(name, { guild: guild ?? '', alliance: alliance ?? '' });
}

function lootRow(log, event) {
  const item = itemAtIndex(event.item);
  const looter = log.players.get(event.looter) ?? {};
  const from = log.players.get(event.from) ?? {};
  return row([event.time, looter.alliance, looter.guild, event.looter, item.id, item.name, event.qty,
    from.alliance, from.guild, event.from, '', '', '', '', priceOf(log.prices, item.id), log.map, '', '']);
}

function deathRow(log, event) {
  const died = log.players.get(event.died) ?? {};
  const killer = log.players.get(event.killer) ?? {};
  return row([event.time, '', '', '', '', '', '', '', '', '', event.died, event.diedGuild || died.guild,
    event.killer, event.killerGuild || killer.guild, '', log.map, died.alliance, killer.alliance]);
}

// semicolons would break the csv
function row(values) {
  return values.map((value) => String(value ?? '').replace(/;/g, ',')).join(';');
}
