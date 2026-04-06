# DemoPrompter — Source Audit

**Location:** Originally at `~/anish-sandbox/DemoPrompter/`
**Status:** Beta / Active Development
**Stack:** Electron 31 + Python/AppKit (dual implementation)

## Architecture

```
DemoPrompter/
├── main.js           # Electron main process (195 LOC)
├── preload.js        # IPC bridge: window.prompter.* (8 LOC)
├── overlay.html      # Teleprompter display (169 LOC)
├── editor.html       # Editor panel (339 LOC)
├── app.py            # Python/WebKit version (349 LOC)
├── app_native.py     # Pure AppKit with voice tracking (930 LOC)
└── package.json      # Electron 31.7.7
```

## Three Implementations

### 1. Electron (main.js + overlay.html + editor.html)
- Lightweight, cross-platform
- Basic auto-scroll teleprompter
- Tray icon, global hotkey (Cmd+Shift+P)
- State persistence in ~/Library/Application Support/DemoPrompter/state.json

### 2. Python/WebKit (app.py)
- macOS native with WKWebView for rendering
- JS bridge via WKScriptMessageHandler
- Similar features to Electron version

### 3. Pure AppKit (app_native.py) — MOST MATURE
- No embedded browser, full native controls
- **Voice-tracked scrolling** via SFSpeechRecognizer (lines 538-693)
- AI text cleanup via OpenRouter API
- Advanced sentence matching with difflib

## Key Feature: Voice-Tracked Scrolling (app_native.py)

The algorithm to port to Web Speech API:

1. Split text into sentences on `.!?\n`
2. Run continuous speech recognition
3. Take last 20 words of running transcript
4. Fuzzy-match against first 12 words of each sentence
5. Similarity threshold: 0.6 (SequenceMatcher ratio)
6. On match: scroll to that sentence, advance pointer
7. Forward-only: never scroll backwards

This is the primary value from DemoPrompter that needs porting into the unified app.

## Features

- Floating overlay teleprompter (always-on-top, non-activating)
- Auto-scrolling with adjustable speed (0.3x-5x)
- Font size and opacity controls
- Persistent state (position, size, text, settings)
- Glassmorphism design (matches MeetingCoach aesthetic)

## Source Files

The complete source files from DemoPrompter are included in `source-reference/demoprompter/` for direct reference during implementation.
