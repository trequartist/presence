const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, systemPreferences, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ENV_PATH = path.join(__dirname, '..', '.env');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'presence');

// ---------------------------------------------------------------------------
// Load .env file (inline parser — no dotenv dependency)
// ---------------------------------------------------------------------------
function loadEnvFile() {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file is optional — key can come from shell environment
  }
}

loadEnvFile();

// Load API key from config dir if not in env (packaged app fallback)
if (!process.env.GEMINI_API_KEY) {
  try {
    const configKey = fs.readFileSync(
      path.join(CONFIG_DIR, 'api-key'), 'utf-8'
    ).trim();
    if (configKey) process.env.GEMINI_API_KEY = configKey;
  } catch { /* No saved key — AI features will be unavailable */ }
}

// ---------------------------------------------------------------------------
// Imports (after env is loaded so ai-client can read GEMINI_API_KEY)
// ---------------------------------------------------------------------------
const stateManager = require('./shared/state-manager');
const aiClient = require('./shared/ai-client');
const windowManager = require('./windows/window-manager');
const CalendarBridge = require('./shared/calendar-bridge');

const calendar = new CalendarBridge();

const MAIN_WEB_PREFS = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let tray = null;
let settingsWindow = null;
let shortcutsWindow = null;

function getActiveMode() {
  return stateManager.getState().activeMode || 'coach';
}

/**
 * Safely execute a callback with a window, checking it exists and isn't destroyed.
 */
function withWindow(mode, type, fn) {
  const win = windowManager.getWindow(mode, type);
  if (win && !win.isDestroyed()) fn(win);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
  // Use base64 icon from DemoPrompter source (works cross-platform)
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVQ4T2NkoBAwUqifgWoGMEINA' +
      'AxoLvj//z8jsjhMAMcF/0E0OhdjcwGKN7C5ANktKAbgcCYOFzAwkB4GjDgDEdkFWL2BzYD/DP8Z' +
      'SHcBVi8wMDAAACfsIhGBJibbAAAAAElFTkSuQmCC',
      'base64'
    )
  );
  icon.setTemplateImage(true);

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Presence');

  updateTrayMenu();

  tray.on('click', () => {
    const mode = getActiveMode();
    if (mode === 'prep') {
      // Prep mode has no editor — open fullscreen instead
      windowManager.switchMode('prep');
    } else {
      windowManager.showEditor(mode, tray);
    }
  });
}

function updateTrayMenu() {
  const activeMode = getActiveMode();
  const state = stateManager.getState();
  const autoStart = state.settings?.autoStartEnabled || false;

  const contextMenu = Menu.buildFromTemplate([
    // --- Modes ---
    {
      label: 'Meeting Coach',
      type: 'radio',
      checked: activeMode === 'coach',
      click: () => switchToMode('coach')
    },
    {
      label: 'Teleprompter',
      type: 'radio',
      checked: activeMode === 'prompter',
      click: () => switchToMode('prompter')
    },
    {
      label: 'Pre-Meeting Prep',
      type: 'radio',
      checked: activeMode === 'prep',
      click: () => switchToMode('prep')
    },
    { type: 'separator' },
    // --- Utilities ---
    {
      label: 'Settings...',
      click: () => showSettingsWindow()
    },
    {
      label: 'Keyboard Shortcuts',
      click: () => showShortcutsWindow()
    },
    { type: 'separator' },
    // --- Preferences ---
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: autoStart,
      click: (menuItem) => {
        const enabled = menuItem.checked;
        app.setLoginItemSettings({ openAtLogin: enabled });
        stateManager.updateState({ settings: { autoStartEnabled: enabled } });
        console.log(`[Presence] Launch at login: ${enabled}`);
      }
    },
    { type: 'separator' },
    { label: 'Quit Presence', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------
function switchToMode(mode) {
  const previousMode = windowManager.activeMode;
  windowManager.switchMode(mode);
  updateTrayMenu();
  // Notify previous mode's windows (for cleanup, e.g. stopping audio capture)
  if (previousMode && previousMode !== mode) {
    windowManager.broadcastToMode(previousMode, 'mode-change', mode);
  }
  // Notify new mode's windows
  windowManager.broadcastToMode(mode, 'mode-change', mode);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Hide dock icon (menubar-only app)
  if (app.dock) app.dock.hide();

  // Initialize state manager with ~/.config/presence/
  stateManager.init(CONFIG_DIR);

  // Initialize AI client
  aiClient.init();

  // Create tray
  createTray();

  // Register global shortcuts (check return values for failures)
  function registerShortcut(accelerator, callback) {
    const success = globalShortcut.register(accelerator, callback);
    if (!success) {
      console.warn(`[Presence] Failed to register shortcut: ${accelerator} (may be in use by another app)`);
    }
    return success;
  }

  registerShortcut('CommandOrControl+Shift+M', () => {
    windowManager.toggleOverlay('coach');
  });

  registerShortcut('CommandOrControl+Shift+P', () => {
    windowManager.toggleOverlay('prompter');
  });

  registerShortcut('CommandOrControl+Shift+R', () => {
    switchToMode('prep');
  });

  // Lifeline shortcut (coach mode — full logic in Phase 2)
  registerShortcut('CommandOrControl+Shift+L', () => {
    withWindow('coach', 'overlay', (win) => win.webContents.send('lifeline-toggle'));
  });

  // Note: Cue card navigation (Cmd+Left/Right) is handled as local keyboard
  // shortcuts within the coach overlay renderer, not as global shortcuts,
  // to avoid hijacking system-wide text navigation.

  // Listen for state changes to broadcast to all windows
  stateManager.onStateChange((state) => {
    windowManager.broadcastState(state);
  });

  // Intentionally no initial window — this is a menubar-only app.
  // User activates modes via tray menu click or global shortcuts.
  // This matches the UX pattern of both MeetingCoach and DemoPrompter.
  // Start calendar auto-surface polling
  if (calendar.isAvailable) {
    startCalendarPolling();
    console.log('[Presence] Calendar integration active.');
  } else {
    console.log('[Presence] Calendar integration unavailable (not macOS).');
  }

  // Sync auto-start setting with OS
  const autoStart = stateManager.getState().settings?.autoStartEnabled || false;
  app.setLoginItemSettings({ openAtLogin: autoStart });

  console.log('[Presence] App ready. Tray icon active.');
  console.log(`[Presence] State file: ${path.join(CONFIG_DIR, 'state.json')}`);
  console.log(`[Presence] AI available: ${aiClient.isAvailable}`);

  // Check for first-run (show settings if setup not completed)
  checkFirstRun();
});

// ---------------------------------------------------------------------------
// Calendar Auto-Surface
// ---------------------------------------------------------------------------
let calendarPollInterval = null;
let lastNotifiedMeetingKey = null; // "id|startDate" to handle recurring events

function startCalendarPolling() {
  // Check every 60 seconds for meetings starting within 15 minutes
  calendarPollInterval = setInterval(async () => {
    try {
      const result = await calendar.getNextMeeting(15);
      if (result.error || !result.meeting) return;

      const meeting = result.meeting;

      // Don't notify for the same occurrence twice (id+startDate handles recurring events)
      const meetingKey = `${meeting.id}|${meeting.startDate}`;
      if (meetingKey === lastNotifiedMeetingKey) return;
      lastNotifiedMeetingKey = meetingKey;

      // Show notification
      const notification = new Notification({
        title: `Meeting in ${result.minutesUntil} min`,
        body: `${meeting.title}${meeting.attendees ? ' with ' + meeting.attendees.split(',')[0].trim() : ''}`,
        subtitle: 'Prep now?',
        silent: false,
        hasReply: false
      });

      notification.on('click', () => {
        // Pre-fill prep state with calendar context and switch to prep mode
        stateManager.updateState({
          prep: { calendarContext: { ...meeting } }
        });
        switchToMode('prep');
        // Clear calendar context after a short delay so the renderer has time to read it.
        // This prevents stale context from persisting if the app crashes.
        setTimeout(() => {
          stateManager.updateState({ prep: { calendarContext: null } });
        }, 3000);
      });

      notification.show();
    } catch (err) {
      console.warn('[Presence] Calendar poll error:', err.message);
    }
  }, 60000);

  // Also run once immediately (after a short delay for app to settle)
  setTimeout(async () => {
    try {
      const result = await calendar.getNextMeeting(15);
      if (result.meeting) {
        console.log(`[Presence] Next meeting: "${result.meeting.title}" in ${result.minutesUntil} min`);
      }
    } catch {
      // Ignore initial check errors
    }
  }, 5000);
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

// State
ipcMain.on('update-state', (event, partial) => {
  stateManager.updateState(partial);
});

ipcMain.handle('get-state', () => {
  return stateManager.getState();
});

// Mode
ipcMain.on('switch-mode', (event, mode) => {
  switchToMode(mode);
});

// Session (coach mode)
ipcMain.on('session-start', () => {
  withWindow('coach', 'overlay', (win) => {
    win.webContents.send('session-start');
    if (!win.isVisible()) win.show();
  });
});

ipcMain.on('session-stop', () => {
  withWindow('coach', 'overlay', (win) => win.webContents.send('session-stop'));
});

ipcMain.on('session-summary', (event, summary) => {
  stateManager.updateState({ coach: { lastSummary: summary } });
  withWindow('coach', 'editor', (win) => win.webContents.send('session-summary', summary));
});

ipcMain.on('session-failed', (event, reason) => {
  withWindow('coach', 'editor', (win) => win.webContents.send('session-failed', reason));
  // Auto-hide the coach overlay after a brief delay (targets coach specifically,
  // not the active mode, in case the user switched modes during the timeout)
  setTimeout(() => {
    withWindow('coach', 'overlay', (win) => { if (win.isVisible()) win.hide(); });
  }, 3000);
});

// AI (all queries go through main process — key never in renderer)
ipcMain.handle('query-ai', async (event, prompt, opts) => {
  return await aiClient.queryGemini(prompt, opts);
});

ipcMain.handle('generate-cards', async (event, context) => {
  return await aiClient.generateCards(context);
});

// Calendar
ipcMain.handle('get-upcoming-meetings', async (event, withinMinutes) => {
  return await calendar.getUpcomingMeetings(withinMinutes || 60);
});

ipcMain.handle('get-meeting-context', async (event, id) => {
  return await calendar.getMeetingContext(id);
});

// Audio
ipcMain.handle('request-mic-permission', async () => {
  if (!systemPreferences.getMediaAccessStatus) {
    // Not on macOS or API not available
    return true;
  }
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  if (status === 'denied') return false;
  try {
    return await systemPreferences.askForMediaAccess('microphone');
  } catch {
    return false;
  }
});

// Window controls
ipcMain.on('toggle-overlay', () => {
  windowManager.toggleOverlay(getActiveMode());
});

ipcMain.on('close-editor', () => {
  withWindow(getActiveMode(), 'editor', (win) => win.hide());
});

ipcMain.on('quit-app', () => app.quit());

// Settings
ipcMain.on('open-settings', () => showSettingsWindow());

ipcMain.on('save-api-key', (event, key) => {
  // Validate key at the IPC trust boundary
  if (!key || typeof key !== 'string' || key.trim().length < 10) return;
  key = key.trim();

  // Write API key to user config dir (writable in packaged app)
  // Also update .env for development mode
  try {
    // Save to config dir (same location as state.json)
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, 'api-key'), key, { mode: 0o600 });

    // Also try to update .env for dev mode (may fail in packaged app — that's OK)
    try {
      let content = '';
      try { content = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { /* new file */ }
      const lines = content.split('\n');
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        if (/^GEMINI_API_KEY\s*=/.test(lines[i].trim())) {
          lines[i] = `GEMINI_API_KEY=${key}`;
          found = true;
          break;
        }
      }
      if (!found) lines.push(`GEMINI_API_KEY=${key}`);
      fs.writeFileSync(ENV_PATH, lines.join('\n'));
    } catch { /* Read-only in packaged app — config dir has the key */ }

    process.env.GEMINI_API_KEY = key;
    aiClient.init(); // Re-initialize with new key
    console.log('[Presence] API key saved.');
  } catch (err) {
    console.error('[Presence] Failed to save API key:', err.message);
  }
});

ipcMain.on('complete-setup', () => {
  stateManager.updateState({ settings: { hasCompletedSetup: true } });
});

ipcMain.handle('get-app-info', () => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  return {
    version: app.getVersion(),
    aiAvailable: aiClient.isAvailable,
    hasApiKey: apiKey.length > 0,
    apiKeyHint: apiKey.length > 4 ? '••••••••' + apiKey.slice(-4) : '',
    calendarAvailable: calendar.isAvailable,
    platform: process.platform
  };
});

// ---------------------------------------------------------------------------
// Settings & Shortcuts Windows
// ---------------------------------------------------------------------------
function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 520,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    webPreferences: { ...MAIN_WEB_PREFS }
  });

  settingsWindow.loadFile(path.join(__dirname, 'windows', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function showShortcutsWindow() {
  if (shortcutsWindow && !shortcutsWindow.isDestroyed()) {
    shortcutsWindow.focus();
    return;
  }

  shortcutsWindow = new BrowserWindow({
    width: 420,
    height: 460,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    webPreferences: { ...MAIN_WEB_PREFS }
  });

  shortcutsWindow.loadFile(path.join(__dirname, 'windows', 'shortcuts.html'));
  shortcutsWindow.once('ready-to-show', () => shortcutsWindow.show());
  shortcutsWindow.on('blur', () => { if (shortcutsWindow && !shortcutsWindow.isDestroyed()) shortcutsWindow.hide(); });
  shortcutsWindow.on('closed', () => { shortcutsWindow = null; });
}

// ---------------------------------------------------------------------------
// First-Run Experience
// ---------------------------------------------------------------------------
function checkFirstRun() {
  const state = stateManager.getState();
  if (!state.settings?.hasCompletedSetup) {
    showSettingsWindow();
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (calendarPollInterval) clearInterval(calendarPollInterval);
  stateManager.flush();
});

app.on('window-all-closed', (e) => e.preventDefault());
