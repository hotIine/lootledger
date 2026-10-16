import { parseLootLog } from './lootLog.js';
import { parseChestLog, selectDeposits } from './chestLog.js';
import { mergeLootLogs, buildAffiliations } from './merge.js';
import { deathTimeAfter, findPickup, reconcile } from './reconcile.js';
import { suggestTransfers, suggestionToActions } from './suggest.js';
import { summarizePlayers, totals } from './summary.js';
import { buildItemIdLookup } from './items.js';
import { inferDeaths } from './inferDeaths.js';

export function emptySession() {
  return { lootFiles: [], chestPastes: [], trackedGuilds: null, windowStart: null, actions: [], dismissed: [], loggedBy: null, ourPlayers: [] };
}

export function analyze(session, priceOf = () => 0) {
  const errors = [];
  const logs = session.lootFiles.map((file) => parseFileSafely(file, errors)).filter(Boolean);
  logs.forEach((log) => errors.push(...log.errors));
  const merged = mergeLootLogs(logs);
  merged.pickups.forEach((p) => { if (!p.unitValue) p.unitValue = priceOf(p.itemId); });
  const affiliations = buildAffiliations(merged.pickups, merged.deaths);
  const firstPickup = merged.pickups[0]?.time ?? 0;
  const windowStart = session.windowStart ?? firstPickup;
  const parsedPastes = session.chestPastes.map((text, i) => parseChestLog(text, i));
  parsedPastes.forEach((paste) => errors.push(...paste.errors));
  const chest = selectDeposits(parsedPastes, windowStart);
  const sideOf = (name) => { const a = affiliations.get(name); return a?.alliance || a?.guild || ''; };
  const ourSides = new Set(chest.deposits.map((row) => sideOf(row.player)).filter(Boolean));
  const logger = session.loggedBy;
  if (ourSides.size === 0 && logger) ourSides.add(logger.alliance || logger.guild);
  ourSides.delete('');
  const shownGuilds = new Set(session.trackedGuilds ?? guildsOnSides(affiliations, ourSides));
  if (ourSides.size === 0) shownGuilds.forEach((guild) => ourSides.add(sideOfGuild(affiliations, guild)));
  const depositors = new Set(chest.deposits.map((row) => row.player));
  const ourPlayers = new Set(session.ourPlayers);
  const isFriendly = (name) => depositors.has(name) || ourPlayers.has(name) || ourSides.has(sideOf(name));
  const actions = upgradeActions(session.actions, merged.pickups);
  const manualDeaths = actions.filter((a) => a.type === 'death' && a.time !== null)
    .map((a) => ({ kind: 'death', id: `manual:${a.batch}`, time: a.time, player: a.player }));
  const knownDeaths = [...merged.deaths, ...manualDeaths];
  const rejected = new Set(session.dismissed);
  const input = { pickups: merged.pickups, deposits: chest.deposits, isFriendly, rejected,
    actions: actions.filter((a) => a.type !== 'death') };
  const firstTry = settle(input, knownDeaths);
  const inferredDeaths = inferDeaths(firstTry.units.filter((u) => isFriendly(u.pickedBy)), merged.pickups, knownDeaths, rejected);
  const result = inferredDeaths.length ? settle(input, [...knownDeaths, ...inferredDeaths]) : firstTry;
  const players = summarizePlayers(result.units, result.excess, affiliations)
    .filter((p) => shownGuilds.has(p.guild) || ourPlayers.has(p.name) || (!p.guild && (p.deposited.qty > 0 || p.extra.qty > 0)));
  return {
    errors, merged, affiliations, windowStart, firstPickup, chest, shownGuilds,
    units: result.units, excess: result.excess, players, totals: totals(players), actions,
    unapplied: new Set([...result.unapplied, ...actions.filter((a) => a.time === null).map((a) => a.batch)]),
    autoMatches: result.autoMatches, inferredDeaths,
    guildOptions: guildOptions(merged.pickups, affiliations),
    untagged: untaggedLooters(merged.pickups, affiliations, depositors),
    itemIdFor: buildItemIdLookup(merged.pickups),
  };
}

function settle({ pickups, deposits, isFriendly, rejected, actions }, deaths) {
  const reconcileWith = (all) => reconcile({ pickups, deaths, deposits, isFriendly, actions: all });
  const firstPass = reconcileWith(actions);
  const ourUnits = firstPass.units.filter((u) => isFriendly(u.holder));
  const autoMatches = suggestTransfers(ourUnits, firstPass.excess, rejected);
  return { autoMatches, ...reconcileWith([...actions, ...autoMatches.flatMap(suggestionToActions)]) };
}

function upgradeActions(actions, pickups) {
  const byId = new Map(pickups.map((p) => [p.id, p]));
  return actions.map((action) => {
    if (action.type === 'death') return placeDeath(action, pickups);
    const pickup = !action.pickup && byId.get(action.eventId);
    if (!pickup) return action;
    return { ...action, holder: pickup.looter, pickup: { looter: pickup.looter, key: pickup.key, from: pickup.from, time: pickup.time } };
  });
}

function placeDeath(action, pickups) {
  if (!action.after) return action;
  const pickup = findPickup(pickups, action.after);
  return { ...action, time: pickup ? deathTimeAfter(pickups, action.player, pickup.time) : null };
}

function parseFileSafely(file, errors) {
  try {
    return parseLootLog(file.text, file.name);
  } catch (error) {
    errors.push(error.message);
    return null;
  }
}

function guildsOnSides(affiliations, sides) {
  return [...affiliations.values()].filter((a) => sides.has(a.alliance || a.guild)).map((a) => a.guild).filter(Boolean);
}

function sideOfGuild(affiliations, guild) {
  const member = [...affiliations.values()].find((a) => a.guild === guild);
  return member?.alliance || guild;
}

function guildOptions(pickups, affiliations) {
  const alliances = new Map();
  for (const pickup of pickups) {
    const { guild, alliance } = affiliations.get(pickup.looter) ?? {};
    if (!guild) continue;
    const allianceName = alliance || '(no alliance)';
    if (!alliances.has(allianceName)) alliances.set(allianceName, new Map());
    const guilds = alliances.get(allianceName);
    guilds.set(guild, (guilds.get(guild) ?? 0) + 1);
  }
  return alliances;
}

function untaggedLooters(pickups, affiliations, depositors) {
  const counts = new Map();
  for (const { looter } of pickups) {
    if (affiliations.get(looter)?.guild || depositors.has(looter)) continue;
    counts.set(looter, (counts.get(looter) ?? 0) + 1);
  }
  return counts;
}
