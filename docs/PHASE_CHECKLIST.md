# Implementation Phase Checklist

Track progress through each phase. Check off tasks as completed.

## Phase 0: Scaffolding
- [ ] package.json with Electron 41+
- [ ] src/main.js — minimal tray app with mode menu
- [ ] src/preload.js — stub window.presence namespace
- [ ] Tray icon renders in menubar
- [ ] Mode menu items visible (Meeting Coach, Teleprompter, Pre-Meeting Prep, Quit)
- [ ] Quit works cleanly

## Phase 1: Shared Infrastructure
- [ ] src/shared/state-manager.js — load, save (debounced), update, broadcast
- [ ] src/shared/ai-client.js — Gemini wrapper with env key
- [ ] src/windows/window-manager.js — lazy creation, mode switching
- [ ] src/shared/styles/glassmorphism.css — shared design tokens
- [ ] src/preload.js — full window.presence API
- [ ] src/main.js — IPC router for all handlers
- [ ] Global shortcuts registered (Cmd+Shift+M/P/R)
- [ ] State file created at ~/.config/presence/state.json
- [ ] Mode switching works (console log confirmation)

## Phase 2: Meeting Coach Mode
- [ ] src/shared/audio-engine.js — copied from MeetingCoach (verbatim)
- [ ] src/shared/coaching-engine.js — copied from MeetingCoach (verbatim)
- [ ] src/modes/coach/overlay.html — ported (window.presence.*, no hardcoded key)
- [ ] src/modes/coach/editor.html — ported (window.presence.*, no hardcoded key)
- [ ] Overlay appears on mode switch
- [ ] Editor appears on tray click
- [ ] Session start → mic activates, WPM + coaching visible
- [ ] Cue card generation works via IPC AI client
- [ ] Lifeline works (Cmd+Shift+L)
- [ ] Session stop → summary in editor
- [ ] State persists across restarts

## Phase 3: Smart Teleprompter Mode
- [ ] src/modes/prompter/overlay.html — ported from DemoPrompter
- [ ] src/modes/prompter/editor.html — ported with voice tracking toggle
- [ ] src/modes/prompter/scroll-engine.js — voice tracking via Web Speech API
- [ ] Auto-scroll works at adjustable speeds
- [ ] Font size and opacity controls work
- [ ] Voice tracking: text advances with speech
- [ ] Section markers: clickable jump points
- [ ] State persists across restarts

## Phase 4: Pre-Meeting Prep Mode
- [ ] src/modes/prep/fullscreen.html — 5-stage flow UI
- [ ] src/modes/prep/rehearsal-engine.js — AI conversation + scoring
- [ ] Stage 1: Context entry (manual + calendar)
- [ ] Stage 2: AI-generated briefing
- [ ] Stage 3: Voice rehearsal with AI responses
- [ ] Stage 4: Scorecard generation
- [ ] Stage 5: Auto-transition to Meeting Coach with generated cards
- [ ] Rehearsal history saved to state

## Phase 5: Calendar Integration
- [ ] src/shared/calendar-bridge.js — macOS Calendar via osascript
- [ ] Upcoming meetings polled every 60s
- [ ] Notification 10 min before meeting
- [ ] Click notification → prep mode with context pre-filled
- [ ] Calendar context parses title, attendees, description

## Phase 6: Polish & Packaging
- [ ] Proper menubar template icon (16x16 + @2x)
- [ ] Graceful degradation: no API key, mic denied, no calendar
- [ ] First-run setup flow
- [ ] Keyboard shortcuts help (Cmd+/)
- [ ] electron-builder config for .dmg
- [ ] Auto-start option in tray menu
