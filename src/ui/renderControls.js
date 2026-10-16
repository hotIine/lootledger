import { esc, formatDateTime, formatSilver, plural } from './format.js';

const FILTERS = {
  status: { label: 'Status', options: [['owed', 'Still owes'], ['chest', 'In the chest'], ['died', 'Died with'],
    ['extra', 'Not in loot logs'], ['moved', 'Reassigned']] },
  tier: { label: 'Tier', options: [3, 4, 5, 6, 7, 8].map((t) => [String(t), `T${t}`]) },
  type: { label: 'Type', options: [['weapon', 'Weapons'], ['armor', 'Armor'], ['cape', 'Capes'], ['bag', 'Bags'],
    ['mount', 'Mounts'], ['consumable', 'Food and potions'], ['other', 'Other']] },
};

export function renderControls(session, result, view) {
  renderFilterMenus(view.filters);
  renderLogging(view.live);
  document.getElementById('fight-info').innerHTML = loggingInfo(view.live) + fightInfo(session, result);
  document.getElementById('log-counts').innerHTML = logCounts(session, result);
  document.getElementById('file-list').innerHTML = fileList(session, result);
  document.getElementById('guild-filter').innerHTML = guildFilter(session, result);
  document.getElementById('guild-summary').textContent =
    session.trackedGuilds === null ? 'Guild: our side' : `Guild: ${result.shownGuilds.size} selected`;
  renderWindow(session, result);
}

function renderLogging(live) {
  const toggle = document.getElementById('toggle-logging');
  const isRunning = Boolean(live?.isRunning);
  toggle.textContent = live?.isStarting ? 'Starting...' : isRunning ? 'Stop logging' : 'Start logging';
  toggle.className = `${isRunning ? 'red' : 'green'} wide`;
  toggle.disabled = Boolean(live?.isStarting);
  if (live?.needsNpcap && !isRunning) {
    document.getElementById('logging-status').innerHTML = npcapSetup();
    return;
  }
  const parts = [];
  if (isRunning) parts.push(`Logging: ${plural(live.pickups, 'pickup')}, ${plural(live.deaths, 'death')}`);
  if (isRunning && !live.self) parts.push('Change zone once so Loot Ledger knows who you are.');
  if (live?.savedTo) parts.push(`Saved to ${live.savedTo}`);
  if (live?.error) parts.push(`<span class="error-text">${esc(live.error)}</span>`);
  if (isRunning && live.itemWarning) parts.push(`<span class="error-text">${esc(live.itemWarning)}</span>`);
  if (isRunning && live.captureWarning) parts.push(`<span class="error-text">${esc(live.captureWarning)}</span>`);
  document.getElementById('logging-status').innerHTML = parts.map((p) => (p.startsWith('<') ? p : esc(p))).join('<br>');
}

function npcapSetup() {
  return `<div class="setup"><strong>One-time setup: install Npcap</strong>
    <ol><li>Download and install Npcap (free). The default options are fine.</li>
      <li>Restart Loot Ledger.</li>
      <li>Press Start logging with Albion running, then change zone once.</li></ol>
    <button type="button" class="blue" data-action="open-npcap">Open the Npcap download page</button></div>`;
}

function loggingInfo(live) {
  if (!live?.isRunning) return '';
  const who = live.self ? `${live.self.name} (${[live.self.guild, live.self.alliance].filter(Boolean).join(', ')})` : 'waiting for you to zone';
  return `<span class="live-dot"></span>LOGGING: <strong>${esc(who)}</strong>${live.map ? ` &nbsp;|&nbsp; NOW IN: <strong>${esc(live.map)}</strong>` : ''}<br>`;
}

function renderFilterMenus(filters) {
  for (const [name, { label, options }] of Object.entries(FILTERS)) {
    const dropdown = document.querySelector(`[data-filter="${name}"]`);
    const chosen = filters[name];
    const names = options.filter(([value]) => chosen.has(value)).map(([, text]) => text);
    const summary = names.length === 0 ? 'All' : names.length <= 2 ? names.join(', ') : `${names.length} selected`;
    dropdown.querySelector('summary').textContent = `${label}: ${summary}`;
    dropdown.querySelector('.menu').innerHTML = options.map(([value, text]) => `<label>
      <input type="checkbox" data-filter-value="${esc(value)}" ${chosen.has(value) ? 'checked' : ''}><span>${esc(text)}</span></label>`).join('');
  }
}

function logCounts(session, result) {
  const counts = `${plural(session.chestPastes.length, 'chest log')} | ${plural(session.lootFiles.length, 'loot log file')}`;
  const times = [...result.chest.deposits, ...result.chest.excluded.map((e) => e.row)].map((row) => row.time);
  if (times.length === 0) return esc(counts);
  return `${esc(counts)}<br>Chest log up to <strong>${esc(formatDateTime(Math.max(...times)))}</strong>`;
}

function fightInfo(session, result) {
  if (!result.firstPickup) return 'Press Start logging, or add loot log files.';
  const maps = [...new Set(result.merged.pickups.map((p) => p.cluster).filter(Boolean))];
  const part = (label, value) => `${label}: <strong>${esc(value)}</strong>`;
  const { pickedUp, deposited, outstanding } = result.totals;
  const silver = pickedUp.value ? [part('LOOTED', formatSilver(pickedUp.value)), part('DEPOSITED', formatSilver(deposited.value)),
    part('OWED', formatSilver(outstanding.value))] : [];
  return [part('FIGHT', formatDateTime(result.firstPickup)), part('MAP', maps.join(', ') || 'unknown'),
    part('LOGGERS', session.lootFiles.length), part('PICKUPS', result.merged.pickups.length), ...silver].join(' &nbsp;|&nbsp; ');
}

function fileList(session, result) {
  const loot = session.lootFiles.map((file, index) => {
    const report = result.merged.report.find((r) => r.fileName === file.name);
    const detail = report ? `${report.pickups} pickups${report.duplicates ? `, ${report.duplicates} overlap` : ''}` : 'could not be read';
    return fileItem(file.name, detail, 'remove-loot', index);
  });
  const chest = session.chestPastes.map((_, index) => {
    const prefix = `paste${index}#`;
    const counted = result.chest.deposits.filter((row) => row.id.startsWith(prefix)).length;
    return fileItem(`Chest log ${index + 1}`, `${counted} deposits`, 'remove-chest', index);
  });
  return [...loot, ...chest].join('');
}

function fileItem(name, detail, action, index) {
  return `<li><span>${esc(name)}</span><small>${esc(detail)}</small>
    <button type="button" class="x" data-action="${action}" data-index="${index}" title="Remove ${esc(name)}" aria-label="Remove ${esc(name)}">&times;</button></li>`;
}

function guildFilter(session, result) {
  if (result.guildOptions.size === 0 && result.untagged.size === 0) return '<p class="counts">No loot logs yet.</p>';
  const alliances = [...result.guildOptions].sort((a, b) => total(b[1]) - total(a[1]));
  return alliances.map(([alliance, guilds]) => allianceGroup(alliance, guilds, result.shownGuilds)).join('')
    + untaggedGroup(result.untagged, new Set(session.ourPlayers));
}

function untaggedGroup(untagged, ours) {
  if (untagged.size === 0) return '';
  const rows = [...untagged].sort((a, b) => b[1] - a[1]).map(([player, count]) => `
    <label class="guild"><input type="checkbox" data-player="${esc(player)}" ${ours.has(player) ? 'checked' : ''}>
      <span>${esc(player)}</span><small>${count}</small></label>`).join('');
  return `<div class="alliance"><strong class="group-title">No guild</strong>${rows}</div>`;
}

function allianceGroup(alliance, guilds, shown) {
  const names = [...guilds.keys()];
  const checkedCount = names.filter((g) => shown.has(g)).length;
  const state = checkedCount === names.length ? 'checked' : '';
  const partial = checkedCount > 0 && checkedCount < names.length ? 'data-partial="true"' : '';
  const guildRows = [...guilds].sort((a, b) => b[1] - a[1]).map(([guild, count]) => `
    <label class="guild"><input type="checkbox" data-guild="${esc(guild)}" ${shown.has(guild) ? 'checked' : ''}>
      <span>${esc(guild)}</span><small>${count}</small></label>`).join('');
  return `<div class="alliance">
    <label><input type="checkbox" data-alliance="${esc(alliance)}" ${state} ${partial}>
      <strong>${esc(alliance)}</strong><small>${total(guilds)}</small></label>${guildRows}</div>`;
}

function total(guilds) {
  return [...guilds.values()].reduce((a, b) => a + b, 0);
}

function renderWindow(session, result) {
  const input = document.getElementById('window-start');
  const hint = document.getElementById('window-hint');
  if (!result.firstPickup) {
    input.value = '';
    hint.textContent = '';
    return;
  }
  if (document.activeElement !== input) input.value = new Date(result.windowStart).toISOString().slice(0, 19);
  hint.innerHTML = session.windowStart === null
    ? 'Set to the first pickup, so older chest rows are skipped.'
    : '<button type="button" class="link" data-action="reset-window">Reset to first pickup</button>';
}
