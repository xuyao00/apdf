const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('apdf', {
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  getUpdateState: () => ipcRenderer.invoke('app:update-state'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:update-state', listener);
    return () => ipcRenderer.removeListener('app:update-state', listener);
  },
  setTheme: theme => ipcRenderer.invoke('app:theme', theme),
  open: () => ipcRenderer.invoke('pdf:open'),
  openDropped: file => ipcRenderer.invoke('pdf:drop', webUtils.getPathForFile(file)),
  pending: () => ipcRenderer.invoke('pdf:pending'),
  release: token => ipcRenderer.invoke('pdf:release', token),
  list: () => ipcRenderer.invoke('library:list'),
  load: id => ipcRenderer.invoke('library:load', id),
  save: (token, metadata) => ipcRenderer.invoke('library:save', token, metadata),
  update: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
  remove: id => ipcRenderer.invoke('library:remove', id),
  exportPdf: token => ipcRenderer.invoke('pdf:export', token),
  exportBibtex: (title, bibtex) => ipcRenderer.invoke('bibtex:export', title, bibtex),
  importBibtex: () => ipcRenderer.invoke('bibtex:import'),
  external: url => ipcRenderer.invoke('app:external', url),
  print: token => ipcRenderer.invoke('pdf:print', token),
  onOpen: callback => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('pdf:available', listener);
    return () => ipcRenderer.removeListener('pdf:available', listener);
  }
});
