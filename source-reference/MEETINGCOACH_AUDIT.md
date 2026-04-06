# MeetingCoach — Source Audit

**Location:** Originally at `~/conductor/workspaces/anish-sandbox-v2/tel-aviv/MeetingCoach/`
**Status:** Feature-complete MVP
**Stack:** Electron 41 + Vanilla JS + Web Audio API + Gemini 2.5 Flash

## Architecture

```
MeetingCoach/
├── main.js           # Electron main process (226 LOC)
├── preload.js        # IPC bridge: window.coach.* (16 LOC)
├── overlay.html      # Live coaching display (644 LOC)
├── editor.html       # Settings/control panel (500 LOC)
├── audio-engine.js   # Web Audio VAD + WPM (276 LOC)
├── coaching-engine.js # Rule-based coaching (155 LOC)
└── package.json      # Electron 41.0.2
```

Total: ~1,816 LOC

## Features

### Real-Time Audio Analysis (audio-engine.js)
- FFT-based Voice Activity Detection (300-3000 Hz speech band)
- Syllable counting via RMS peak detection
- WPM estimation: syllables/sec * 60 / 1.4
- Exponential smoothing (alpha=0.05)
- 5-second history snapshots (720 max = 1 hour)
- Talk percentage and continuous speech duration tracking

### Live Coaching (coaching-engine.js)
Priority-based rule engine:
1. Monologue warnings: 60s (amber), 90s (orange), 120s+ (red)
2. Pace detection: <120 ideal, 150-170 caution, 170+ critical
3. Talk-time balance: <30% good, 50-65% caution, 65%+ warning
4. Encouragements every 4 minutes (8 rotating messages)

### Prep Interface (editor.html)
- Talking points textarea
- Prep context textarea + AI card generation (Gemini)
- Cue cards rendered in overlay (Cmd+Left/Right navigation)
- Interactive checklist chips
- Settings: sensitivity (0.1-1), monologue threshold (30-120s), encouragement interval (2-10 min)
- Last session summary (duration, avg WPM, peak WPM, talk %)

### Overlay (overlay.html)
- Glassmorphism dark UI (rgba(10,10,14,0.92), 20px blur)
- Mic activity dot, WPM display, talk% bar, coaching messages
- Draggable + resizable with persistent bounds
- Lifeline: Cmd+Shift+L for mid-session AI questions

### Known Issues
- **SECURITY**: Gemini API key hardcoded in overlay.html (~line 560) and editor.html (~line 451)
- Lifeline relies on external LLM (not embedded)
- macOS only
- No session history (only last summary)

## Source Files

The complete source files from MeetingCoach are included in `source-reference/meetingcoach/` for direct reference during implementation.
