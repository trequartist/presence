const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

let stateFile = null;

const defaultState = {
  notes: '• Linear: $100M ARR, 197 ppl, $1.25B valuation, only 2 PMs\n• Nan Yu: Head of Product, ex-Everlane CTO. Values clarity, speed, opinionation.\n• Your edge: Use Linear daily through API, built 12-agent AI system on top of it\n• Ask Amelia: comp range, work trial format, team/product area\n• Ask Nan: PM vs product eng ownership, enterprise tension, AI agent future\n• WATCH OUT: "Where are the customers?" — have a concrete observation story ready\n• Lead with systems thinking, not feature lists',
  sensitivity: 0.5,
  monologueWarnSec: 60,
  encourageIntervalMin: 4,
  overlayBounds: { x: 100, y: 40, width: 640, height: 200 },
  lastSummary: null,
  prepCards: [
    { title: "Quick Facts", body: "Linear | $100M ARR | 197 people | $1.25B\nNan Yu \u2014 Head of Product, ex-Everlane CTO\nOnly 2 PMs with 25 engineers" },
    { title: "Nan\u2019s Philosophy", body: "Speed = competence, not rushing\nClarity over everything (no jargon, no user stories)\nOpinionated rejection prevents bloat" },
    { title: "Theme: Saying No", body: "\u2022 Amazon: inherited feature, secondhand assumptions\n\u2022 Trafford: what you deliberately didn\u2019t build\n\u2192 Connect to: Linear rejecting custom fields" },
    { title: "Theme: Craft & Quality", body: "\u2022 Jarvis: 12 agents, persistent memory, tool integrations\n\u2022 Your AI system problem framing = systems thinking\n\u2192 Connect to: lost art of building quality software" },
    { title: "Theme: Customer Empathy", body: "\u2022 Observed how YOU used AI tools \u2192 design decisions\n\u2022 Didn\u2019t ask what features I wanted \u2014 watched what I did\n\u2192 Connect to: Nan\u2019s indirect research method" },
    { title: "Danger Zone \u26A0\uFE0F", body: "Where are the customers?\nYour exercise was introspective, not observational\n\u2192 Have a concrete observation story ready" },
    { title: "Danger Zone \u26A0\uFE0F", body: "Is Jarvis a product or a hobby?\nWho else uses it? Would you charge for it?\n\u2192 Trafford is the productized version" },
    { title: "Your Killer Angle", body: "You USE Linear daily through API, not just UI\nBuilt AI agents that integrate with Linear\nLiving their vision of the future PM" },
    { title: "Questions for Nan", body: "1. How PMs vs product engineers divide ownership?\n2. Handling enterprise push for custom fields?\n3. How AI agents change the PM role?" },
    { title: "Recent Linear Launches", body: "\u2022 AI Coding Agent integrations (8+ agents, Mar 2026)\n\u2022 UI Refresh: calmer interface (Mar 11)\n\u2022 MCP expansion for initiatives/milestones (Feb)" }
  ],
  prepContext: 'Linear interview with Nan Yu (Head of Product) and Amelia Cellar (Recruiter). Linear: $100M ARR, $1.25B valuation, 197 employees, only 2 PMs with 25 engineers. Nan values: speed=competence, clarity over everything, opinionated rejection, extreme exploration for design, minimize meta-work, conviction + rapid feedback. Nan went CTO\u2192VP Product\u2192Head of Product. He believes PMs should be deeply technical. Your strongest angle: you use Linear daily through its API (not just UI), built 12-agent AI system (Jarvis/Trafford) that integrates with Linear, and have a thesis about PM role evolution that aligns with their AI-first direction. Danger zones: your PM exercise was introspective (no customer conversations mentioned), Jarvis might seem like a hobby not a product, you need concrete "saying no" examples. Recent Linear launches: AI coding agent integrations (8+ agents), UI refresh, MCP expansion, Triage Intelligence.',
  checklist: [
    { label: "Saying No", checked: false },
    { label: "Craft & Quality", checked: false },
    { label: "Customer Empathy", checked: false },
    { label: "AI Impact", checked: false },
    { label: "Org Design", checked: false },
    { label: "Speed & Conviction", checked: false },
    { label: "Questions for Nan", checked: false }
  ]
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
  const bounds = currentState.overlayBounds || defaultState.overlayBounds;

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

  overlayWindow.on('focus', () => overlayWindow.blur());

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

  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('state-update', currentState);
  });

  overlayWindow.hide();
}

function createEditor() {
  editorWindow = new BrowserWindow({
    width: 400,
    height: 680,
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
  // macOS template image: named "xxxTemplate" so macOS auto-adapts to light/dark mode
  const iconPath = path.join(__dirname, 'trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('MeetingCoach');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: showEditor },
    { label: 'Toggle Overlay  (\u2318\u21E7M)', click: toggleOverlay },
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

  globalShortcut.register('CommandOrControl+Shift+M', toggleOverlay);
});

// IPC handlers
ipcMain.on('update-state', (event, newState) => {
  currentState = { ...currentState, ...newState };
  saveState(currentState);
  if (overlayWindow) overlayWindow.webContents.send('state-update', currentState);
  if (editorWindow) editorWindow.webContents.send('state-update', currentState);
});

ipcMain.on('toggle-overlay', () => toggleOverlay());
ipcMain.on('close-editor', () => editorWindow?.hide());

ipcMain.handle('request-mic-permission', async () => {
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  if (status === 'denied') return false;
  return await systemPreferences.askForMediaAccess('microphone');
});

ipcMain.on('session-start', () => {
  if (overlayWindow) overlayWindow.webContents.send('session-start');
  if (!overlayWindow.isVisible()) {
    overlayWindow.show();
  }
});

ipcMain.on('session-stop', () => {
  if (overlayWindow) overlayWindow.webContents.send('session-stop');
});

ipcMain.on('session-summary', (event, summary) => {
  currentState.lastSummary = summary;
  saveState(currentState);
  if (editorWindow) editorWindow.webContents.send('session-summary', summary);
});

ipcMain.on('quit-app', () => app.quit());

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
