const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presence', {
  // --- State ---
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_, state) => cb(state)),
  updateState: (partial) => ipcRenderer.send('update-state', partial),
  getState: () => ipcRenderer.invoke('get-state'),

  // --- Mode ---
  switchMode: (mode) => ipcRenderer.send('switch-mode', mode),
  onModeChange: (cb) => ipcRenderer.on('mode-change', (_, mode) => cb(mode)),

  // --- Session (coach mode) ---
  startSession: () => ipcRenderer.send('session-start'),
  stopSession: () => ipcRenderer.send('session-stop'),
  onSessionStart: (cb) => ipcRenderer.on('session-start', () => cb()),
  onSessionStop: (cb) => ipcRenderer.on('session-stop', () => cb()),
  onSessionSummary: (cb) => ipcRenderer.on('session-summary', (_, summary) => cb(summary)),
  sendSummary: (summary) => ipcRenderer.send('session-summary', summary),

  // --- AI ---
  queryAI: (prompt, opts) => ipcRenderer.invoke('query-ai', prompt, opts),
  generateCards: (context) => ipcRenderer.invoke('generate-cards', context),

  // --- Calendar (optional) ---
  getUpcomingMeetings: () => ipcRenderer.invoke('get-upcoming-meetings'),
  getMeetingContext: (id) => ipcRenderer.invoke('get-meeting-context', id),

  // --- Audio ---
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),

  // --- Window controls ---
  toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
  closeEditor: () => ipcRenderer.send('close-editor'),
  quit: () => ipcRenderer.send('quit-app')
});
