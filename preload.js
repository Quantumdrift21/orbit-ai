const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbit', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  moveBy: (dx, dy) => ipcRenderer.send('win:move', dx, dy),
  showMenu: () => ipcRenderer.send('menu:show'),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  runAction: (name, args) => ipcRenderer.invoke('action:run', name, args),
  listApps: () => ipcRenderer.invoke('actions:apps'),
  logChat: (role, text) => ipcRenderer.send('log:append', role, text),
  reportState: (state) => ipcRenderer.send('orb:state', state),
  interact: () => ipcRenderer.send('orb:interact'),
  setDragging: (on) => ipcRenderer.send('orb:drag', on),
  onMotion: (cb) => ipcRenderer.on('motion', (_e, m) => cb(m)),
  onToggle: (cb) => ipcRenderer.on('orb:toggle', () => cb()),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', () => cb()),
});
