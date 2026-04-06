# Presence — Unified Menubar App Implementation Plan

## Context

Anish has two working Electron apps — **MeetingCoach** (real-time meeting coaching overlay) and **DemoPrompter** (teleprompter overlay) — that share similar architecture patterns (menubar tray, floating overlays, glassmorphism UI). The goal is to unify them into a single macOS menubar app called **Presence** with 3 modes, and add a new **Pre-Meeting Prep** mode inspired by Tough Tongue AI.

**This plan will be handed to another AI for implementation.** Anish handles testing, debugging, and deployment.

---

## Source Codebases

| Project | Location | Key Files |
|---------|----------|-----------|
| MeetingCoach | `~/conductor/workspaces/anish-sandbox-v2/tel-aviv/MeetingCoach/` | main.js, preload.js, overlay.html, editor.html, audio-engine.js, coaching-engine.js |
| DemoPrompter | `~/anish-sandbox/DemoPrompter/` | main.js, preload.js, overlay.html, editor.html, app_native.py (voice tracking algorithm) |

---

## Target File Structure

```
presence/
├── README.md                          # Setup, usage, architecture overview for implementing AI
├── IMPLEMENTATION.md                  # Detailed phase-by-phase instructions
├── package.json                       # Electron 41+, single dependency
├── .env.example                       # GEMINI_API_KEY=your_key_here
├── .gitignore
├── assets/
│   └── tray-icon.png                  # 16x16 template image (macOS light/dark)
├── src/
│   ├── main.js                        # Electron main process — tray, window manager, IPC router
│   ├── preload.js                     # Unified context bridge: window.presence.*
│   ├── shared/
│   │   ├── audio-engine.js            # FROM MeetingCoach — copy verbatim, no changes
│   │   ├── coaching-engine.js         # FROM MeetingCoach — copy verbatim, no changes
│   │   ├── ai-client.js              # Gemini 2.5 Flash wrapper (key from env, NOT hardcoded)
│   │   ├── state-manager.js          # Unified JSON state, partitioned by mode
│   │   ├── calendar-bridge.js        # Google Calendar integration (optional, graceful degradation)
│   │   └── styles/
│   │       └── glassmorphism.css     # Shared design tokens and base styles
│   ├── modes/
│   │   ├── coach/                    # Mode 1: Meeting Coach
│   │   │   ├── overlay.html          # FROM MeetingCoach overlay.html (adapted)
│   │   │   └── editor.html           # FROM MeetingCoach editor.html (adapted)
│   │   ├── prompter/                 # Mode 2: Smart Teleprompter
│   │   │   ├── overlay.html          # FROM DemoPrompter overlay.html (enhanced)
│   │   │   ├── editor.html           # FROM DemoPrompter editor.html (enhanced)
│   │   │   └── scroll-engine.js      # Voice-tracked scrolling (ported from app_native.py)
│   │   └── prep/                     # Mode 3: Pre-Meeting Prep (NEW)
│   │       ├── fullscreen.html       # Full-screen rehearsal UI
│   │       └── rehearsal-engine.js   # AI conversation agent + scoring
│   └── windows/
│       └── window-manager.js         # Lazy window creation, mode switching, lifecycle
└── docs/
    ├── ARCHITECTURE.md               # Technical architecture for reference
    └── PHASE_CHECKLIST.md            # Checkbox list for tracking implementation progress
```

---

## Unified Preload API

Replace divergent `window.coach` and `window.prompter` with single `window.presence`:

```javascript
window.presence = {
  // State
  onStateUpdate: (cb) => void,          // Listen for state changes
  updateState: (partial) => void,        // Merge partial state update
  getState: () => Promise<State>,        // Request current full state

  // Mode
  switchMode: (mode) => void,            // 'coach' | 'prompter' | 'prep'
  onModeChange: (cb) => void,            // Listen for mode switches

  // Session (coach mode)
  startSession: () => void,
  stopSession: () => void,
  onSessionStart: (cb) => void,
  onSessionStop: (cb) => void,
  onSessionSummary: (cb) => void,

  // AI
  queryAI: (prompt, opts) => Promise<string>,  // Gemini via main process (key never in renderer)

  // Calendar (optional)
  getUpcomingMeetings: () => Promise<Meeting[]>,
  getMeetingContext: (id) => Promise<MeetingContext>,

  // Audio
  requestMicPermission: () => Promise<boolean>,

  // Window controls
  toggleOverlay: () => void,
  closeEditor: () => void,
  quit: () => void,
}
```

---

## State Shape

Single JSON file at `~/.config/presence/state.json`:

```javascript
{
  activeMode: 'coach' | 'prompter' | 'prep',

  coach: {
    notes: '',
    prepContext: '',
    prepCards: [],
    checklist: [],
    sensitivity: 0.5,
    monologueWarnSec: 60,
    encourageIntervalMin: 4,
    lastSummary: null,
    overlayBounds: { x, y, width, height }
  },

  prompter: {
    text: '',
    speed: 1.5,
    fontSize: 22,
    opacity: 0.82,
    scrollOffset: 0,
    voiceTrackingEnabled: false,
    sections: [],
    overlayBounds: { x, y, width, height }
  },

  prep: {
    lastScorecard: null,
    meetingType: 'general',
    customScenario: '',
    history: []           // past rehearsal scores
  }
}
```

---

## Phase 0: Scaffolding & Repo Setup

**Goal:** Empty Electron menubar app that shows a tray icon with mode selector.

### Tasks
1. Create GitHub repo `trequartist/presence`
2. Initialize with `package.json` (Electron 41+), `.gitignore`, `.env.example`, `README.md`
3. Create `src/main.js` — minimal Electron app:
   - `app.dock.hide()`
   - Create tray icon with context menu: `Meeting Coach`, `Teleprompter`, `Pre-Meeting Prep`, separator, `Quit`
   - Menu items log to console (placeholder)
4. Create `src/preload.js` — stub with `window.presence` namespace (empty methods)
5. Create `assets/tray-icon.png` (can reuse MeetingCoach's base64 icon initially)

### Verification
- `npm start` → tray icon appears in menubar
- Right-click → shows 3 mode options + Quit
- Click Quit → app exits cleanly

---

## Phase 1: Shared Infrastructure

**Goal:** State manager, AI client, window manager, shared styles — all modes can build on.

### Tasks

#### 1a. State Manager (`src/shared/state-manager.js`)
- `loadState()` — read from `~/.config/presence/state.json`, merge with defaults
- `saveState(state)` — write to disk (debounced 500ms to avoid thrashing)
- `updateState(partial)` — deep merge partial update, save, broadcast to all windows
- `getState()` — return current in-memory state
- `onStateChange(cb)` — subscribe to changes
- Partition state by mode as shown in State Shape above

#### 1b. AI Client (`src/shared/ai-client.js`)
- Read `GEMINI_API_KEY` from `process.env` (loaded via `.env` file or shell)
- `queryGemini(prompt, { maxTokens, temperature })` → returns string
- `generateCards(context)` → returns `{ cards: [{title, body}], checklist: [{label, checked}] }`
- Error handling: return `{ error: 'message' }` if key missing or API fails
- **CRITICAL: API key NEVER sent to renderer. All AI calls go through IPC → main process → ai-client.**

#### 1c. Window Manager (`src/windows/window-manager.js`)
- `createOverlay(mode)` — creates mode-specific overlay (frameless, transparent, alwaysOnTop, non-activating)
- `createEditor(mode)` — creates mode-specific editor/control panel
- `createFullscreen(mode)` — creates fullscreen window (for prep mode)
- Lazy creation: windows only created on first activation
- `switchMode(mode)` — hide current mode windows, show/create target mode windows
- `getWindow(mode, type)` — return window reference
- Track overlay bounds per mode in state

#### 1d. Shared Styles (`src/shared/styles/glassmorphism.css`)
Extract common CSS from MeetingCoach + DemoPrompter:
- Dark background (rgba(10,10,14,0.92))
- Backdrop blur (20px)
- Border (1px solid rgba(255,255,255,0.08))
- Border radius (14px overlay, 8px controls)
- Color tokens: green (#44dd88), amber (#ffaa00), red (#ff4444), blue (#88aaff)
- Font: system-ui, -apple-system
- Drag handle styles
- Shared button, slider, textarea styles

#### 1e. Unified Preload (`src/preload.js`)
Implement full `window.presence` API as defined above. All methods route through `ipcRenderer` to main process.

#### 1f. Main Process IPC Router (`src/main.js` expansion)
- Register IPC handlers for all preload methods
- Route AI queries through ai-client
- Route state updates through state-manager
- Route mode switches through window-manager
- Register global shortcuts:
  - `Cmd+Shift+M` → toggle coach overlay
  - `Cmd+Shift+P` → toggle prompter overlay
  - `Cmd+Shift+R` → open prep fullscreen

### Verification
- Tray menu → click "Meeting Coach" → logs mode switch, no crash
- State file created at `~/.config/presence/state.json` with correct structure
- Environment variable `GEMINI_API_KEY` read correctly (test with console.log)

---

## Phase 2: Meeting Coach Mode (Port)

**Goal:** MeetingCoach fully functional inside unified app as Mode 1.

### Tasks

#### 2a. Copy Engines Verbatim
- Copy `audio-engine.js` → `src/shared/audio-engine.js` (NO CHANGES to logic)
- Copy `coaching-engine.js` → `src/shared/coaching-engine.js` (NO CHANGES to logic)

#### 2b. Port Overlay (`src/modes/coach/overlay.html`)
- Start from MeetingCoach's `overlay.html`
- Replace `window.coach.*` calls with `window.presence.*`
- Remove hardcoded Gemini API key (lines ~560-570)
- Replace direct `fetch()` to Gemini with `window.presence.queryAI(prompt)`
- Import shared glassmorphism.css
- Keep all UI: bar (mic dot, WPM, talk%, coaching message, timer), cards row, checklist row, lifeline

#### 2c. Port Editor (`src/modes/coach/editor.html`)
- Start from MeetingCoach's `editor.html`
- Replace `window.coach.*` with `window.presence.*`
- Remove hardcoded Gemini API key (line ~451)
- Replace direct `fetch()` for card generation with `window.presence.queryAI(prompt)`
- Keep all UI: session button, talking points, prep context, settings sliders, last session summary

#### 2d. Wire Up in Main Process
- Tray click "Meeting Coach" → `windowManager.switchMode('coach')`
- Creates overlay + editor for coach mode
- Session start/stop routed correctly
- State persistence under `state.coach`

### Verification
- Start app → click Meeting Coach → overlay appears
- Click tray → editor appears with settings
- Start session → microphone activates, WPM shows, coaching messages appear
- Generate cue cards from prep context → cards appear in overlay
- Lifeline works (Cmd+Shift+L)
- Stop session → summary displayed in editor
- Restart app → state persisted (notes, settings, last summary)

---

## Phase 3: Smart Teleprompter Mode (Port + Enhancement)

**Goal:** DemoPrompter functional as Mode 2, enhanced with voice-tracked scrolling.

### Tasks

#### 3a. Port Overlay (`src/modes/prompter/overlay.html`)
- Start from DemoPrompter's Electron `overlay.html`
- Replace `window.prompter.*` with `window.presence.*`
- Import shared glassmorphism.css
- Keep: smooth scroll animation, fade edges, speed/font/opacity controls
- Add: section markers (horizontal pills showing named sections, clickable to jump)
- Add: pace indicator (on-track / ahead / behind based on total text length vs elapsed time)

#### 3b. Port Editor (`src/modes/prompter/editor.html`)
- Start from DemoPrompter's Electron `editor.html`
- Replace `window.prompter.*` with `window.presence.*`
- Keep: text editing, speed slider, font slider, opacity slider, play/pause/reset
- Add: voice tracking toggle (checkbox: "Track by voice")
- Add: section divider insertion button (inserts `---` markers in text)
- Add: total duration estimate based on average reading speed

#### 3c. Voice-Tracked Scrolling (`src/modes/prompter/scroll-engine.js`)
Port algorithm from `app_native.py` lines 538-693 to Web Speech API:

```javascript
// Algorithm (from app_native.py):
// 1. Split text into sentences on .!?\n
// 2. Run Web Speech API continuous recognition
// 3. Take last 20 words of running transcript
// 4. Fuzzy-match against first 12 words of each sentence (forward-only)
// 5. Similarity threshold: 0.6 (SequenceMatcher ratio equivalent)
// 6. On match: scroll to that sentence, advance current_sentence pointer
// 7. Forward-only: never scroll backwards

class ScrollEngine {
  constructor(textElement) {}

  // Split text into sentences with position metadata
  prepareSentences(text) {}

  // Start Web Speech API recognition
  startVoiceTracking() {}

  // Fuzzy match transcript against sentences
  matchTranscript(transcript) {}

  // Scroll to matched sentence (smooth)
  scrollToSentence(index) {}

  // Stop recognition
  stopVoiceTracking() {}
}
```

**Web Speech API notes:**
- Use `webkitSpeechRecognition` (Chromium in Electron supports it)
- Set `continuous = true`, `interimResults = true`
- Handle `onresult` events, concatenate transcript
- Restart on `onend` (Web Speech API auto-stops periodically)

#### 3d. Wire Up in Main Process
- Tray click "Teleprompter" → `windowManager.switchMode('prompter')`
- Global shortcut Cmd+Shift+P toggles prompter overlay
- State persistence under `state.prompter`

### Verification
- Switch to Teleprompter mode → overlay appears with sample text
- Edit text in editor → overlay updates in real-time
- Play → text scrolls at set speed
- Speed/font/opacity sliders work
- Voice tracking toggle → microphone activates, text advances with speech
- Section markers → click to jump
- Restart app → text and settings persisted

---

## Phase 4: Pre-Meeting Prep Mode (New Build)

**Goal:** Full-screen rehearsal experience before calls. This is the creative new build.

### Tasks

#### 4a. Fullscreen UI (`src/modes/prep/fullscreen.html`)

**Layout:** Dark full-screen window with 5 sequential stages:

```
┌─────────────────────────────────────────────────────────┐
│  PRESENCE — Pre-Meeting Prep              ⏱ 8:32 until │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                                                      │ │
│  │              [STAGE CONTENT HERE]                    │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  [Back]                              [Next / Start / Done]│
└─────────────────────────────────────────────────────────┘
```

**Stage 1: Context (10 seconds auto or manual)**
- Meeting title, attendees, description (from calendar or manual entry)
- Countdown: "In X minutes, you have: [Meeting Title] with [Person]"
- Editable: goals for this call (3 bullet textarea)
- Meeting type selector: Interview / Sales-Pitch / Negotiation / 1:1-Networking / Custom

**Stage 2: Briefing (30 seconds read)**
- AI-generated briefing based on context:
  - Who they are (from user-provided notes or calendar description)
  - What this meeting is about
  - Your stated goals
  - 3 suggested talking points
- All editable before proceeding

**Stage 3: Rehearsal (2-4 minutes, voice)**
- AI plays the other person via voice synthesis (or text bubbles if voice not available)
- User speaks, transcript captured via Web Speech API
- AI responds adapting to meeting type:
  - Interview → asks behavioral questions, probes for STAR format
  - Sales/Pitch → raises objections, asks for specifics
  - Negotiation → pushes back on anchors, tests framing
  - 1:1 → conversational, relationship-building
  - Custom → follows user-defined scenario
- Real-time coaching nudges in corner (from coaching-engine: pace, monologue)
- Visual timer showing elapsed / recommended time

**Stage 4: Scorecard (auto-generated)**
- Metrics (each 1-5 scale):
  - **Clarity**: Were points crisp and specific?
  - **Confidence**: Did you sound certain? (hedging detection)
  - **Specificity**: Did you use concrete examples?
  - **Pace**: Speaking rate assessment (from audio-engine WPM)
- Top 2 things to remember (AI-generated)
- "Your opening was strong / needs work" type feedback
- Save to `state.prep.history[]`

**Stage 5: Transition**
- "Ready to go. Switching to Meeting Coach in 10s..."
- Auto-loads talking points + scorecard reminders as cue cards in coach mode
- Countdown → switches to coach overlay mode automatically

#### 4b. Rehearsal Engine (`src/modes/prep/rehearsal-engine.js`)

```javascript
class RehearsalEngine {
  constructor(aiClient, audioEngine) {}

  // Initialize with meeting context
  async setup(context) {}

  // Generate briefing from context
  async generateBriefing(context) {}

  // Start voice rehearsal
  async startRehearsal(meetingType) {}

  // Process user speech, generate AI response
  async processUserTurn(transcript) {}

  // Generate scorecard from rehearsal transcript
  async generateScorecard(transcript, meetingType) {}

  // Generate cue cards for coach mode transition
  generateTransitionCards(scorecard, talkingPoints) {}
}
```

**AI Prompting Strategy:**
- System prompt sets the character based on meeting type
- Conversation history maintained for context
- After rehearsal ends, full transcript sent for scoring
- Scoring prompt asks for structured JSON response

#### 4c. Wire Up in Main Process
- Tray click "Pre-Meeting Prep" → `windowManager.switchMode('prep')`
- Global shortcut Cmd+Shift+R opens prep fullscreen
- Transition at end → auto `switchMode('coach')` with generated cards

### Verification
- Switch to Prep mode → fullscreen dark UI appears
- Enter meeting context manually → briefing generated
- Start rehearsal → AI responds to speech, nudges appear
- Complete rehearsal → scorecard with scores and tips
- Transition → coach mode activates with cue cards from scorecard
- History saved to state

---

## Phase 5: Calendar Integration (Optional Enhancement)

**Goal:** Auto-surface upcoming meetings, pre-fill prep context.

### Tasks

#### 5a. Calendar Bridge (`src/shared/calendar-bridge.js`)
- Option A: Use Google Calendar MCP (if available in environment)
- Option B: Use Google Calendar OAuth (more portable but more setup)
- Option C: Parse `.ics` file or read from macOS Calendar via `osascript`
- Start with Option C (simplest, no auth required):
  ```javascript
  // Use osascript to query macOS Calendar.app
  async getUpcomingMeetings(withinMinutes = 60) {}
  async getMeetingDetails(eventId) {}
  ```

#### 5b. Auto-Surface Logic
- Every 60 seconds, check for meetings starting within 15 minutes
- Show macOS notification: "Meeting with [Person] in 10 min. Prep now?"
- Click notification → opens Prep mode with context pre-filled

#### 5c. Context Enrichment
- Parse calendar event description for attendee names, agenda
- If meeting has a Google Meet / Zoom link, extract it
- Pre-fill prep goals based on meeting title keywords

### Verification
- Create a test calendar event 10 min from now
- Notification appears → click → prep mode opens with context filled
- Meeting details correct (title, attendees, description)

---

## Phase 6: Polish & Packaging

**Goal:** Production-ready for daily use.

### Tasks
1. **App icon**: Design proper menubar template icon (16x16, 32x32 @2x)
2. **Error handling**: Graceful degradation when Gemini key missing, mic denied, calendar unavailable
3. **First-run experience**: On first launch, show setup: paste Gemini API key, grant mic permission
4. **Keyboard shortcuts help**: Cmd+/ shows shortcut overlay
5. **electron-builder config**: Package as `.dmg` for macOS
6. **Auto-start option**: Launch at login (optional, via tray menu)
7. **Analytics**: None. Privacy-first. All data local.

### Verification
- Fresh install: setup flow works
- Missing API key: graceful error, features that need AI show "Set API key in settings"
- Mic denied: coaching still works in prep mode (text-only fallback)
- Package as .dmg: installs cleanly on fresh Mac

---

## Implementation Notes for the Building AI

### What to copy verbatim (DO NOT REWRITE):
- `audio-engine.js` — production-tested FFT-based VAD + WPM. Copy as-is.
- `coaching-engine.js` — production-tested rule engine. Copy as-is.
- UI layouts from overlay.html files — adapt API calls but keep DOM structure

### What to port carefully:
- Voice tracking from `app_native.py` lines 538-693 → Web Speech API. Algorithm stays the same, API surface changes.
- Gemini calls from renderer-side `fetch()` → IPC to main process `ai-client.js`. Logic stays, transport changes.

### What to build fresh:
- `state-manager.js` (new, combines patterns from both apps)
- `window-manager.js` (new, manages lazy window lifecycle)
- `ai-client.js` (new, wraps Gemini with proper key handling)
- `calendar-bridge.js` (new)
- Entire `modes/prep/` directory (new, inspired by Tough Tongue AI)
- `rehearsal-engine.js` (new, AI conversation + scoring)

### Security requirements:
- GEMINI_API_KEY in `.env` file, loaded via `process.env`, passed through IPC
- NEVER in renderer HTML/JS
- Context isolation ON, node integration OFF in all windows
- No remote content loading

### Testing approach:
- Each phase should be independently runnable
- Phase 0: tray icon only
- Phase 1: tray + mode switching (no mode UI yet)
- Phase 2: full Meeting Coach
- Phase 3: full Teleprompter
- Phase 4: full Prep mode
- Phase 5: calendar integration
- Phase 6: packaging
