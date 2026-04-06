# Presence

A unified macOS menubar app with 3 modes for professional communication.

| Mode | When | UI | Hotkey |
|------|------|----|--------|
| **Meeting Coach** | During live calls | Hidden overlay | Cmd+Shift+M |
| **Smart Teleprompter** | During demos/presentations | Hidden overlay | Cmd+Shift+P |
| **Pre-Meeting Prep** | 3-10 min before calls | Full-screen takeover | Cmd+Shift+R |

## Quick Start

```bash
# Clone
git clone https://github.com/trequartist/presence.git
cd presence

# Set up API key
cp .env.example .env
# Edit .env and add your Gemini API key

# Install & run
npm install
npm start
```

## Architecture

Single Electron app, single tray icon. Three modes share:
- **Audio Engine** — FFT-based VAD, syllable counting, WPM estimation
- **Coaching Engine** — Rule-based real-time coaching (monologue, pace, talk-time)
- **AI Client** — Gemini 2.5 Flash (key from env, never in renderer)
- **State Manager** — Unified JSON state partitioned by mode
- **Design Language** — Glassmorphism dark theme

## Modes

### Mode 1: Meeting Coach
Real-time coaching overlay during calls. Shows WPM, talk-time balance, monologue warnings, pace detection. Includes prep cards, checklist, and AI lifeline.

**Ported from:** [MeetingCoach](source-reference/MEETINGCOACH_AUDIT.md) (feature-complete Electron MVP)

### Mode 2: Smart Teleprompter
Floating teleprompter overlay with auto-scroll and voice-tracked scrolling. Text advances as you speak using Web Speech API fuzzy matching.

**Ported from:** [DemoPrompter](source-reference/DEMOPROMPTER_AUDIT.md) (beta Electron + Python/AppKit)

### Mode 3: Pre-Meeting Prep
Full-screen rehearsal experience before calls. AI plays the other person, you practice your talking points, get scored on clarity/confidence/specificity/pace, then auto-transitions to Meeting Coach with generated cue cards.

**Inspired by:** [Tough Tongue AI](source-reference/TOUGH_TONGUE_RESEARCH.md)

## File Structure

```
presence/
├── package.json
├── .env.example                      # GEMINI_API_KEY=
├── assets/
│   └── tray-icon.png
├── src/
│   ├── main.js                       # Electron main: tray, IPC router, shortcuts
│   ├── preload.js                    # Unified bridge: window.presence.*
│   ├── shared/
│   │   ├── audio-engine.js           # FFT VAD + WPM (from MeetingCoach)
│   │   ├── coaching-engine.js        # Rule-based coaching (from MeetingCoach)
│   │   ├── ai-client.js             # Gemini wrapper (key from env)
│   │   ├── state-manager.js         # Unified JSON state
│   │   ├── calendar-bridge.js       # macOS Calendar integration
│   │   └── styles/glassmorphism.css # Shared design tokens
│   ├── modes/
│   │   ├── coach/                   # Meeting Coach overlay + editor
│   │   ├── prompter/               # Teleprompter overlay + editor + scroll-engine
│   │   └── prep/                   # Pre-meeting fullscreen + rehearsal-engine
│   └── windows/
│       └── window-manager.js       # Lazy window creation, mode switching
├── source-reference/               # Audits of source codebases (read-only context)
├── docs/                           # Architecture docs
└── IMPLEMENTATION.md               # Phase-by-phase build guide
```

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Scaffolding & repo setup | Complete |
| 1 | Shared infrastructure | Complete |
| 2 | Meeting Coach mode (port) | In progress |
| 3 | Smart Teleprompter mode (port + voice tracking) | In progress |
| 4 | Pre-Meeting Prep mode (new build) | Not started |
| 5 | Calendar integration | Not started |
| 6 | Polish & packaging | Not started |

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for detailed phase-by-phase instructions.

## Source Codebases

This app unifies two existing projects:
- **MeetingCoach** — Real-time meeting coaching (Electron 41, Web Audio API, Gemini)
- **DemoPrompter** — Teleprompter overlay (Electron 31 + Python/AppKit with voice tracking)

Full audits of both source codebases are in `source-reference/`.

## Security

- Gemini API key stored in `.env` file, loaded via `process.env`
- API key NEVER appears in renderer code — all AI calls go through IPC to main process
- Context isolation ON, node integration OFF in all windows
- No remote content loading
- All data stored locally, no analytics, no telemetry
