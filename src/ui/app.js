import { analyze, emptySession } from '../core/analyze.js';
import { useItemList } from '../core/items.js';
import { priceOf } from '../core/priceBook.js';
import { loadPrices } from './prices.js';
import { marketPriceOf, priceFromMarket } from './marketPrices.js';
import { countByPickup, unitRef } from '../core/reconcile.js';
import { playerItems } from '../core/summary.js';
import { renderControls } from './renderControls.js';
import { renderResults } from './renderResults.js';
import { setupLiveLogging } from './liveLogging.js';
import { copyCard } from './copy.js';
import './tooltip.js';

const STORAGE_KEY = 'loot-ledger-session';
let session = loadStoredSession();
const prices = loadPrices();
const valueOf = (itemId) => priceOf(prices, itemId) || marketPriceOf(itemId);
let result = null;
const view = { selected: '', notice: '', live: null, filters: { status: new Set(), tier: new Set(), type: new Set() } };

function update(change, notice = '') {
  change();
  view.notice = notice;
  storeSession();
  runAnalysis();
  draw();
}

function runAnalysis() {
  result = analyze(session, valueOf);
  priceFromMarket(result.merged.pickups.filter((p) => !p.unitValue)).then((isUpdated) => isUpdated && update(() => {}, view.notice),
    (error) => { view.notice = `Market prices not loaded (${error.message}).`; draw(); });
}

function draw() {
  renderControls(session, result, view);
  renderResults(result, session, view);
  document.querySelectorAll('[data-partial="true"]').forEach((box) => { box.indeterminate = true; });
}

function storeSession() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (error) {
    view.notice = `Could not autosave this fight (${error.message}). Use Save fight to keep it.`;
  }
}

function loadStoredSession() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? toSession(JSON.parse(stored)) : emptySession();
  } catch {
    return emptySession();
  }
}

function toSession(data) {
  if (!data || !Array.isArray(data.lootFiles) || !Array.isArray(data.chestPastes)) {
    throw new Error('This file is not a saved fight.');
  }
  return { ...emptySession(), ...data };
}

async function addChestFiles(files) {
  const texts = await Promise.all(files.map((file) => file.text()));
  update(() => session.chestPastes.push(...texts), `Added ${files.length} chest log file(s).`);
}

async function addLootFiles(files) {
  const added = [];
  const skipped = [];
  for (const file of files) {
    const text = await file.text();
    if (session.lootFiles.some((f) => f.text === text)) skipped.push(file.name);
    else added.push({ name: file.name, text });
  }
  const notice = skipped.length ? `Already added: ${skipped.join(', ')}` : '';
  update(() => session.lootFiles.push(...added), notice);
}

function findGroup(player, groupId) {
  return playerItems(result.units, result.excess, player).find((g) => g.id === groupId);
}

function heldActionsFor(player, groupId, action) {
  const held = findGroup(player, groupId)?.units.filter((u) => u.status === 'held') ?? [];
  const batch = `manual-${Date.now()}`;
  return countByPickup(held).map(({ unit, qty }) => ({ ...action, ...unitRef(unit), qty, batch }));
}

function toggleGuilds(guilds, isOn) {
  const tracked = new Set(result.shownGuilds);
  guilds.forEach((g) => (isOn ? tracked.add(g) : tracked.delete(g)));
  update(() => { session.trackedGuilds = [...tracked]; });
}

function knownPlayer(typed) {
  const names = [...result.affiliations.keys(), ...result.chest.deposits.map((row) => row.player)];
  return names.find((name) => name.toLowerCase() === typed.toLowerCase());
}

function toggleOurPlayer(player, isOurs) {
  update(() => {
    session.ourPlayers = session.ourPlayers.filter((name) => name !== player);
    if (isOurs) session.ourPlayers.push(player);
  });
}

const clickActions = {
  'remove-loot': (el) => update(() => session.lootFiles.splice(Number(el.dataset.index), 1)),
  'remove-chest': (el) => update(() => session.chestPastes.splice(Number(el.dataset.index), 1)),
  'reset-window': () => update(() => { session.windowStart = null; }),
  'open-npcap': () => window.ledger.openNpcapDownload(),
  'select-item': (el) => {
    view.selected = view.selected === el.dataset.key ? '' : el.dataset.key;
    draw();
  },
  'died-holding': (el) => {
    const { player } = el.dataset;
    const first = findGroup(player, el.dataset.group).units.reduce((a, b) => (b.time < a.time ? b : a));
    view.selected = '';
    update(() => session.actions.push({ type: 'death', player, after: unitRef(first).pickup, batch: `manual-${Date.now()}` }),
      `${player} marked as died after looting at ${new Date(first.time).toISOString().slice(11, 16)}.`);
  },
  'reject-match': (el) => {
    view.selected = '';
    const isDeath = el.dataset.pair.startsWith('death:');
    update(() => session.dismissed.push(el.dataset.pair), isDeath ? 'Death removed.' : 'Match removed.');
  },
  'restore-match': (el) => update(() => {
    session.dismissed = session.dismissed.filter((pair) => pair !== el.dataset.pair);
  }),
  reassign: (el) => {
    const input = document.querySelector('[data-reassign-input]');
    const typed = input?.value.trim();
    if (!typed) { input?.focus(); return; }
    const to = knownPlayer(typed);
    if (!to) { view.notice = `No player called ${typed} in these logs.`; draw(); return; }
    const actions = heldActionsFor(el.dataset.player, el.dataset.group, { type: 'transfer', to });
    view.selected = '';
    update(() => session.actions.push(...actions), `Reassigned to ${to}.`);
  },
  resolve: (el) => {
    const actions = heldActionsFor(el.dataset.player, el.dataset.group, { type: 'resolve' });
    view.selected = '';
    update(() => session.actions.push(...actions), 'Marked resolved.');
  },
  undo: (el) => update(() => {
    session.actions = session.actions.filter((action) => action.batch !== el.dataset.batch);
  }),
  'copy-card': async (el) => {
    view.notice = await copyCard(el.dataset.player, result, view);
    draw();
  },
};

document.addEventListener('click', (event) => {
  closeDropdowns(event.target);
  if (event.target.closest('input, label')) return;
  const el = event.target.closest('[data-action]');
  if (el && clickActions[el.dataset.action]) clickActions[el.dataset.action](el);
});

document.addEventListener('error', (event) => {
  if (event.target.tagName === 'IMG') event.target.closest('.tile')?.classList.add('no-icon');
}, true);

document.getElementById('guild-filter').addEventListener('change', (event) => {
  const box = event.target;
  if (box.dataset.guild) toggleGuilds([box.dataset.guild], box.checked);
  if (box.dataset.alliance) toggleGuilds([...result.guildOptions.get(box.dataset.alliance).keys()], box.checked);
  if (box.dataset.player) toggleOurPlayer(box.dataset.player, box.checked);
});

document.getElementById('loot-files').addEventListener('change', (event) => {
  addLootFiles([...event.target.files]);
  event.target.value = '';
});

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  addLootFiles([...event.dataTransfer.files]);
});

document.getElementById('chest-files').addEventListener('change', (event) => {
  addChestFiles([...event.target.files]);
  event.target.value = '';
});

function closeDropdowns(clicked) {
  document.querySelectorAll('details.dropdown[open]').forEach((dropdown) => {
    if (!dropdown.contains(clicked)) dropdown.open = false;
  });
}

document.querySelectorAll('[data-filter]').forEach((dropdown) => {
  dropdown.addEventListener('change', (event) => {
    const chosen = view.filters[dropdown.dataset.filter];
    const { filterValue } = event.target.dataset;
    if (event.target.checked) chosen.add(filterValue);
    else chosen.delete(filterValue);
    draw();
  });
});

document.getElementById('clear-chest').addEventListener('click', () => {
  if (!confirm('Delete all chest logs from this fight?')) return;
  update(() => { session.chestPastes = []; });
});

document.getElementById('add-chest').addEventListener('click', () => {
  const box = document.getElementById('chest-text');
  if (!box.value.trim()) { box.focus(); return; }
  const text = box.value;
  box.value = '';
  update(() => session.chestPastes.push(text));
});

document.getElementById('window-start').addEventListener('change', (event) => {
  const time = Date.parse(`${event.target.value}Z`);
  if (!Number.isNaN(time)) update(() => { session.windowStart = time; });
});

document.getElementById('new-session').addEventListener('click', () => {
  if (!confirm('Delete all logs and start a new fight? Save this one first if you want to keep it.')) return;
  live?.stopForNewFight();
  view.selected = '';
  update(() => { session = emptySession(); });
});

document.getElementById('save-session').addEventListener('click', () => {
  const day = result.firstPickup ? new Date(result.firstPickup).toISOString().slice(0, 10) : 'fight';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(session)], { type: 'application/json' }));
  link.download = `loot-ledger-${day}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById('open-session').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const loaded = toSession(JSON.parse(await file.text()));
    live?.stopForNewFight();
    view.selected = '';
    update(() => { session = loaded; }, `Opened ${file.name}.`);
  } catch (error) {
    view.notice = `Could not open ${file.name}: ${error.message}`;
    draw();
  }
});

const itemListReady = window.ledger?.itemList
  ? window.ledger.itemList().then(({ items, error }) => {
    if (items) update(() => useItemList(items), view.notice);
    return error ?? '';
  }, (error) => `Item list not updated (${error.message}).`)
  : Promise.resolve('');

const live = setupLiveLogging({
  itemListReady,
  prices,
  getSession: () => session,
  applyChange: (change) => update(change, view.notice),
  showStatus: (status) => { view.live = { ...status }; draw(); },
});
if (live) {
  const toggle = document.getElementById('toggle-logging');
  toggle.hidden = false;
  toggle.addEventListener('click', () => (live.isRunning ? live.stop() : live.start()));
}

runAnalysis();
draw();
