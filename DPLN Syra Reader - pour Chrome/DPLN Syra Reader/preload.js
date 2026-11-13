const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchPage: (url) => ipcRenderer.invoke('fetch-page', url),
  copy: (text) => ipcRenderer.invoke('copy', text),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  nextDisplay: () => ipcRenderer.invoke('next-display'),
  snap: (side) => ipcRenderer.invoke('snap', side),
  setKey: (action, acc) => ipcRenderer.invoke('set-key', action, acc),
  suspendKeys: (on) => ipcRenderer.invoke('suspend-keys', on),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  zoomImage: (src, rect) => ipcRenderer.invoke('zoom-image', src, rect),
  onLoadUrl: (cb) => ipcRenderer.on('load-url', (_e, d) => cb(d)),
  onStep: (cb) => ipcRenderer.on('step', (_e, d) => cb(d))
});
