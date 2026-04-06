const { contextBridge, ipcRenderer } = require('electron');

/**
 * Helper: register an IPC listener and return a cleanup function.
 */
function onChannel(channel, transform) {
  return (cb) => {
    const handler = transform
      ? (event, ...args) => cb(transform(...args))
      : (event, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('presence', {
  // --- State ---
  onStateUpdate: onChannel('state-update'),
  updateState: (partial) => ipcRenderer.send('update-state', partial),
  getState: () => ipcRenderer.invoke('get-state'),

  // --- Mode ---
  switchMode: (mode) => ipcRenderer.send('switch-mode', mode),
  onModeChange: onChannel('mode-change'),

  // --- Session (coach mode) ---
  startSession: () => ipcRenderer.send('session-start'),
  stopSession: () => ipcRenderer.send('session-stop'),
  onSessionStart: onChannel('session-start'),
  onSessionStop: onChannel('session-stop'),
  onSessionSummary: onChannel('session-summary'),
  sendSummary: (summary) => ipcRenderer.send('session-summary', summary),
  onLifelineToggle: onChannel('lifeline-toggle'),
  onCardNavigate: onChannel('card-navigate'),
  onSessionFailed: onChannel('session-failed'),
  sendSessionFailed: (reason) => ipcRenderer.send('session-failed', reason),

  // --- AI ---
  queryAI: (prompt, opts) => ipcRenderer.invoke('query-ai', prompt, opts),
  generateCards: (context) => ipcRenderer.invoke('generate-cards', context),

  // --- Calendar (optional) ---
  getUpcomingMeetings: (withinMinutes) => ipcRenderer.invoke('get-upcoming-meetings', withinMinutes),
  getMeetingContext: (id) => ipcRenderer.invoke('get-meeting-context', id),

  // --- Audio ---
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),

  // --- Settings ---
  openSettings: () => ipcRenderer.send('open-settings'),
  saveApiKey: (key) => ipcRenderer.send('save-api-key', key),
  completeSetup: () => ipcRenderer.send('complete-setup'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // --- Window controls ---
  toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
  closeEditor: () => ipcRenderer.send('close-editor'),
  quit: () => ipcRenderer.send('quit-app')
});
