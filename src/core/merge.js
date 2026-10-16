// Duplicates are only collapsed across files, never within one: three identical
// pickups in the same second are three items.

const MATCH_WINDOW_MS = 3000;
const OFFSET_SEARCH_MS = 120000;
const DEATH_WINDOW_MS = 10000;

export function mergeLootLogs(logs) {
  const pickups = [];
  const deaths = [];
  const report = [];
  for (const log of logs) {
    const offsetMs = estimateClockOffset(pickups, log.pickups);
    const shifted = log.pickups.map((p) => ({ ...p, time: p.time - offsetMs }));
    const fresh = withoutTwins(pickups, shifted);
    pickups.push(...fresh);
    deaths.push(...newDeaths(deaths, log.deaths.map((d) => ({ ...d, time: d.time - offsetMs }))));
    report.push({ fileName: log.fileName, pickups: log.pickups.length, duplicates: shifted.length - fresh.length, offsetMs });
  }
  pickups.sort((a, b) => a.time - b.time);
  deaths.sort((a, b) => a.time - b.time);
  return { pickups, deaths, report };
}

function signature(p) {
  return `${p.looter}|${p.key}|${p.qty}|${p.from}`;
}

function groupBySignature(pickups) {
  const groups = new Map();
  for (const p of pickups) {
    const sig = signature(p);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(p);
  }
  return groups;
}

// median gap between matching events = clock skew between loggers
function estimateClockOffset(base, incoming) {
  if (base.length === 0) return 0;
  const groups = groupBySignature(base);
  const gaps = [];
  for (const p of incoming) {
    for (const b of groups.get(signature(p)) ?? []) {
      if (Math.abs(p.time - b.time) <= OFFSET_SEARCH_MS) gaps.push(p.time - b.time);
    }
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function withoutTwins(base, incoming) {
  const groups = groupBySignature(base);
  const used = new Set();
  return incoming.filter((p) => {
    const twin = closestUnused(groups.get(signature(p)) ?? [], p.time, used);
    if (twin) used.add(twin);
    return !twin;
  });
}

function closestUnused(candidates, time, used) {
  let best = null;
  for (const c of candidates) {
    const gap = Math.abs(c.time - time);
    if (used.has(c) || gap > MATCH_WINDOW_MS) continue;
    if (!best || gap < Math.abs(best.time - time)) best = c;
  }
  return best;
}

function newDeaths(existing, incoming) {
  return incoming.filter((d) => !existing.some(
    (e) => e.player === d.player && Math.abs(e.time - d.time) <= DEATH_WINDOW_MS,
  ));
}

export function buildAffiliations(pickups, deaths) {
  const affiliations = new Map();
  const note = (name, guild, alliance) => {
    if (!name) return;
    const known = affiliations.get(name) ?? { guild: '', alliance: '' };
    affiliations.set(name, { guild: guild || known.guild, alliance: alliance || known.alliance });
  };
  for (const p of pickups) {
    note(p.looter, p.looterGuild, p.looterAlliance);
    note(p.from, p.fromGuild, p.fromAlliance);
  }
  for (const d of deaths) note(d.player, d.guild, d.alliance);
  return affiliations;
}
