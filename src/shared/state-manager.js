const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = {
  activeMode: 'coach',

  coach: {
    notes: '',
    prepContext: '',
    prepCards: [],
    checklist: [],
    sensitivity: 0.5,
    monologueWarnSec: 60,
    encourageIntervalMin: 4,
    lastSummary: null,
    overlayBounds: { x: 100, y: 40, width: 640, height: 200 }
  },

  prompter: {
    text: '',
    speed: 1.5,
    fontSize: 22,
    opacity: 0.82,
    scrollOffset: 0,
    voiceTrackingEnabled: false,
    sections: [],
    overlayBounds: { x: 100, y: 300, width: 340, height: 240 }
  },

  prep: {
    lastScorecard: null,
    meetingType: 'general',
    customScenario: '',
    history: []
  }
};

class StateManager {
  constructor() {
    this._state = null;
    this._filePath = null;
    this._saveTimer = null;
    this._listeners = [];
  }

  /**
   * Initialize with a config directory path.
   * Creates the directory and loads state from disk (or defaults).
   */
  init(configDir) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this._filePath = path.join(configDir, 'state.json');
    this._state = this._loadFromDisk();
  }

  _loadFromDisk() {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf-8');
      const saved = JSON.parse(raw);
      return this._deepMerge(this._cloneDefaults(), saved);
    } catch {
      return this._cloneDefaults();
    }
  }

  _cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  /**
   * Deep merge source into target. Arrays are replaced, not merged.
   */
  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  /**
   * Save state to disk, debounced by 500ms.
   */
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._writeToDisk();
    }, 500);
  }

  _writeToDisk() {
    if (!this._filePath) return;
    try {
      fs.writeFileSync(this._filePath, JSON.stringify(this._state, null, 2));
    } catch (err) {
      console.error('[StateManager] Failed to write state:', err.message);
    }
  }

  /**
   * Return current in-memory state (read-only copy).
   */
  getState() {
    if (!this._state) return null;
    return JSON.parse(JSON.stringify(this._state));
  }

  /**
   * Deep-merge a partial update into state, save, and broadcast.
   */
  updateState(partial) {
    if (!this._state) return;
    this._deepMerge(this._state, partial);
    this._scheduleSave();
    this._broadcast();
  }

  /**
   * Subscribe to state changes. Returns unsubscribe function.
   */
  onStateChange(cb) {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter(l => l !== cb);
    };
  }

  _broadcast() {
    const snapshot = this.getState();
    for (const cb of this._listeners) {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('[StateManager] Listener error:', err.message);
      }
    }
  }

  /**
   * Force an immediate save (e.g. before quit).
   */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._writeToDisk();
  }
}

module.exports = new StateManager();
module.exports.DEFAULT_STATE = DEFAULT_STATE;
