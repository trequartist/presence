const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let stateFile = null;

const defaultState = {
  text: 'Paste your demo notes here...',
  speed: 1.5,
  fontSize: 22,
  opacity: 0.82,
  overlayBounds: { x: 100, y: 300, width: 340, height: 240 }
};

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch {
    return { ...defaultState };
  }
}

function saveState(state) {
  if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

let tray = null;
let overlayWindow = null;
let editorWindow = null;
let currentState = null;

function createOverlay() {
  const bounds = currentState.overlayBounds || { x: 100, y: 300, width: 340, height: 240 };

  overlayWindow = new BrowserWindow({
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile('overlay.html');

  // Never steal focus
  overlayWindow.on('focus', () => {
    overlayWindow.blur();
  });

  // Save position on move
  overlayWindow.on('moved', () => {
    const [x, y] = overlayWindow.getPosition();
    currentState.overlayBounds.x = x;
    currentState.overlayBounds.y = y;
    saveState(currentState);
  });

  overlayWindow.on('resized', () => {
    const [w, h] = overlayWindow.getSize();
    currentState.overlayBounds.width = w;
    currentState.overlayBounds.height = h;
    saveState(currentState);
  });

  // Send initial state
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('state-update', currentState);
  });

  overlayWindow.hide();
}

function createEditor() {
  editorWindow = new BrowserWindow({
    width: 360,
    height: 520,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  editorWindow.loadFile('editor.html');

  editorWindow.webContents.on('did-finish-load', () => {
    editorWindow.webContents.send('state-update', currentState);
  });

  editorWindow.on('blur', () => {
    editorWindow.hide();
  });
}

function toggleOverlay() {
  if (!overlayWindow) return;
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.show();
    overlayWindow.webContents.send('state-update', currentState);
  }
}

function showEditor() {
  if (!editorWindow) return;
  if (tray) {
    const trayBounds = tray.getBounds();
    const windowBounds = editorWindow.getBounds();
    const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    editorWindow.setPosition(x, y);
  }
  editorWindow.show();
  editorWindow.focus();
  editorWindow.webContents.send('state-update', currentState);
}

function createTray() {
  // Create a simple 16x16 icon using nativeImage
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVQ4T2NkoBAwUqifgWoGMEINA' +
      'AxoLvj//z8jsjhMAMcF/0E0OhdjcwGKN7C5ANktKAbgcCYOFzAwkB4GjDgDEdkFWL2BzYD/DP8Z' +
      'SHcBVi8wMDAAACfsIhGBJibbAAAAAElFTkSuQmCC',
      'base64'
    )
  );

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('DemoPrompter');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Edit Notes', click: showEditor },
    { label: 'Toggle Overlay  (⌘⇧P)', click: toggleOverlay },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.on('click', showEditor);
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  app.dock.hide();
  stateFile = path.join(app.getPath('userData'), 'state.json');
  currentState = loadState();

  createTray();
  createOverlay();
  createEditor();

  // Global hotkey: Cmd+Shift+P to toggle overlay
  globalShortcut.register('CommandOrControl+Shift+P', toggleOverlay);
});

// IPC handlers
ipcMain.on('update-state', (event, newState) => {
  currentState = { ...currentState, ...newState };
  saveState(currentState);
  if (overlayWindow) {
    overlayWindow.webContents.send('state-update', currentState);
  }
  if (editorWindow) {
    editorWindow.webContents.send('state-update', currentState);
  }
});

ipcMain.on('toggle-overlay', () => toggleOverlay());
ipcMain.on('close-editor', () => editorWindow?.hide());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', (e) => e.preventDefault());
