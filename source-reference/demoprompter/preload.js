const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prompter', {
  onStateUpdate: (callback) => ipcRenderer.on('state-update', (_, state) => callback(state)),
  updateState: (state) => ipcRenderer.send('update-state', state),
  toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
  closeEditor: () => ipcRenderer.send('close-editor')
});
