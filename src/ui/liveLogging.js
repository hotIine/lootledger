import { createLiveLog, applyCaptureEvent, LOOT_LOG_HEADER } from '../core/liveLog.js';
import { savePrices } from './prices.js';

const MIN_REFRESH_MS = 2000;
// lots of traffic but nothing recognised usually means a patch changed the codes
const UNRECOGNISED_TRAFFIC = 1000;
const OUTDATED_CAPTURE = 'Albion may have been updated; live logging needs an update.';
const STATUS_EVENTS = new Set(['ready', 'error', 'stopped', 'self', 'traffic']);

export function setupLiveLogging({ itemListReady, prices, getSession, applyChange, showStatus }) {
  if (!window.ledger?.startCapture) return null;
  const status = {
    isRunning: false, isStarting: false, adapters: 0, self: null, map: '', pickups: 0, deaths: 0, error: '', savedTo: '',
    needsNpcap: false, itemWarning: '', captureWarning: '',
  };
  let log = null;
  let pending = [];
  let timer = null;
  let isFileStarted = false;
  let lastRefreshMs = 0;
  let isAddingToFight = true;

  function save(row) {
    const header = isFileStarted ? '' : `${LOOT_LOG_HEADER}\n`;
    isFileStarted = true;
    window.ledger.appendLog(log.fileName, `${header}${row}\n`)
      .then((savedTo) => { status.savedTo = savedTo; })
      .catch((error) => { status.error = `Could not save the live log: ${error.message}`; });
  }

  function scheduleRefresh() {
    if (!timer) timer = setTimeout(refresh, Math.max(MIN_REFRESH_MS, lastRefreshMs * 4));
  }

  function refresh() {
    clearTimeout(timer);
    timer = null;
    if (!log || pending.length === 0) return;
    if (!isAddingToFight) { pending = []; return; }
    const rows = pending;
    const fileName = log.fileName;
    pending = [];
    const started = performance.now();
    applyChange(() => {
      const session = getSession();
      const file = session.lootFiles.find((f) => f.name === fileName);
      if (file) file.text += `\n${rows.join('\n')}`;
      else session.lootFiles.push({ name: fileName, text: [LOOT_LOG_HEADER, ...rows].join('\n') });
    });
    lastRefreshMs = performance.now() - started;
    status.error ||= savePrices(prices);
    showStatus(status);
  }

  function onEvent(event) {
    if (event.type === 'ready') Object.assign(status, { isRunning: true, adapters: event.adapters, error: '' });
    if (event.type === 'error') status.error = friendlyError(event.message);
    if (event.type === 'stopped') status.isRunning = false;
    if (event.type === 'traffic') status.captureWarning = isUnrecognised(log, event.messages) ? OUTDATED_CAPTURE : '';
    const row = log ? applyCaptureEvent(log, event) : null;
    if (event.type === 'self' && log?.self && isAddingToFight) applyChange(() => { getSession().loggedBy = log.self; });
    if (log) Object.assign(status, { self: log.self, map: log.map, pickups: log.pickups, deaths: log.deaths });
    if (row) {
      save(row);
      pending.push(row);
      scheduleRefresh();
    }
    if (event.type === 'stopped') {
      refresh();
      status.error ||= savePrices(prices);
    }
    if (!row && STATUS_EVENTS.has(event.type)) showStatus(status);
  }

  window.ledger.onCaptureEvent(onEvent);
  return {
    get isRunning() { return status.isRunning; },
    async start() {
      if (status.isStarting || status.isRunning) return;
      status.isStarting = true;
      showStatus(status);
      const check = await window.ledger.checkCapture();
      status.needsNpcap = !check.isNpcapInstalled;
      // wait for the fresh item list before naming rows
      if (!status.needsNpcap) status.itemWarning = await itemListReady;
      status.isStarting = false;
      if (status.needsNpcap) {
        showStatus(status);
        return;
      }
      log = createLiveLog(Date.now(), prices);
      isFileStarted = false;
      isAddingToFight = true;
      Object.assign(status, { isRunning: true, pickups: 0, deaths: 0, error: '', savedTo: '', captureWarning: '' });
      showStatus(status);
      window.ledger.startCapture();
    },
    stop() {
      window.ledger.stopCapture();
    },
    stopForNewFight() {
      if (!status.isRunning) return;
      refresh();
      isAddingToFight = false;
      window.ledger.stopCapture();
    },
  };
}

function isUnrecognised(log, messages) {
  return Boolean(log) && messages >= UNRECOGNISED_TRAFFIC && !log.self && log.players.size === 0 && log.pickups === 0;
}

function friendlyError(message) {
  if (/list network adapters/i.test(message)) {
    return 'Npcap is not working. Reinstall Npcap (npcap.com), then try again.';
  }
  if (/open any network adapter/i.test(message)) {
    return 'Npcap could not read your network. Either run Loot Ledger as administrator, or reinstall Npcap '
      + 'with "Restrict Npcap driver\'s access to Administrators only" unticked.';
  }
  return message;
}
