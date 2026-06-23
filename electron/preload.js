const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  webdav: opts => ipcRenderer.invoke('webdav', opts),
  getDesktopSettings: () => ipcRenderer.invoke('get-desktop-settings'),
  setDesktopSettings: patch => ipcRenderer.invoke('set-desktop-settings', patch),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  showFloatPanel: () => ipcRenderer.invoke('show-float-panel'),
  showFloatBallMenu: () => ipcRenderer.invoke('show-float-ball-menu'),
  hideFloatPanel: () => ipcRenderer.invoke('hide-float-panel'),
  toggleFloatBall: show => ipcRenderer.invoke('toggle-float-ball', show),
  notifyDataChanged: () => ipcRenderer.invoke('notify-data-changed'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  floatBallDrag: (dx, dy) => ipcRenderer.send('float-ball-drag', { dx, dy }),
  onDataChanged: cb => ipcRenderer.on('data-changed', cb),
  onDesktopSettings: cb => ipcRenderer.on('desktop-settings', (_, data) => cb(data)),
  onThemeChanged: cb => ipcRenderer.on('theme-changed', (_, theme) => cb(theme)),
  broadcastTheme: theme => ipcRenderer.invoke('broadcast-theme', theme),
});
