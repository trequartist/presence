const { app, Tray, Menu, globalShortcut, ipcMain, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// Load .env file (inline parser — no dotenv dependency)
// ---------------------------------------------------------------------------
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
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

// ---------------------------------------------------------------------------
// Imports (after env is loaded so ai-client can read GEMINI_API_KEY)
// ---------------------------------------------------------------------------
const stateManager = require('./shared/state-manager');
const aiClient = require('./shared/ai-client');
const windowManager = require('./windows/window-manager');

// ---------------------------------------------------------------------------
// App globals
// ---------------------------------------------------------------------------
let tray = null;

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
    const mode = stateManager.getState().activeMode || 'coach';
    if (mode === 'prep') {
      // Prep mode has no editor — open fullscreen instead
      windowManager.switchMode('prep');
    } else {
      windowManager.showEditor(mode, tray);
    }
  });
}

function updateTrayMenu() {
  const state = stateManager.getState();
  const activeMode = state.activeMode || 'coach';

  const contextMenu = Menu.buildFromTemplate([
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
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------
function switchToMode(mode) {
  windowManager.switchMode(mode);
  updateTrayMenu();
  // Notify all windows of mode change
  windowManager.broadcastToMode(mode, 'mode-change', mode);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Hide dock icon (menubar-only app)
  if (app.dock) app.dock.hide();

  // Initialize state manager with ~/.config/presence/
  const configDir = path.join(os.homedir(), '.config', 'presence');
  stateManager.init(configDir);

  // Initialize AI client
  aiClient.init();

  // Create tray
  createTray();

  // Register global shortcuts
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    windowManager.toggleOverlay('coach');
  });

  globalShortcut.register('CommandOrControl+Shift+P', () => {
    windowManager.toggleOverlay('prompter');
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    switchToMode('prep');
  });

  // Lifeline shortcut (coach mode — full logic in Phase 2)
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    const overlay = windowManager.getWindow('coach', 'overlay');
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('lifeline-toggle');
    }
  });

  // Note: Cue card navigation (Cmd+Left/Right) is handled as local keyboard
  // shortcuts within the coach overlay renderer, not as global shortcuts,
  // to avoid hijacking system-wide text navigation.

  // Listen for state changes to broadcast to all windows
  stateManager.onStateChange((state) => {
    windowManager.broadcastState(state);
  });

  console.log('[Presence] App ready. Tray icon active.');
  console.log(`[Presence] State file: ${path.join(configDir, 'state.json')}`);
  console.log(`[Presence] AI available: ${aiClient.isAvailable}`);
});

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
  const overlay = windowManager.getWindow('coach', 'overlay');
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('session-start');
    if (!overlay.isVisible()) overlay.show();
  }
});

ipcMain.on('session-stop', () => {
  const overlay = windowManager.getWindow('coach', 'overlay');
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('session-stop');
  }
});

ipcMain.on('session-summary', (event, summary) => {
  stateManager.updateState({ coach: { lastSummary: summary } });
  const editor = windowManager.getWindow('coach', 'editor');
  if (editor && !editor.isDestroyed()) {
    editor.webContents.send('session-summary', summary);
  }
});

// AI (all queries go through main process — key never in renderer)
ipcMain.handle('query-ai', async (event, prompt, opts) => {
  return await aiClient.queryGemini(prompt, opts);
});

ipcMain.handle('generate-cards', async (event, context) => {
  return await aiClient.generateCards(context);
});

// Calendar (stub — implemented in Phase 5)
ipcMain.handle('get-upcoming-meetings', async () => {
  return [];
});

ipcMain.handle('get-meeting-context', async (event, id) => {
  return null;
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
  const mode = stateManager.getState().activeMode || 'coach';
  windowManager.toggleOverlay(mode);
});

ipcMain.on('close-editor', () => {
  const mode = stateManager.getState().activeMode || 'coach';
  const editor = windowManager.getWindow(mode, 'editor');
  if (editor && !editor.isDestroyed()) editor.hide();
});

ipcMain.on('quit-app', () => app.quit());

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stateManager.flush();
});

app.on('window-all-closed', (e) => e.preventDefault());
