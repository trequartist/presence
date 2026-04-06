# Presence — Technical Architecture

## Overview

Single Electron app with one menubar tray icon. Three modes share common infrastructure.

```
┌──────────────────────────────────────────────────────┐
│                    Electron Main Process              │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐           │
│  │  Tray   │  │  State   │  │    AI     │           │
│  │  Menu   │  │  Manager │  │  Client   │           │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘           │
│       │            │              │                   │
│  ┌────┴────────────┴──────────────┴──────┐           │
│  │           Window Manager              │           │
│  │  (lazy creation, mode switching)      │           │
│  └────┬────────────┬──────────────┬──────┘           │
│       │            │              │                   │
│  ┌────▼────┐  ┌────▼─────┐  ┌────▼─────┐            │
│  │ Coach   │  │ Prompter │  │  Prep    │            │
│  │ Windows │  │ Windows  │  │ Window   │            │
│  └─────────┘  └──────────┘  └──────────┘            │
└──────────────────────────────────────────────────────┘
                        │
                   IPC Bridge
                   (preload.js)
                        │
┌──────────────────────────────────────────────────────┐
│                  Renderer Processes                    │
│                                                       │
│  window.presence.* (unified API)                      │
│                                                       │
│  ┌─────────────────┐  ┌─────────────────┐            │
│  │  Audio Engine   │  │ Coaching Engine │            │
│  │  (Web Audio)    │  │ (Rule-based)   │            │
│  └─────────────────┘  └─────────────────┘            │
│                                                       │
│  Shared: glassmorphism.css                            │
└──────────────────────────────────────────────────────┘
```

## Data Flow

### State
```
User Action → Renderer → IPC (update-state) → State Manager → Save to disk
                                                    ↓
                                            Broadcast to all windows
```

### AI Queries
```
Renderer → IPC (query-ai) → Main Process → ai-client.js → Gemini API
                                                ↓
                                          Response back via IPC
```
API key NEVER leaves main process.

### Audio (Coach Mode)
```
Microphone → Web Audio API → AudioEngine._tick() (20fps in overlay renderer)
                                    ↓
                            CoachingEngine.update(metrics)
                                    ↓
                            UI update (WPM, talk%, message)
```
Audio processing stays in renderer (no IPC overhead for real-time).

### Voice Tracking (Prompter Mode)
```
Microphone → Web Speech API → ScrollEngine.matchTranscript()
                                    ↓
                            Fuzzy match against sentences
                                    ↓
                            Scroll to matched sentence
```

## Window Types

| Type | Frame | Transparent | AlwaysOnTop | Focusable | Used By |
|------|-------|-------------|-------------|-----------|---------|
| Overlay | No | Yes | Yes | No | Coach, Prompter |
| Editor | No | Yes | Yes | Yes | Coach, Prompter |
| Fullscreen | No | No | Yes | Yes | Prep |

## State Persistence

Single JSON file: `~/.config/presence/state.json`

Partitioned by mode to avoid conflicts. Each mode reads/writes only its own section.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+M | Toggle Meeting Coach overlay |
| Cmd+Shift+P | Toggle Teleprompter overlay |
| Cmd+Shift+R | Open Pre-Meeting Prep |
| Cmd+Shift+L | Toggle Lifeline (coach mode only) |
| Cmd+Left/Right | Navigate cue cards (coach mode only) |
