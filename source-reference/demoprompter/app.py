#!/usr/bin/env python3
"""DemoPrompter — Floating teleprompter overlay for demo recordings."""

import json
import os
import sys
import objc
import AppKit
import Foundation
import WebKit

# ─── State ───────────────────────────────────────────────────────────────────

STATE_DIR = os.path.expanduser("~/Library/Application Support/DemoPrompter")
STATE_FILE = os.path.join(STATE_DIR, "state.json")

DEFAULT_STATE = {
    "text": "",
    "speed": 1.5,
    "fontSize": 22,
    "opacity": 0.82,
    "isScrolling": False,
    "scrollOffset": 0,
    "isOverlayVisible": False,
    "overlayBounds": {"x": 100, "y": 300, "width": 340, "height": 240},
}


def load_state():
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
            return {**DEFAULT_STATE, **saved}
    except Exception:
        return dict(DEFAULT_STATE)


def save_state(state):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


state = load_state()

# ─── HTML paths ──────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EDITOR_HTML = os.path.join(SCRIPT_DIR, "editor.html")
OVERLAY_HTML = os.path.join(SCRIPT_DIR, "overlay.html")

# ─── Script Message Handler (JS → Python bridge) ────────────────────────────


_message_callbacks = {}


class JsonMessageHandler(AppKit.NSObject):
    """Handles postMessage from JS via WKScriptMessageHandler."""

    def userContentController_didReceiveScriptMessage_(self, controller, message):
        cb = _message_callbacks.get(id(self))
        if cb:
            cb(message.body())


def make_message_handler(callback):
    handler = JsonMessageHandler.alloc().init()
    _message_callbacks[id(handler)] = callback
    return handler


# ─── WebView Factory ─────────────────────────────────────────────────────────


def make_webview(html_path, message_handler, handler_name="prompterBridge", transparent=False):
    config = WebKit.WKWebViewConfiguration.alloc().init()
    user_content = config.userContentController()
    user_content.addScriptMessageHandler_name_(message_handler, handler_name)

    # Inject bridge: window.prompter.updateState / toggleOverlay / onStateUpdate
    bridge_js = """
    window.prompter = {
        _listeners: [],
        updateState: function(partial) {
            window.webkit.messageHandlers.prompterBridge.postMessage({
                type: 'updateState', data: partial
            });
        },
        toggleOverlay: function() {
            window.webkit.messageHandlers.prompterBridge.postMessage({
                type: 'toggleOverlay'
            });
        },
        onStateUpdate: function(cb) {
            window.prompter._listeners.push(cb);
        },
        _pushState: function(state) {
            window.prompter._listeners.forEach(function(cb) { cb(state); });
        }
    };
    """
    script = WebKit.WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(
        bridge_js, WebKit.WKUserScriptInjectionTimeAtDocumentStart, True
    )
    user_content.addUserScript_(script)

    webview = WebKit.WKWebView.alloc().initWithFrame_configuration_(
        Foundation.NSMakeRect(0, 0, 100, 100), config
    )

    if transparent:
        webview.setValue_forKey_(False, "drawsBackground")
        webview._setDrawsTransparentBackground_(True) if hasattr(webview, '_setDrawsTransparentBackground_') else None

    url = Foundation.NSURL.fileURLWithPath_(html_path)
    webview.loadFileURL_allowingReadAccessToURL_(url, Foundation.NSURL.fileURLWithPath_(SCRIPT_DIR))
    webview.setAutoresizingMask_(AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable)

    return webview


# ─── Overlay Panel ───────────────────────────────────────────────────────────


class OverlayPanel(AppKit.NSPanel):
    def canBecomeKeyWindow(self):
        return False

    def canBecomeMainWindow(self):
        return False


# ─── App Delegate ────────────────────────────────────────────────────────────


class AppDelegate(AppKit.NSObject):
    statusItem = objc.ivar()
    overlayPanel = objc.ivar()
    editorWindow = objc.ivar()
    overlayWebView = objc.ivar()
    editorWebView = objc.ivar()

    def applicationDidFinishLaunching_(self, notification):
        self.setupStatusItem()
        self.setupOverlay()
        self.setupEditor()
        setup_hotkey(self)

    # ── Status Bar ──

    def setupStatusItem(self):
        bar = AppKit.NSStatusBar.systemStatusBar()
        self.statusItem = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)
        button = self.statusItem.button()
        # Use SF Symbol or fallback text
        image = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_("text.alignleft", "DemoPrompter")
        if image:
            image.setSize_(Foundation.NSMakeSize(16, 16))
            button.setImage_(image)
        else:
            button.setTitle_("DP")
        button.setTarget_(self)
        button.setAction_("toggleEditor:")

    # ── Overlay ──

    def setupOverlay(self):
        bounds = state.get("overlayBounds", DEFAULT_STATE["overlayBounds"])
        rect = Foundation.NSMakeRect(bounds["x"], bounds["y"], bounds["width"], bounds["height"])

        self.overlayPanel = OverlayPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            rect,
            AppKit.NSWindowStyleMaskBorderless
            | AppKit.NSWindowStyleMaskNonactivatingPanel
            | AppKit.NSWindowStyleMaskHUDWindow,
            AppKit.NSBackingStoreBuffered,
            False,
        )
        self.overlayPanel.setLevel_(AppKit.NSFloatingWindowLevel)
        self.overlayPanel.setOpaque_(False)
        self.overlayPanel.setBackgroundColor_(AppKit.NSColor.clearColor())
        self.overlayPanel.setMovableByWindowBackground_(True)
        self.overlayPanel.setHidesOnDeactivate_(False)
        self.overlayPanel.setCollectionBehavior_(
            AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
            | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary
        )

        handler = make_message_handler(self.handleOverlayMessage_)
        self.overlayWebView = make_webview(OVERLAY_HTML, handler, transparent=True)
        self.overlayPanel.setContentView_(self.overlayWebView)

        # Notify webview when it finishes loading
        self.overlayWebView.setNavigationDelegate_(self)

        # Save position on move
        AppKit.NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
            self, "overlayDidMove:", AppKit.NSWindowDidMoveNotification, self.overlayPanel
        )
        AppKit.NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
            self, "overlayDidResize:", AppKit.NSWindowDidResizeNotification, self.overlayPanel
        )

    def overlayDidMove_(self, notification):
        frame = self.overlayPanel.frame()
        state["overlayBounds"]["x"] = int(frame.origin.x)
        state["overlayBounds"]["y"] = int(frame.origin.y)
        save_state(state)

    def overlayDidResize_(self, notification):
        frame = self.overlayPanel.frame()
        state["overlayBounds"]["width"] = int(frame.size.width)
        state["overlayBounds"]["height"] = int(frame.size.height)
        save_state(state)

    def handleOverlayMessage_(self, body):
        msg_type = body.get("type", "")
        if msg_type == "updateState":
            self.mergeState_(body.get("data", {}))

    # ── Editor ──

    def setupEditor(self):
        rect = Foundation.NSMakeRect(0, 0, 360, 520)
        style = (
            AppKit.NSWindowStyleMaskTitled
            | AppKit.NSWindowStyleMaskClosable
            | AppKit.NSWindowStyleMaskFullSizeContentView
        )
        self.editorWindow = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            rect, style, AppKit.NSBackingStoreBuffered, False
        )
        self.editorWindow.setTitlebarAppearsTransparent_(True)
        self.editorWindow.setTitleVisibility_(AppKit.NSWindowTitleHidden)
        self.editorWindow.setLevel_(AppKit.NSFloatingWindowLevel)
        self.editorWindow.setHidesOnDeactivate_(False)

        handler = make_message_handler(self.handleEditorMessage_)
        self.editorWebView = make_webview(EDITOR_HTML, handler)
        self.editorWindow.setContentView_(self.editorWebView)
        self.editorWebView.setNavigationDelegate_(self)
        self.editorWebView.setUIDelegate_(self)

    def handleEditorMessage_(self, body):
        msg_type = body.get("type", "")
        if msg_type == "updateState":
            self.mergeState_(body.get("data", {}))
        elif msg_type == "toggleOverlay":
            self.toggleOverlay_(None)

    # ── State sync ──

    def mergeState_(self, partial):
        global state
        state.update(partial)
        save_state(state)
        self.pushStateToOverlay()
        self.pushStateToEditor()

    def pushStateToOverlay(self):
        if self.overlayWebView:
            js = "if(window.prompter) window.prompter._pushState(%s);" % json.dumps(state)
            self.overlayWebView.evaluateJavaScript_completionHandler_(js, None)

    def pushStateToEditor(self):
        if self.editorWebView:
            js = "if(window.prompter) window.prompter._pushState(%s);" % json.dumps(state)
            self.editorWebView.evaluateJavaScript_completionHandler_(js, None)

    # ── WKNavigationDelegate ──

    def webView_didFinishNavigation_(self, webView, navigation):
        js = "if(window.prompter) window.prompter._pushState(%s);" % json.dumps(state)
        webView.evaluateJavaScript_completionHandler_(js, None)

    # WKUIDelegate — catches JS alert/error messages
    def webView_runJavaScriptAlertPanelWithMessage_initiatedByFrame_completionHandler_(
        self, webView, message, frame, handler
    ):
        print("[JS alert]", message, flush=True)
        if handler:
            handler()

    # ── Actions ──

    def toggleEditor_(self, sender):
        if self.editorWindow.isVisible():
            self.editorWindow.orderOut_(None)
        else:
            # Position near status bar
            button = self.statusItem.button()
            button_rect = button.window().convertRectToScreen_(button.frame())
            ex = button_rect.origin.x - 150
            ey = button_rect.origin.y - 524
            self.editorWindow.setFrameOrigin_(Foundation.NSMakePoint(ex, ey))
            self.editorWindow.makeKeyAndOrderFront_(None)
            self.pushStateToEditor()

    def toggleOverlay_(self, sender):
        global state
        if self.overlayPanel.isVisible():
            self.overlayPanel.orderOut_(None)
            state["isOverlayVisible"] = False
        else:
            self.overlayPanel.orderFront_(None)
            state["isOverlayVisible"] = True
            self.pushStateToOverlay()
        save_state(state)
        self.pushStateToEditor()

    def quitApp_(self, sender):
        AppKit.NSApp.terminate_(None)


# ─── Global Hotkey ───────────────────────────────────────────────────────────


def setup_hotkey(delegate):
    # Cmd+Shift+P → toggle overlay
    mask = AppKit.NSEventModifierFlagCommand | AppKit.NSEventModifierFlagShift
    key_code_p = 35  # 'P'

    def handler(event):
        if event.modifierFlags() & mask == mask and event.keyCode() == key_code_p:
            delegate.toggleOverlay_(None)

    AppKit.NSEvent.addGlobalMonitorForEventsMatchingMask_handler_(
        AppKit.NSEventMaskKeyDown, handler
    )
    AppKit.NSEvent.addLocalMonitorForEventsMatchingMask_handler_(
        AppKit.NSEventMaskKeyDown,
        lambda event: (handler(event), None)[-1] if event.modifierFlags() & mask == mask and event.keyCode() == key_code_p else event
    )


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)

    delegate = AppDelegate.alloc().init()
    app.setDelegate_(delegate)
    app.run()


if __name__ == "__main__":
    main()
