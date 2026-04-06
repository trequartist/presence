const { BrowserWindow } = require('electron');
const path = require('path');
const stateManager = require('../shared/state-manager');

/**
 * Window Manager — lazy creation, mode switching, lifecycle management.
 * 
 * Window types per mode:
 *   coach:    overlay + editor
 *   prompter: overlay + editor
 *   prep:     fullscreen
 */

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');

const WEB_PREFERENCES = {
  preload: PRELOAD_PATH,
  contextIsolation: true,
  nodeIntegration: false
};

// Mode -> window type -> HTML file path (relative to src/modes/)
const MODE_FILES = {
  coach: {
    overlay: path.join(__dirname, '..', 'modes', 'coach', 'overlay.html'),
    editor: path.join(__dirname, '..', 'modes', 'coach', 'editor.html')
  },
  prompter: {
    overlay: path.join(__dirname, '..', 'modes', 'prompter', 'overlay.html'),
    editor: path.join(__dirname, '..', 'modes', 'prompter', 'editor.html')
  },
  prep: {
    fullscreen: path.join(__dirname, '..', 'modes', 'prep', 'fullscreen.html')
  }
};

class WindowManager {
  constructor() {
    // windows[mode][type] = BrowserWindow | null
    this._windows = {
      coach: { overlay: null, editor: null },
      prompter: { overlay: null, editor: null },
      prep: { fullscreen: null }
    };
    this._activeMode = null;
  }

  /**
   * Attach initial state sync on window load.
   */
  _attachStateSync(win) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('state-update', stateManager.getState());
    });
  }

  /**
   * Create an overlay window for the given mode.
   * Frameless, transparent, always-on-top, non-activating.
   */
  _createOverlay(mode) {
    const defaultBounds = {
      coach: { x: 100, y: 40, width: 640, height: 200 },
      prompter: { x: 100, y: 300, width: 340, height: 240 }
    };
    const defaults = defaultBounds[mode] || { x: 100, y: 40, width: 640, height: 200 };
    const modeState = stateManager.getState()[mode] || {};
    const saved = modeState.overlayBounds || {};
    // Normalize: fill in any missing keys from defaults
    const bounds = {
      x: typeof saved.x === 'number' ? saved.x : defaults.x,
      y: typeof saved.y === 'number' ? saved.y : defaults.y,
      width: typeof saved.width === 'number' ? saved.width : defaults.width,
      height: typeof saved.height === 'number' ? saved.height : defaults.height
    };

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      resizable: true,
      show: false,
      webPreferences: { ...WEB_PREFERENCES }
    });

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const htmlPath = MODE_FILES[mode]?.overlay;
    if (htmlPath) win.loadFile(htmlPath);

    // Never steal focus
    win.on('focus', () => win.blur());

    // Persist bounds on move/resize
    win.on('moved', () => {
      const [x, y] = win.getPosition();
      stateManager.updateState({ [mode]: { overlayBounds: { x, y } } });
    });

    win.on('resized', () => {
      const [width, height] = win.getSize();
      stateManager.updateState({ [mode]: { overlayBounds: { width, height } } });
    });

    this._attachStateSync(win);

    win.on('closed', () => {
      this._windows[mode].overlay = null;
    });

    return win;
  }

  /**
   * Create an editor window for the given mode.
   * Focusable settings panel, hides on blur.
   */
  _createEditor(mode) {
    const sizes = {
      coach: { width: 400, height: 680 },
      prompter: { width: 360, height: 520 }
    };
    const { width, height } = sizes[mode] || { width: 400, height: 600 };

    const win = new BrowserWindow({
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: { ...WEB_PREFERENCES }
    });

    const htmlPath = MODE_FILES[mode]?.editor;
    if (htmlPath) win.loadFile(htmlPath);

    this._attachStateSync(win);

    win.on('blur', () => win.hide());

    win.on('closed', () => {
      this._windows[mode].editor = null;
    });

    return win;
  }

  /**
   * Create a fullscreen window (for prep mode).
   */
  _createFullscreen(mode) {
    const win = new BrowserWindow({
      fullscreen: true,
      frame: false,
      backgroundColor: '#0a0a0e',
      show: false,
      webPreferences: { ...WEB_PREFERENCES }
    });

    const htmlPath = MODE_FILES[mode]?.fullscreen;
    if (htmlPath) win.loadFile(htmlPath);

    this._attachStateSync(win);

    win.on('closed', () => {
      this._windows[mode].fullscreen = null;
    });

    return win;
  }

  /**
   * Get or lazily create a window.
   * @param {string} mode - 'coach' | 'prompter' | 'prep'
   * @param {string} type - 'overlay' | 'editor' | 'fullscreen'
   */
  getWindow(mode, type) {
    if (!this._windows[mode]) return null;

    let win = this._windows[mode][type];

    // If window was destroyed, clear the reference
    if (win && win.isDestroyed()) {
      win = null;
      this._windows[mode][type] = null;
    }

    // Lazy creation
    if (!win) {
      if (type === 'overlay') {
        win = this._createOverlay(mode);
      } else if (type === 'editor') {
        win = this._createEditor(mode);
      } else if (type === 'fullscreen') {
        win = this._createFullscreen(mode);
      }
      if (win) this._windows[mode][type] = win;
    }

    return win;
  }

  /**
   * Switch to a new mode. Hides current mode windows, shows/creates target mode windows.
   */
  switchMode(mode) {
    // Hide all windows from current mode
    if (this._activeMode && this._activeMode !== mode) {
      this._hideAllForMode(this._activeMode);
    }

    this._activeMode = mode;
    stateManager.updateState({ activeMode: mode });

    // Show appropriate windows for the new mode.
    // Note: we don't send state-update here — the stateManager.onStateChange
    // listener in main.js handles broadcasting to all visible windows,
    // avoiding double-sends.
    if (mode === 'prep') {
      const win = this.getWindow('prep', 'fullscreen');
      if (win) win.show();
    } else {
      // coach or prompter: show overlay
      const overlay = this.getWindow(mode, 'overlay');
      if (overlay) overlay.show();
    }

    console.log(`[WindowManager] Switched to mode: ${mode}`);
  }

  /**
   * Toggle overlay visibility for a mode.
   */
  toggleOverlay(mode) {
    const overlay = this.getWindow(mode, 'overlay');
    if (!overlay) return;

    if (overlay.isVisible()) {
      overlay.hide();
    } else {
      overlay.show();
      // Manual send needed: window may have missed broadcasts while hidden
      // (broadcastState only sends to visible windows)
      overlay.webContents.send('state-update', stateManager.getState());
    }
  }

  /**
   * Show the editor for a mode, positioned near the tray icon.
   */
  showEditor(mode, tray) {
    const editor = this.getWindow(mode, 'editor');
    if (!editor) return;

    if (tray) {
      try {
        const trayBounds = tray.getBounds();
        const windowBounds = editor.getBounds();
        const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
        const y = Math.round(trayBounds.y + trayBounds.height + 4);
        editor.setPosition(x, y);
      } catch {
        // tray.getBounds() may not work on all platforms
      }
    }

    editor.show();
    editor.focus();
    editor.webContents.send('state-update', stateManager.getState());
  }

  /**
   * Broadcast state update to all visible windows.
   */
  broadcastState(state) {
    for (const mode of Object.keys(this._windows)) {
      for (const type of Object.keys(this._windows[mode])) {
        const win = this._windows[mode][type];
        if (win && !win.isDestroyed() && win.isVisible()) {
          win.webContents.send('state-update', state);
        }
      }
    }
  }

  /**
   * Broadcast a message to all windows of a specific mode.
   */
  broadcastToMode(mode, channel, ...args) {
    if (!this._windows[mode]) return;
    for (const type of Object.keys(this._windows[mode])) {
      const win = this._windows[mode][type];
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }

  /**
   * Hide all windows for a mode.
   */
  _hideAllForMode(mode) {
    if (!this._windows[mode]) return;
    for (const type of Object.keys(this._windows[mode])) {
      const win = this._windows[mode][type];
      if (win && !win.isDestroyed()) {
        win.hide();
      }
    }
  }

  get activeMode() {
    return this._activeMode;
  }
}

module.exports = new WindowManager();
