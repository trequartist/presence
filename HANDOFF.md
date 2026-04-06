# Presence -- Developer Hand-Off

> Unified macOS menubar app: Meeting Coach + Smart Teleprompter + Pre-Meeting Prep + Calendar Integration.
> ~6,080 lines of code. 159 tests. Zero dependencies beyond Electron.

**Repo:** [github.com/trequartist/presence](https://github.com/trequartist/presence)

---

## System Shape

```
src/
├── main.js                          # Electron main process (tray, IPC, lifecycle)
├── preload.js                       # Context bridge (renderer <-> main)
├── shared/
│   ├── state-manager.js             # Persistent state (deep merge, disk-backed)
│   ├── ai-client.js                 # Gemini API wrapper (main process only)
│   ├── audio-engine.js              # FFT-based VAD + WPM (copied from MeetingCoach)
│   ├── coaching-engine.js           # Rule engine for speech coaching (copied from MeetingCoach)
│   ├── calendar-bridge.js           # macOS Calendar.app via osascript
│   └── styles/glassmorphism.css     # Shared UI styles
├── modes/
│   ├── coach/                       # Meeting Coach (overlay + editor)
│   ├── prompter/                    # Teleprompter (overlay + editor + scroll-engine)
│   └── prep/                        # Pre-Meeting Prep (fullscreen + rehearsal-engine)
└── windows/
    ├── window-manager.js            # Lazy window creation, mode switching
    ├── settings.html                # Settings / first-run onboarding
    └── shortcuts.html               # Keyboard shortcuts reference
```

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Menubar-only (no dock icon) | Matches MeetingCoach/DemoPrompter UX pattern |
| API key in `~/.config/presence/api-key` (0600) | Writable in packaged app; `.env` is read-only in asar |
| State in `~/.config/presence/state.json` | Deep-merge with defaults; 500ms debounced writes |
| `queryAI` injectable in RehearsalEngine | Testable without Electron IPC; passed via constructor opts |
| Calendar osascript only if Calendar.app running | Won't launch Calendar.app; graceful empty on non-macOS |
| No global shortcut for shortcuts help | `Cmd+/` conflicts with IDEs; tray menu instead |
| Context isolation ON, node integration OFF | Security: renderer can't access Node.js directly |

---

## Phase Matrix

| Phase | PR | What It Does | Key Files | Tests |
|-------|-----|-------------|-----------|-------|
| 0+1 | [PR #1](https://github.com/trequartist/presence/pull/1) | Scaffolding: tray, state manager, AI client, window manager, preload | `main.js`, `state-manager.js`, `ai-client.js`, `window-manager.js`, `preload.js` | 21 |
| 2 | [PR #2](https://github.com/trequartist/presence/pull/2) | Meeting Coach: real-time speech coaching overlay + editor | `coach/overlay.html`, `coach/editor.html`, `audio-engine.js`, `coaching-engine.js` | 69 |
| 3 | [PR #4](https://github.com/trequartist/presence/pull/4) | Teleprompter: voice-tracked scrolling, section markers | `prompter/overlay.html`, `prompter/editor.html`, `scroll-engine.js` | 35 |
| 4 | [PR #3](https://github.com/trequartist/presence/pull/3) | Pre-Meeting Prep: 5-stage fullscreen rehearsal with AI | `prep/fullscreen.html`, `rehearsal-engine.js` | 26 |
| 5 | [PR #5](https://github.com/trequartist/presence/pull/5), [PR #6](https://github.com/trequartist/presence/pull/6) | Calendar: macOS Calendar.app bridge, auto-surface notifications, context enrichment | `calendar-bridge.js`, `main.js` (polling), `fullscreen.html` (auto-fill) | 31 |
| 6 | [PR #7](https://github.com/trequartist/presence/pull/7) | Polish: settings/onboarding, shortcuts help, tray menu, auto-start, electron-builder, icons | `settings.html`, `shortcuts.html`, `main.js`, `package.json` | 3 (state) |

**Total: 159 tests across 6 test files. All passing on `main`.**

---

## Running It

```bash
# Development
cp .env.example .env          # Add GEMINI_API_KEY=your_key
npm install
npm run dev                   # Launches with logging

# Production build (macOS only)
npm run dist                  # Generates .dmg (runs generate-icns.sh automatically)

# Tests
npm test                      # 159 tests, ~2 seconds
```

---

## State Schema

```
activeMode: 'coach' | 'prompter' | 'prep'
coach:    { notes, prepContext, prepCards, checklist, sensitivity, monologueWarnSec, ... }
prompter: { text, speed, fontSize, opacity, voiceTrackingEnabled, sections, ... }
prep:     { lastScorecard, meetingType, customScenario, history }
settings: { hasCompletedSetup, autoStartEnabled }
```

---

## IPC Surface

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `query-ai` | invoke | Gemini API call (prompt + opts -> text) |
| `generate-cards` | invoke | AI cue card generation |
| `get-upcoming-meetings` | invoke | Calendar query (withinMinutes) |
| `get-meeting-context` | invoke | Calendar event detail by ID |
| `save-api-key` | send | Write key to config dir + .env |
| `complete-setup` | send | Mark first-run done |
| `get-app-info` | invoke | Version, AI/calendar/mic status |
| `request-mic-permission` | invoke | macOS mic access |
| `update-state` / `get-state` | send/invoke | State read/write |
| `switch-mode` | send | Mode switching |
| `session-start/stop/summary/failed` | send | Coach session lifecycle |
| `open-settings` | send | Show settings window |

---

## Known Limitations & Gaps

| Item | Status | Notes |
|------|--------|-------|
| `.icns` generation | macOS only | `iconutil` required; `predist` script handles it |
| 512@2x icon | Uses 512px source | Will appear slightly soft on Retina at max size; needs 1024px source |
| Calendar integration | macOS only | Graceful empty arrays on other platforms |
| UI testing | Blocked on Linux CI | All Electron window tests require macOS; static analysis done |
| First-run "Not now" | Re-prompts each launch | By design: user must save key or dismiss each time |
| API key in packaged app | Config dir only | `.env` write fails silently in asar (expected) |
| `onStateUpdate` in settings | Removed (was dead code) | Settings window not in WindowManager registry |
| Analytics | None by design | Verified: zero telemetry code in codebase |

---

## Developer Notes

- **audio-engine.js and coaching-engine.js are copied verbatim** from the MeetingCoach source reference. Do not rewrite -- they're production-tested FFT/VAD code.
- **Score clamping bug was fixed in rehearsal-engine.js**: `0 || 3` treated zero scores as falsy. Now uses `typeof` check.
- **State partitioning is critical**: all reads extract the mode sub-key first (`state.coach`, `state.prep`), all writes nest under the mode key. Forgetting this wipes sibling state.
- **Deep merge handles null correctly**: `updateState({ prep: { calendarContext: null } })` sets only that key, doesn't wipe `prep`.
- **Calendar cache is window-aware**: a 60-min cached result won't silently serve a 90-min request. Cache tracks `windowMinutes`.
- **Recurring meeting dedup**: notification tracks `(id, startDate)` not just `id` -- handles recurring calendar events.
- **All windows use `{ ...WEB_PREFERENCES }` spread**: prevents shared-reference mutation across BrowserWindow instances.
- **The app hides from Dock** (`app.dock.hide()`): it's a menubar-only app. Users interact via tray icon and global shortcuts.

---

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+M` | Toggle Meeting Coach overlay |
| `Cmd+Shift+P` | Toggle Teleprompter overlay |
| `Cmd+Shift+R` | Open Pre-Meeting Prep |
| `Cmd+Shift+L` | Lifeline (coach mode) |
| `Cmd+Left/Right` | Cue card navigation (local, not global) |
| `Enter` | Next prep stage |
| `Esc` | Exit prep / stop rehearsal |

---

## Developer Commentary

### What went well
- **Zero external dependencies** beyond Electron itself. No React, no bundler, no state library. The app is fast to start and simple to reason about. Plain HTML + vanilla JS in each window keeps the mental model flat.
- **The injectable `queryAI` pattern** in RehearsalEngine paid off immediately -- unit tests run in pure Node.js without mocking Electron IPC. This should be the pattern for any future AI-dependent module.
- **Deep-merge state manager** was the right call. Every mode owns its own state partition, and the merge semantics mean you can update one field without worrying about wiping siblings. The 500ms debounce prevents disk thrashing during rapid updates (overlay drag, speech metrics).
- **Copying audio-engine.js and coaching-engine.js verbatim** from the source reference saved significant time and preserved battle-tested FFT/VAD logic. These files should remain untouched unless there's a specific bug.

### What's fragile
- **fullscreen.html is 1,300+ lines.** It's the largest single file and handles all 5 prep stages, rehearsal UI, AI interactions, and calendar auto-fill. If prep mode grows further, this should be split into per-stage components or a lightweight framework.
- **The osascript calendar bridge** is inherently brittle -- AppleScript parsing, Calendar.app activation detection, and date format assumptions. If Apple changes Calendar.app's scripting dictionary, this breaks silently. Consider migrating to EventKit via a native Node addon if calendar becomes a core feature.
- **Settings window is not in WindowManager's registry**, so it doesn't receive state broadcasts. This is fine for its current short-lived role but would need fixing if settings becomes a persistent panel.

### What I'd change with more time
- **Move to a component system** for the HTML windows. Each mode's overlay/editor is a monolithic HTML file with inline CSS and JS. A simple build step (even just HTML includes) would reduce duplication and make the glassmorphism styles truly shared.
- **Add integration tests** that spin up Electron in headless mode. The current test suite covers all pure logic but can't test IPC wiring, window lifecycle, or tray menu behavior. `@electron/test` or Playwright with Electron support would close this gap.
- **Proper keychain storage** for the API key instead of a plaintext file. macOS Keychain via `keytar` or `safeStorage` would be more secure than `~/.config/presence/api-key`, even with 0600 permissions.
- **Replace the programmatic icons** with a proper design. The current icons are functional gradients generated via Node.js -- they work but aren't distinctive. A designer should create a proper menubar template icon (monochrome, 16x16 with @2x).

### Recommendations for the next developer
1. **Read `IMPLEMENTATION.md` first** -- it's the original spec and explains the "why" behind each phase.
2. **Run `npm test` before and after every change** -- the 159 tests catch regressions fast (~2 seconds).
3. **Test on macOS** -- the Linux CI can only verify logic. Window behavior, tray menu, notifications, and calendar all need a real Mac.
4. **Don't add dependencies lightly** -- the zero-dependency approach is a feature, not a limitation. Each new dep is a maintenance burden in an Electron app.
5. **State partitioning is the #1 gotcha** -- always nest writes under the mode key (`coach`, `prompter`, `prep`, `settings`). A bare `updateState({ someField: value })` at the top level will persist forever since it's not in DEFAULT_STATE.
