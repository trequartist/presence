#!/usr/bin/env python3
"""DemoPrompter — Pure native AppKit. No WKWebView, no JS bridge."""

import difflib
import json
import os
import re
import threading
import objc
import AppKit
import Foundation

# Inject TCC usage descriptions before Speech/mic APIs are loaded.
# macOS reads these from the main bundle's Info.plist; for unbundled Python
# scripts the dict is empty, so we populate it at runtime to avoid SIGABRT.
try:
    _info = AppKit.NSBundle.mainBundle().infoDictionary()
    _info["NSMicrophoneUsageDescription"] = (
        "DemoPrompter uses your microphone for voice-tracked teleprompter scrolling."
    )
    _info["NSSpeechRecognitionUsageDescription"] = (
        "DemoPrompter uses speech recognition to auto-scroll as you speak."
    )
except Exception as _e:
    print(f"[Warning] Could not inject TCC descriptions: {_e}", flush=True)

try:
    import Speech
    import AVFoundation
    SPEECH_AVAILABLE = True
except ImportError:
    SPEECH_AVAILABLE = False

# ─── State ───────────────────────────────────────────────────────────────────

STATE_DIR = os.path.expanduser("~/Library/Application Support/DemoPrompter")
STATE_FILE = os.path.join(STATE_DIR, "state.json")

DEFAULT_STATE = {
    "text": "",
    "speed": 1.5,
    "fontSize": 22,
    "opacity": 0.82,
    "isScrolling": False,
    "scrollOffset": 0.0,
    "isOverlayVisible": False,
    "overlayBounds": {"x": 100, "y": 200, "width": 600, "height": 400},
}


def load_state():
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
            merged = dict(DEFAULT_STATE)
            merged.update(saved)
            return merged
    except Exception:
        return dict(DEFAULT_STATE)


def save_state(st):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(st, f, indent=2)


state = load_state()

# ─── OpenRouter ───────────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
CLEANUP_MODEL = "stepfun/step-3.5-flash:free"


def get_openrouter_key():
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        cfg = os.path.expanduser("~/.config/demoprompter/config.json")
        try:
            with open(cfg) as f:
                key = json.load(f).get("openrouter_api_key", "")
        except Exception:
            pass
    return key

# ─── Overlay: non-activating floating panel ──────────────────────────────────


class OverlayPanel(AppKit.NSPanel):
    def canBecomeKeyWindow(self):
        return False

    def canBecomeMainWindow(self):
        return False


class OverlayView(AppKit.NSView):
    """Transparent rounded bg + scrolling NSTextView inside."""
    pass


# ─── App Delegate ─────────────────────────────────────────────────────────────


class AppDelegate(AppKit.NSObject):

    # ivars
    statusItem     = objc.ivar()
    editorWindow   = objc.ivar()
    overlayPanel   = objc.ivar()
    # editor refs
    notesTV        = objc.ivar()
    wordCountLabel = objc.ivar()
    playBtn        = objc.ivar()
    overlayBtn     = objc.ivar()
    speedSlider    = objc.ivar()
    speedLabel     = objc.ivar()
    fontSlider     = objc.ivar()
    fontLabel      = objc.ivar()
    opacitySlider  = objc.ivar()
    opacityLabel   = objc.ivar()
    # overlay refs
    overlayTextView = objc.ivar()
    scrollTimer     = objc.ivar()
    # AI / voice refs
    cleanBtn        = objc.ivar()
    voiceBtn        = objc.ivar()
    overlayPlayBtn  = objc.ivar()

    def applicationDidFinishLaunching_(self, notification):
        self.setupMainMenu()
        self.setupStatusItem()
        self.buildEditor()
        self.buildOverlay()
        self.startScrollTimer()
        setup_global_hotkey(self)
        print("DemoPrompter started", flush=True)

    # ── Main menu (needed for Cmd+V/C/X/A/Z to work) ────────────────────────

    def setupMainMenu(self):
        mainMenu = AppKit.NSMenu.alloc().init()
        editItem = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Edit", None, "")
        editMenu = AppKit.NSMenu.alloc().initWithTitle_("Edit")
        editMenu.addItemWithTitle_action_keyEquivalent_("Undo", "undo:", "z")
        editMenu.addItemWithTitle_action_keyEquivalent_("Cut", "cut:", "x")
        editMenu.addItemWithTitle_action_keyEquivalent_("Copy", "copy:", "c")
        editMenu.addItemWithTitle_action_keyEquivalent_("Paste", "paste:", "v")
        editMenu.addItemWithTitle_action_keyEquivalent_("Select All", "selectAll:", "a")
        editItem.setSubmenu_(editMenu)
        mainMenu.addItem_(editItem)
        AppKit.NSApp.setMainMenu_(mainMenu)

    # ── Menu bar icon ─────────────────────────────────────────────────────────

    def setupStatusItem(self):
        bar = AppKit.NSStatusBar.systemStatusBar()
        self.statusItem = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)
        btn = self.statusItem.button()
        img = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_(
            "note.text", "DemoPrompter"
        )
        if img:
            img.setSize_(Foundation.NSMakeSize(16, 16))
            btn.setImage_(img)
        else:
            btn.setTitle_("DP")
        btn.setTarget_(self)
        btn.setAction_("toggleEditor:")

    # ── Editor window ─────────────────────────────────────────────────────────

    def buildEditor(self):
        W, H = 340, 540
        panel = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            Foundation.NSMakeRect(0, 0, W, H),
            AppKit.NSWindowStyleMaskTitled
            | AppKit.NSWindowStyleMaskClosable
            | AppKit.NSWindowStyleMaskFullSizeContentView,
            AppKit.NSBackingStoreBuffered,
            False,
        )
        panel.setTitlebarAppearsTransparent_(True)
        panel.setTitleVisibility_(AppKit.NSWindowTitleHidden)
        panel.setLevel_(AppKit.NSFloatingWindowLevel)
        panel.setHidesOnDeactivate_(False)
        panel.setBackgroundColor_(AppKit.NSColor.colorWithWhite_alpha_(0.12, 1.0))

        cv = panel.contentView()

        y = H  # track vertical position from top

        # ── Title ──
        y -= 40
        title = self._label("DemoPrompter", x=16, y=y, w=200, h=22,
                             font=AppKit.NSFont.boldSystemFontOfSize_(13))
        title.setTextColor_(AppKit.NSColor.whiteColor())
        cv.addSubview_(title)

        self.wordCountLabel = self._label("0 words", x=220, y=y, w=100, h=22,
                                          font=AppKit.NSFont.systemFontOfSize_(11))
        self.wordCountLabel.setTextColor_(AppKit.NSColor.colorWithWhite_alpha_(1.0, 0.4))
        self.wordCountLabel.setAlignment_(AppKit.NSTextAlignmentRight)
        cv.addSubview_(self.wordCountLabel)

        # ── Divider ──
        y -= 6
        div = AppKit.NSBox.alloc().initWithFrame_(Foundation.NSMakeRect(16, y, W - 32, 1))
        div.setBoxType_(AppKit.NSBoxSeparator)
        cv.addSubview_(div)
        y -= 4

        # ── Notes NSTextView ──
        TV_H = 160
        y -= TV_H
        scrollView = AppKit.NSScrollView.alloc().initWithFrame_(
            Foundation.NSMakeRect(16, y, W - 32, TV_H)
        )
        scrollView.setHasVerticalScroller_(True)
        scrollView.setAutohidesScrollers_(True)
        scrollView.setBorderType_(AppKit.NSNoBorder)
        scrollView.setDrawsBackground_(False)

        tv = AppKit.NSTextView.alloc().initWithFrame_(
            Foundation.NSMakeRect(0, 0, W - 32, TV_H)
        )
        tv.setRichText_(False)
        tv.setFont_(AppKit.NSFont.systemFontOfSize_(13))
        tv.setTextColor_(AppKit.NSColor.whiteColor())
        tv.setBackgroundColor_(AppKit.NSColor.colorWithWhite_alpha_(1.0, 0.05))
        tv.setInsertionPointColor_(AppKit.NSColor.whiteColor())
        tv.setDrawsBackground_(True)
        tv.setDelegate_(self)
        tv.setAutomaticQuoteSubstitutionEnabled_(False)
        tv.setAutomaticDashSubstitutionEnabled_(False)
        if state["text"]:
            tv.setString_(state["text"])
        scrollView.setDocumentView_(tv)
        cv.addSubview_(scrollView)
        self.notesTV = tv

        y -= 12

        # ── Divider ──
        div2 = AppKit.NSBox.alloc().initWithFrame_(Foundation.NSMakeRect(16, y, W - 32, 1))
        div2.setBoxType_(AppKit.NSBoxSeparator)
        cv.addSubview_(div2)
        y -= 6

        # ── Sliders ──
        self.speedSlider, self.speedLabel = self._addSlider(
            cv, label="Speed", y=y, yH=24, minV=0.3, maxV=5.0, val=state["speed"],
            action="speedChanged:", fmt=lambda v: f"{v:.1f}x", W=W
        )
        y -= 30

        self.fontSlider, self.fontLabel = self._addSlider(
            cv, label="Size", y=y, yH=24, minV=14, maxV=40, val=state["fontSize"],
            action="fontChanged:", fmt=lambda v: f"{int(v)}pt", W=W
        )
        y -= 30

        self.opacitySlider, self.opacityLabel = self._addSlider(
            cv, label="Opacity", y=y, yH=24, minV=0.3, maxV=1.0, val=state["opacity"],
            action="opacityChanged:", fmt=lambda v: f"{int(v*100)}%", W=W
        )
        y -= 36

        # ── Divider ──
        div3 = AppKit.NSBox.alloc().initWithFrame_(Foundation.NSMakeRect(16, y, W - 32, 1))
        div3.setBoxType_(AppKit.NSBoxSeparator)
        cv.addSubview_(div3)
        y -= 8

        # ── Buttons row ──
        BW = (W - 32 - 16) // 3
        self.playBtn = self._button("▶ Play", x=16, y=y-28, w=BW, h=28,
                                    action="playPause:", primary=True)
        cv.addSubview_(self.playBtn)

        resetBtn = self._button("↺ Reset", x=16 + BW + 8, y=y-28, w=BW, h=28,
                                action="resetScroll:")
        cv.addSubview_(resetBtn)

        self.overlayBtn = self._button("👁 Show", x=16 + 2*(BW + 8), y=y-28, w=BW, h=28,
                                       action="toggleOverlay:")
        cv.addSubview_(self.overlayBtn)
        y -= 40

        # ── AI / Voice row ──
        AI_BW = (W - 32 - 8) // 2
        self.cleanBtn = self._button("✨ Clean", x=16, y=y-28, w=AI_BW, h=28,
                                     action="cleanupText:")
        cv.addSubview_(self.cleanBtn)

        self.voiceBtn = self._button("🎤 Voice", x=16 + AI_BW + 8, y=y-28, w=AI_BW, h=28,
                                     action="toggleVoice:")
        cv.addSubview_(self.voiceBtn)
        y -= 40

        # ── Hotkey hint ──
        hint = self._label("⌘⇧P to toggle overlay", x=16, y=y-18, w=W-32, h=16,
                           font=AppKit.NSFont.systemFontOfSize_(10))
        hint.setTextColor_(AppKit.NSColor.colorWithWhite_alpha_(1.0, 0.3))
        cv.addSubview_(hint)
        y -= 24

        panel.setDelegate_(self)
        self.editorWindow = panel

    @objc.python_method
    def _label(self, text, x, y, w, h, font=None):
        f = AppKit.NSTextField.alloc().initWithFrame_(Foundation.NSMakeRect(x, y, w, h))
        f.setStringValue_(text)
        f.setBezeled_(False)
        f.setDrawsBackground_(False)
        f.setEditable_(False)
        f.setSelectable_(False)
        if font:
            f.setFont_(font)
        else:
            f.setFont_(AppKit.NSFont.systemFontOfSize_(11))
        f.setTextColor_(AppKit.NSColor.colorWithWhite_alpha_(1.0, 0.6))
        return f

    @objc.python_method
    def _button(self, title, x, y, w, h, action, primary=False):
        btn = AppKit.NSButton.alloc().initWithFrame_(Foundation.NSMakeRect(x, y, w, h))
        btn.setTitle_(title)
        btn.setBezelStyle_(AppKit.NSBezelStyleRounded)
        btn.setFont_(AppKit.NSFont.systemFontOfSize_(12))
        btn.setTarget_(self)
        btn.setAction_(action)
        if primary:
            btn.setKeyEquivalent_("\r")
        return btn

    @objc.python_method
    def _addSlider(self, parent, label, y, yH, minV, maxV, val, action, fmt, W):
        lbl = self._label(label, x=16, y=y - yH, w=52, h=yH)
        parent.addSubview_(lbl)

        slider = AppKit.NSSlider.alloc().initWithFrame_(
            Foundation.NSMakeRect(72, y - yH, W - 72 - 52, yH)
        )
        slider.setMinValue_(minV)
        slider.setMaxValue_(maxV)
        slider.setFloatValue_(val)
        slider.setTarget_(self)
        slider.setAction_(action)
        parent.addSubview_(slider)

        valLbl = self._label(fmt(val), x=W - 52, y=y - yH, w=44, h=yH)
        valLbl.setAlignment_(AppKit.NSTextAlignmentRight)
        parent.addSubview_(valLbl)

        return slider, valLbl

    # ── Overlay panel ─────────────────────────────────────────────────────────

    def buildOverlay(self):
        b = state["overlayBounds"]
        rect = Foundation.NSMakeRect(b["x"], b["y"], b["width"], b["height"])

        panel = OverlayPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            rect,
            AppKit.NSWindowStyleMaskBorderless | AppKit.NSWindowStyleMaskResizable | AppKit.NSWindowStyleMaskNonactivatingPanel,
            AppKit.NSBackingStoreBuffered,
            False,
        )
        panel.setLevel_(AppKit.NSFloatingWindowLevel)
        panel.setOpaque_(False)
        panel.setBackgroundColor_(AppKit.NSColor.clearColor())
        panel.setMovableByWindowBackground_(True)
        panel.setHidesOnDeactivate_(False)
        panel.setCollectionBehavior_(
            AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
            | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary
        )

        # Container view with rounded dark bg
        container = OverlayView.alloc().initWithFrame_(
            Foundation.NSMakeRect(0, 0, b["width"], b["height"])
        )
        container.setAutoresizingMask_(
            AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable
        )

        # Button bar at bottom of overlay
        BAR_H = 28
        barView = AppKit.NSView.alloc().initWithFrame_(
            Foundation.NSMakeRect(8, 8, b["width"] - 16, BAR_H)
        )
        barView.setAutoresizingMask_(AppKit.NSViewWidthSizable)

        playB = AppKit.NSButton.alloc().initWithFrame_(
            Foundation.NSMakeRect(0, 0, 60, BAR_H)
        )
        playB.setTitle_("⏸" if state["isScrolling"] else "▶")
        playB.setBezelStyle_(AppKit.NSBezelStyleInline)
        playB.setFont_(AppKit.NSFont.systemFontOfSize_(14))
        playB.setBordered_(False)
        playB.setTarget_(self)
        playB.setAction_("overlayPlayPause:")
        barView.addSubview_(playB)
        self.overlayPlayBtn = playB

        resetB = AppKit.NSButton.alloc().initWithFrame_(
            Foundation.NSMakeRect(64, 0, 40, BAR_H)
        )
        resetB.setTitle_("↺")
        resetB.setBezelStyle_(AppKit.NSBezelStyleInline)
        resetB.setFont_(AppKit.NSFont.systemFontOfSize_(14))
        resetB.setBordered_(False)
        resetB.setTarget_(self)
        resetB.setAction_("resetScroll:")
        barView.addSubview_(resetB)

        container.addSubview_(barView)

        # NSTextView for text display (no scrollbars shown, scroll programmatically)
        scrollV = AppKit.NSScrollView.alloc().initWithFrame_(
            Foundation.NSMakeRect(8, 8 + BAR_H + 4, b["width"] - 16, b["height"] - 16 - BAR_H - 4)
        )
        scrollV.setHasVerticalScroller_(False)
        scrollV.setHasHorizontalScroller_(False)
        scrollV.setDrawsBackground_(False)
        scrollV.setBorderType_(AppKit.NSNoBorder)
        scrollV.setAutoresizingMask_(
            AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable
        )

        tv = AppKit.NSTextView.alloc().initWithFrame_(
            Foundation.NSMakeRect(0, 0, b["width"] - 16, b["height"] - 16)
        )
        tv.setEditable_(False)
        tv.setSelectable_(False)
        tv.setRichText_(False)
        tv.setFont_(AppKit.NSFont.systemFontOfSize_(state["fontSize"]))
        tv.setTextColor_(AppKit.NSColor.whiteColor())
        tv.setBackgroundColor_(AppKit.NSColor.clearColor())
        tv.setDrawsBackground_(False)
        tv.setAutoresizingMask_(AppKit.NSViewWidthSizable)
        if state["text"]:
            tv.setString_(state["text"])

        scrollV.setDocumentView_(tv)
        container.addSubview_(scrollV)
        panel.setContentView_(container)

        self.overlayPanel = panel
        self.overlayTextView = tv
        self._overlayScrollView = scrollV

        # Track moves for state persistence
        AppKit.NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
            self, "overlayMoved:", AppKit.NSWindowDidMoveNotification, panel
        )
        AppKit.NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
            self, "overlayResized:", AppKit.NSWindowDidResizeNotification, panel
        )

        self._refreshOverlay()

    @objc.python_method
    def _refreshOverlay(self):
        """Update overlay text, font, and background opacity."""
        if not self.overlayTextView:
            return
        tv = self.overlayTextView
        tv.setFont_(AppKit.NSFont.systemFontOfSize_(state["fontSize"]))
        if not state.get("voiceTracking", False):
            tv.setString_(state["text"] or "")
        # Update bg
        cv = self.overlayPanel.contentView()
        bg = AppKit.NSColor.colorWithWhite_alpha_(0.0, state["opacity"])
        path = AppKit.NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
            cv.bounds(), 12, 12
        )
        # Draw via layer background
        cv.setWantsLayer_(True)
        cv.layer().setBackgroundColor_(
            AppKit.NSColor.colorWithWhite_alpha_(0.0, state["opacity"]).CGColor()
        )
        cv.layer().setCornerRadius_(12)

    # ── Scroll timer ──────────────────────────────────────────────────────────

    def startScrollTimer(self):
        self.scrollTimer = Foundation.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            1.0 / 30.0, self, "scrollTick:", None, True
        )

    def scrollTick_(self, timer):
        if not state["isScrolling"] or not self.overlayTextView:
            return
        tv = self.overlayTextView
        # pixels per tick = speed * 30 / 30fps = speed pixels/sec
        state["scrollOffset"] += state["speed"]
        # Clamp to content height
        content_h = tv.frame().size.height
        visible_h = self._overlayScrollView.frame().size.height
        max_scroll = max(0, content_h - visible_h)
        if state["scrollOffset"] >= max_scroll:
            state["scrollOffset"] = max_scroll
            state["isScrolling"] = False
            AppKit.NSOperationQueue.mainQueue().addOperationWithBlock_(self._updatePlayBtn)
        pt = Foundation.NSMakePoint(0, state["scrollOffset"])
        tv.scrollPoint_(pt)

    @objc.python_method
    def _updatePlayBtn(self):
        self._syncPlayButtons()

    # ── Voice tracking helpers ─────────────────────────────────────────────────

    @objc.python_method
    def _showSpeechPermissionAlert(self):
        self.voiceBtn.setTitle_("🎤 Voice")
        alert = AppKit.NSAlert.alloc().init()
        alert.setMessageText_("Speech Recognition Access Denied")
        alert.setInformativeText_(
            "DemoPrompter was denied speech recognition access.\n\n"
            "To fix: System Settings → Privacy & Security → Speech Recognition\n"
            "→ Enable the toggle next to Terminal (or iTerm2).\n\n"
            "Then click 🎤 Voice again."
        )
        alert.addButtonWithTitle_("Open Settings")
        alert.addButtonWithTitle_("Cancel")
        if alert.runModal() == AppKit.NSAlertFirstButtonReturn:
            AppKit.NSWorkspace.sharedWorkspace().openURL_(
                Foundation.NSURL.URLWithString_(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
                )
            )

    @objc.python_method
    def _beginListening(self):
        try:
            recognizer = Speech.SFSpeechRecognizer.alloc().init()
            if not recognizer or not recognizer.isAvailable():
                print("[Voice] SFSpeechRecognizer not available", flush=True)
                self.voiceBtn.setTitle_("🎤 Voice")
                return

            engine = AVFoundation.AVAudioEngine.alloc().init()
            request = Speech.SFSpeechAudioBufferRecognitionRequest.alloc().init()
            request.setShouldReportPartialResults_(True)

            input_node = engine.inputNode()
            fmt = input_node.outputFormatForBus_(0)

            def tap(buf, time):
                request.appendAudioPCMBuffer_(buf)

            input_node.installTapOnBus_bufferSize_format_block_(0, 1024, fmt, tap)
            engine.startAndReturnError_(None)

            sentences = self._splitSentences(state.get("text", ""))
            state["_sentences"] = sentences
            state["currentSentenceIdx"] = 0

            def on_result(result, error):
                if result:
                    transcript = str(result.bestTranscription().formattedString())
                    idx = self._matchSentence(transcript, sentences)
                    if idx != state.get("currentSentenceIdx", 0):
                        state["currentSentenceIdx"] = idx
                        AppKit.NSOperationQueue.mainQueue().addOperationWithBlock_(
                            self._updateOverlayHighlight
                        )

            task = recognizer.recognitionTaskWithRequest_resultHandler_(request, on_result)

            # Store refs to keep them alive
            self._speech_recognizer = recognizer
            self._audio_engine = engine
            self._recognition_request = request
            self._recognition_task = task

            state["voiceTracking"] = True
            self.voiceBtn.setTitle_("🔴 Stop")
            self._updateOverlayHighlight()
            print("[Voice] Listening started", flush=True)

        except Exception as e:
            print(f"[Voice] Error starting: {e}", flush=True)
            self.voiceBtn.setTitle_("🎤 Voice")

    @objc.python_method
    def _stopVoiceTracking(self):
        task = getattr(self, "_recognition_task", None)
        if task:
            task.cancel()
            self._recognition_task = None

        req = getattr(self, "_recognition_request", None)
        if req:
            req.endAudio()
            self._recognition_request = None

        engine = getattr(self, "_audio_engine", None)
        if engine:
            try:
                engine.inputNode().removeTapOnBus_(0)
            except Exception:
                pass
            engine.stop()
            self._audio_engine = None

        self._speech_recognizer = None
        state["voiceTracking"] = False
        state.pop("_sentences", None)
        state["currentSentenceIdx"] = 0
        self.voiceBtn.setTitle_("🎤 Voice")
        # Restore plain text overlay
        if self.overlayTextView:
            self.overlayTextView.setString_(state.get("text", ""))
        print("[Voice] Stopped", flush=True)

    @objc.python_method
    def _splitSentences(self, text):
        if not text:
            return []
        parts = re.split(r'(?<=[.!?])\s+|\n+', text.strip())
        return [p.strip() for p in parts if p.strip()]

    @objc.python_method
    def _matchSentence(self, transcript, sentences):
        """
        Fuzzy-match the running transcript against sentences.
        Uses last ~20 words of transcript compared against each sentence's
        first ~12 words, with partial-word tolerance via SequenceMatcher.
        Only advances forward — never jumps back more than 1 sentence.
        """
        if not sentences:
            return 0
        t_words = transcript.lower().split()
        # Use a longer tail of transcript for better context
        tail = t_words[-20:] if len(t_words) > 20 else t_words
        current = state.get("currentSentenceIdx", 0)
        best_idx = current
        best_score = 0.0
        # Allow matching 1 sentence back (re-check current), but never earlier
        start = max(0, current - 1)
        for i in range(start, len(sentences)):
            s_words = sentences[i].lower().split()
            # Compare against first N words of the sentence (enough to identify it)
            n = min(len(s_words), 12)
            # Also try the last n words of tail vs start of sentence
            window = tail[-n:] if len(tail) >= n else tail
            score = difflib.SequenceMatcher(None, window, s_words[:n]).ratio()
            # Bonus: if any of the sentence's distinctive words appear in tail
            distinctive = [w for w in s_words[:n] if len(w) > 4]
            if distinctive:
                hits = sum(1 for w in distinctive if w in tail)
                score += 0.15 * (hits / len(distinctive))
            if score > best_score:
                best_score = score
                best_idx = i
        # Lower threshold since speech is inherently imprecise
        return best_idx if best_score > 0.2 else current

    @objc.python_method
    def _updateOverlayHighlight(self):
        sentences = state.get("_sentences", [])
        if not sentences or not self.overlayTextView:
            return
        current = state.get("currentSentenceIdx", 0)
        fs = state.get("fontSize", 22)

        full = AppKit.NSMutableAttributedString.alloc().init()
        for i, sentence in enumerate(sentences):
            alpha = 1.0 if i == current else (0.3 if i < current else 0.6)
            attrs = {
                AppKit.NSForegroundColorAttributeName: AppKit.NSColor.colorWithWhite_alpha_(1.0, alpha),
                AppKit.NSFontAttributeName: AppKit.NSFont.systemFontOfSize_(fs),
            }
            chunk = AppKit.NSAttributedString.alloc().initWithString_attributes_(
                sentence + "\n", attrs
            )
            full.appendAttributedString_(chunk)

        self.overlayTextView.textStorage().setAttributedString_(full)

        # Scroll to keep current sentence visible
        if current > 0:
            offset = sum(len(sentences[j]) + 1 for j in range(current))
            self.overlayTextView.scrollRangeToVisible_(
                Foundation.NSMakeRange(offset, len(sentences[current]))
            )

    # ── NSTextViewDelegate ────────────────────────────────────────────────────

    def textDidChange_(self, notification):
        text = self.notesTV.string()
        state["text"] = str(text)
        words = len(text.split()) if text.strip() else 0
        self.wordCountLabel.setStringValue_(f"{words} words")
        # Update overlay (skip if voice tracking is managing it)
        if self.overlayTextView and not state.get("voiceTracking", False):
            self.overlayTextView.setString_(str(text))
        save_state(state)

    # ── Button actions ────────────────────────────────────────────────────────

    def toggleEditor_(self, sender):
        if self.editorWindow.isVisible():
            self.editorWindow.orderOut_(None)
        else:
            btn = self.statusItem.button()
            br = btn.window().convertRectToScreen_(btn.frame())
            ex = br.origin.x - 150
            ey = br.origin.y - 504
            self.editorWindow.setFrameOrigin_(Foundation.NSMakePoint(ex, ey))
            AppKit.NSApp.activateIgnoringOtherApps_(True)
            self.editorWindow.makeKeyAndOrderFront_(None)
            self.editorWindow.makeFirstResponder_(self.notesTV)

    def playPause_(self, sender):
        state["isScrolling"] = not state["isScrolling"]
        self._syncPlayButtons()
        save_state(state)

    def overlayPlayPause_(self, sender):
        state["isScrolling"] = not state["isScrolling"]
        self._syncPlayButtons()
        save_state(state)

    @objc.python_method
    def _syncPlayButtons(self):
        playing = state["isScrolling"]
        self.playBtn.setTitle_("⏸ Pause" if playing else "▶ Play")
        if self.overlayPlayBtn:
            self.overlayPlayBtn.setTitle_("⏸" if playing else "▶")

    def resetScroll_(self, sender):
        state["isScrolling"] = False
        state["scrollOffset"] = 0.0
        self._syncPlayButtons()
        if self.overlayTextView:
            self.overlayTextView.scrollPoint_(Foundation.NSMakePoint(0, 0))
        save_state(state)

    def toggleOverlay_(self, sender):
        if self.overlayPanel.isVisible():
            self.overlayPanel.orderOut_(None)
            state["isOverlayVisible"] = False
            if self.overlayBtn:
                self.overlayBtn.setTitle_("👁 Show")
        else:
            self._refreshOverlay()
            self.overlayPanel.orderFront_(None)
            state["isOverlayVisible"] = True
            if self.overlayBtn:
                self.overlayBtn.setTitle_("👁 Hide")
        save_state(state)

    def speedChanged_(self, sender):
        v = sender.floatValue()
        state["speed"] = float(v)
        self.speedLabel.setStringValue_(f"{v:.1f}x")
        save_state(state)

    def fontChanged_(self, sender):
        v = int(sender.intValue())
        state["fontSize"] = v
        self.fontLabel.setStringValue_(f"{v}pt")
        if self.overlayTextView:
            self.overlayTextView.setFont_(AppKit.NSFont.systemFontOfSize_(v))
        save_state(state)

    def opacityChanged_(self, sender):
        v = sender.floatValue()
        state["opacity"] = float(v)
        self.opacityLabel.setStringValue_(f"{int(v*100)}%")
        self._refreshOverlay()
        save_state(state)

    def quitApp_(self, sender):
        AppKit.NSApp.terminate_(None)

    # ── AI text cleanup ───────────────────────────────────────────────────────

    def cleanupText_(self, sender):
        text = state.get("text", "").strip()
        if not text:
            return
        key = get_openrouter_key()
        if not key:
            self.cleanBtn.setTitle_("No API key")
            Foundation.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                2.0, self, "resetCleanBtn:", None, False
            )
            return
        self.cleanBtn.setTitle_("...")
        self.cleanBtn.setEnabled_(False)

        def run():
            try:
                import requests as req
                resp = req.post(
                    OPENROUTER_URL,
                    json={
                        "model": CLEANUP_MODEL,
                        "messages": [
                            {"role": "system", "content": (
                                "You are a teleprompter script editor. The user will give you rough "
                                "stream-of-consciousness notes they jotted before a demo or presentation. "
                                "Your job:\n"
                                "1. Keep their voice, tone, and word choices intact — do not sanitize or formalize.\n"
                                "2. Remove filler, repetition, and tangents. Keep the signal.\n"
                                "3. Organize into a natural spoken flow — short punchy sentences, not bullet points.\n"
                                "4. Each sentence should stand alone as a readable teleprompter line.\n"
                                "5. Do NOT add intro/outro phrases like 'Sure!' or 'Here's the cleaned version:'.\n"
                                "6. Output plain text only. No markdown, no headers, no bullets.\n"
                                "The result should sound exactly like the user talking — just without the mess."
                            )},
                            {"role": "user", "content": text},
                        ],
                    },
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=30,
                )
                result = resp.json()["choices"][0]["message"]["content"]
                self.performSelectorOnMainThread_withObject_waitUntilDone_(
                    "applyCleanedText:", result, False
                )
            except Exception as e:
                print(f"[AI cleanup error] {e}", flush=True)
                self.performSelectorOnMainThread_withObject_waitUntilDone_(
                    "applyCleanedText:", "", False
                )

        threading.Thread(target=run, daemon=True).start()

    def applyCleanedText_(self, result):
        self.cleanBtn.setTitle_("✨ Clean")
        self.cleanBtn.setEnabled_(True)
        if result:
            state["text"] = str(result)
            self.notesTV.setString_(str(result))
            words = len(result.split()) if result.strip() else 0
            self.wordCountLabel.setStringValue_(f"{words} words")
            if self.overlayTextView:
                self.overlayTextView.setString_(str(result))
            save_state(state)

    def resetCleanBtn_(self, timer):
        self.cleanBtn.setTitle_("✨ Clean")

    # ── Voice-tracked scrolling ───────────────────────────────────────────────

    def toggleVoice_(self, sender):
        if not SPEECH_AVAILABLE:
            self.voiceBtn.setTitle_("Unavailable")
            Foundation.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                2.0, self, "resetVoiceBtn:", None, False
            )
            return
        if state.get("voiceTracking", False):
            self._stopVoiceTracking()
        else:
            state["isScrolling"] = False
            self.playBtn.setTitle_("▶ Play")
            status = Speech.SFSpeechRecognizer.authorizationStatus()
            if status == 3:  # SFSpeechRecognizerAuthorizationStatusAuthorized
                AppKit.NSOperationQueue.mainQueue().addOperationWithBlock_(self._beginListening)
            elif status == 2:  # SFSpeechRecognizerAuthorizationStatusDenied
                self._showSpeechPermissionAlert()
            else:
                # NotDetermined (0) or Restricted (1) — request permission now
                def auth_callback(auth_status):
                    if auth_status == 3:
                        AppKit.NSOperationQueue.mainQueue().addOperationWithBlock_(self._beginListening)
                    else:
                        AppKit.NSOperationQueue.mainQueue().addOperationWithBlock_(self._showSpeechPermissionAlert)
                Speech.SFSpeechRecognizer.requestAuthorization_(auth_callback)

    def resetVoiceBtn_(self, timer):
        self.voiceBtn.setTitle_("🎤 Voice")

    # ── Overlay move/resize tracking ──────────────────────────────────────────

    def overlayMoved_(self, notification):
        f = self.overlayPanel.frame()
        state["overlayBounds"]["x"] = int(f.origin.x)
        state["overlayBounds"]["y"] = int(f.origin.y)
        save_state(state)

    def overlayResized_(self, notification):
        f = self.overlayPanel.frame()
        state["overlayBounds"]["width"] = int(f.size.width)
        state["overlayBounds"]["height"] = int(f.size.height)
        save_state(state)


# ─── Global hotkey ────────────────────────────────────────────────────────────


def setup_global_hotkey(delegate):
    mask = AppKit.NSEventModifierFlagCommand | AppKit.NSEventModifierFlagShift
    key_p = 35

    def handler(event):
        if (event.modifierFlags() & mask) == mask and event.keyCode() == key_p:
            AppKit.NSOperationQueue.mainQueue().addOperationWithBlock_(
                lambda: delegate.toggleOverlay_(None)
            )

    AppKit.NSEvent.addGlobalMonitorForEventsMatchingMask_handler_(
        AppKit.NSEventMaskKeyDown, handler
    )


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)

    delegate = AppDelegate.alloc().init()
    app.setDelegate_(delegate)
    app.run()


if __name__ == "__main__":
    main()
