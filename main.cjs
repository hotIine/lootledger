const { app, BrowserWindow, ClipboardItem, clipboard, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

let window = null;
let capture = null;

function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1d2127',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  window.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));
  window.on('closed', () => app.quit());
}

// LOOT_LEDGER_CAPTURE overrides the capture exe (for testing without the game)
function capturePath() {
  if (process.env.LOOT_LEDGER_CAPTURE) return process.env.LOOT_LEDGER_CAPTURE;
  const packaged = path.join(process.resourcesPath, 'capture', 'LootLedgerCapture.exe');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, 'dist', 'capture', 'LootLedgerCapture.exe');
}

function send(event) {
  if (window && !window.isDestroyed()) window.webContents.send('capture-event', event);
}

function startCapture() {
  if (capture) return;
  const exe = capturePath();
  if (!fs.existsSync(exe)) {
    send({ type: 'error', message: `The capture program is missing (${exe}).` });
    send({ type: 'stopped', code: null });
    return;
  }
  capture = spawn(exe, [], { windowsHide: true });
  readline.createInterface({ input: capture.stdout }).on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { send({ type: 'error', message: `Unreadable capture output: ${line.slice(0, 120)}` }); return; }
    if (event.type === 'chest-log-raw') saveChestLogSample(line);
    else send(event);
  });
  capture.stderr.on('data', (data) => send({ type: 'error', message: data.toString().trim() }));
  // 'exit' isn't guaranteed after 'error'
  capture.on('error', (error) => {
    capture = null;
    send({ type: 'error', message: `Could not start capture: ${error.message}` });
    send({ type: 'stopped', code: null });
  });
  capture.on('exit', (code) => {
    if (!capture) return;
    capture = null;
    send({ type: 'stopped', code });
  });
}

// closing stdin asks it to quit
function stopCapture() {
  if (!capture) return;
  const running = capture;
  running.stdin.end();
  setTimeout(() => { if (!running.killed && running.exitCode === null) running.kill(); }, 2000);
}

function logsFolder() {
  return path.join(app.getPath('documents'), 'Loot Ledger');
}

function saveChestLogSample(line) {
  fs.mkdirSync(logsFolder(), { recursive: true });
  fs.appendFileSync(path.join(logsFolder(), 'chest-log-samples.jsonl'), `${line}\n`);
}

// Renders a player card in a hidden window and copies it as an image.
// The window is created once and reused since opening one is slow.
const CARD_WIDTH = 680;
let cardWindow = null;
let cardQueue = Promise.resolve();

function openCardWindow() {
  const card = new BrowserWindow({
    show: false, width: CARD_WIDTH, height: 400, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true },
  });
  cardWindow = card.loadFile(path.join(__dirname, 'src', 'ui', 'card.html')).then(() => card);
  cardWindow.catch(() => { cardWindow = null; });
  card.on('closed', () => { cardWindow = null; });
}

async function copyCard(html) {
  if (!cardWindow) openCardWindow();
  const card = await cardWindow;
  const height = await card.webContents.executeJavaScript(`showCard(${JSON.stringify(html)})`);
  card.setContentSize(CARD_WIDTH, height);
  const png = (await nextFrame(card, height)).toPNG();
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
}

// capturePage() fails on offscreen windows, so grab a paint frame instead.
// The first frame at the right size can be missing icons, so use the second.
// Frames are in device pixels, so compare aspect ratio.
function nextFrame(card, height) {
  return new Promise((resolve, reject) => {
    let framesAtSize = 0;
    const done = () => { card.webContents.off('paint', onPaint); clearTimeout(timer); };
    const onPaint = (_event, _dirty, image) => {
      const { width, height: frameHeight } = image.getSize();
      if (Math.round((frameHeight * CARD_WIDTH) / width) !== height) return;
      framesAtSize += 1;
      // invalidating during the paint gets merged into this frame
      if (framesAtSize === 1) { setTimeout(() => card.webContents.invalidate(), 20); return; }
      done();
      resolve(image);
    };
    const timer = setTimeout(() => { done(); reject(new Error('the card did not finish drawing')); }, 3000);
    card.webContents.on('paint', onPaint);
    card.webContents.invalidate();
  });
}

ipcMain.handle('copy-card-image', (_event, html) => {
  if (typeof html !== 'string') throw new Error('Only a player card can be copied');
  const copy = cardQueue.then(() => copyCard(html));
  cardQueue = copy.catch(() => {});
  return copy;
});

// Item indices shift between patches, so fetch the latest list on startup
// and cache it for offline use.
const ITEM_LIST_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt';
let itemListLoad = null;

async function loadItemList() {
  const { parseItemList, countItems, MIN_ITEMS } = require('./src/core/itemList.js');
  const cacheFile = path.join(app.getPath('userData'), 'items.json');
  try {
    const response = await fetch(ITEM_LIST_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    const items = parseItemList(await response.text());
    if (countItems(items) < MIN_ITEMS) throw new Error('the download was not an item list');
    fs.writeFileSync(cacheFile, JSON.stringify(items));
    return { items };
  } catch (error) {
    return { items: readCachedItemList(cacheFile), error: `Item list not updated (${error.message}); item names may be wrong after a game patch.` };
  }
}

function readCachedItemList(cacheFile) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

ipcMain.handle('item-list', () => itemListLoad);

// Npcap installs to System32\Npcap (or System32 in WinPcap-compatible mode)
function isNpcapInstalled() {
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  return ['Npcap\\wpcap.dll', 'wpcap.dll'].some((file) => fs.existsSync(path.join(system32, file)));
}

ipcMain.handle('capture-check', () => ({ isNpcapInstalled: process.platform !== 'win32' || isNpcapInstalled() }));
ipcMain.handle('open-npcap-download', () => shell.openExternal('https://npcap.com/#download'));
ipcMain.handle('capture-start', () => startCapture());
ipcMain.handle('capture-stop', () => stopCapture());

// only plain .csv names inside the logs dir
ipcMain.handle('log-append', (_event, fileName, text) => {
  if (typeof text !== 'string' || !/^[\w.-]+\.csv$/.test(fileName)) throw new Error('Invalid log file name');
  fs.mkdirSync(logsFolder(), { recursive: true });
  fs.appendFileSync(path.join(logsFolder(), fileName), text);
  return path.join(logsFolder(), fileName);
});

// pinned so packaging changes don't lose saved fights
app.setPath('userData', path.join(app.getPath('appData'), 'albion-loot-tracker'));

// The portable build unpacks to a shared temp dir, so a second instance
// exiting would delete files out from under the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(() => {
    itemListLoad = loadItemList();
    createWindow();
    openCardWindow();
  });
}
app.on('before-quit', stopCapture);
app.on('window-all-closed', () => app.quit());
