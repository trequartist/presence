const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coach', {
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_, state) => cb(state)),
  updateState: (state) => ipcRenderer.send('update-state', state),
  toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
  closeEditor: () => ipcRenderer.send('close-editor'),
  startSession: () => ipcRenderer.send('session-start'),
  stopSession: () => ipcRenderer.send('session-stop'),
  sendSummary: (summary) => ipcRenderer.send('session-summary', summary),
  onSessionStart: (cb) => ipcRenderer.on('session-start', () => cb()),
  onSessionStop: (cb) => ipcRenderer.on('session-stop', () => cb()),
  onSessionSummary: (cb) => ipcRenderer.on('session-summary', (_, s) => cb(s)),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
  quit: () => ipcRenderer.send('quit-app')
});
