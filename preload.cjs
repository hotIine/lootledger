const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ledger', {
  copyCardImage: (html) => ipcRenderer.invoke('copy-card-image', html),
  itemList: () => ipcRenderer.invoke('item-list'),
  checkCapture: () => ipcRenderer.invoke('capture-check'),
  openNpcapDownload: () => ipcRenderer.invoke('open-npcap-download'),
  startCapture: () => ipcRenderer.invoke('capture-start'),
  stopCapture: () => ipcRenderer.invoke('capture-stop'),
  appendLog: (fileName, text) => ipcRenderer.invoke('log-append', fileName, text),
  onCaptureEvent: (callback) => ipcRenderer.on('capture-event', (_event, data) => callback(data)),
});
