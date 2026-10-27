import AppKit
import SwiftUI

/// The panel under a menu bar icon, which behaves as a menu does: Escape and a click outside close it, the arrow keys
/// and Return work, ⌘ and a footer item's key run it, and it takes the keys without making the app active, so the app
/// the person was in stays in front. It never shows a Dock icon (the app's Info.plist sets LSUIElement).
@MainActor
public final class MenuBarPanel: NSPanel {
    /// Set by tests: `open` places the panel and marks it open without putting it on the screen, and no event monitor is
    /// installed. Nothing a check runs may appear on the person's screen.
    public static var staysOffScreen = false

    public let state: PanelState
    /// Called on Escape before the panel closes; true when the content handled it, as a page going back to its list.
    public var onEscape: (() -> Bool)?
    /// Called as a closed panel opens, before it is sized and shown, so what it changes draws in the first frame: the
    /// place to read what SwiftUI cannot observe, and to hold a list still while the panel is open.
    public var onOpen: (() -> Void)?
    /// Called once the panel has closed, however it closed.
    public var onClose: (() -> Void)?
    public private(set) var isOpen = false

    private let width: CGFloat
    private var intent = PointerIntent()
    private var intentTimer: Timer?
    private var monitors: [Any] = []
    /// The icon's rect in screen coordinates while open: a click there is the icon's own, never "outside".
    private var buttonRect: NSRect?
    private weak var statusItem: NSStatusItem?
    private var hookup: AnyObject?

    public init<Content: View>(width: CGFloat, state: PanelState? = nil, @ViewBuilder content: () -> Content) {
        let state = state ?? PanelState()
        self.width = width
        self.state = state
        super.init(contentRect: NSRect(x: 0, y: 0, width: width, height: 1), styleMask: Self.style, backing: .buffered, defer: true)
        isFloatingPanel = true
        level = Self.windowLevel
        collectionBehavior = Self.spaces
        hidesOnDeactivate = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        acceptsMouseMovedEvents = true
        isReleasedWhenClosed = false
        let root = PanelRoot(width: width, state: state, content: content())
        let hosting = NSHostingView(rootView: root)
        hosting.sizingOptions = []
        contentView = hosting
        state.resized = { [weak self] in self?.fit() }
    }

    /// Borderless, and non-activating so it takes the keys while another app stays active.
    static let style: NSWindow.StyleMask = [.borderless, .nonactivatingPanel]
    static let windowLevel: NSWindow.Level = .statusBar
    /// On whichever Space is in front, over a full-screen app too, and not one of the windows ⌘` cycles through.
    static let spaces: NSWindow.CollectionBehavior = [.auxiliary, .stationary, .moveToActiveSpace, .fullScreenAuxiliary]

    public override var canBecomeKey: Bool { true }
    public override var canBecomeMain: Bool { false }

    /// Opens and closes from `item`'s icon. On macOS 27 and later the icon's expanded interface session drives it, as
    /// Apple's header asks of a status item that shows its own window; before that, the icon's button action toggles it.
    /// Only the macOS 27 SDK declares the session, so a build with an older SDK always takes the button action.
    public func attach(to item: NSStatusItem) {
        statusItem = item
        #if canImport(AppKit, _version: 2700)
        if #available(macOS 27, *) {
            let session = ExpandedInterface(panel: self)
            hookup = session
            item.expandedInterfaceDelegate = session
            return
        }
        #endif
        item.button?.target = self
        item.button?.action = #selector(toggleFromIcon)
    }

    @objc private func toggleFromIcon() {
        if isOpen { close() } else if let item = statusItem { open(below: item) }
    }

    func open(below item: NSStatusItem) {
        guard let button = item.button, let window = button.window else { return }
        let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
        open(below: rect, in: (window.screen ?? NSScreen.main)?.visibleFrame ?? rect)
    }

    /// Opens with its top just under `button`, the icon's rect in screen coordinates, kept inside `visibleFrame`.
    public func open(below button: NSRect, in visibleFrame: NSRect) {
        // Opened again while open, as by a second session: one set of monitors, not two, and the content left as it is.
        if !isOpen { onOpen?() }
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        buttonRect = button
        state.maxHeight = Self.maxHeight(below: button, in: visibleFrame)
        fit(top: button.minY - Self.gap, visibleFrame: visibleFrame)
        intent.reset()
        isOpen = true
        guard !Self.staysOffScreen else { return }
        let outside: (NSEvent) -> Void = { [weak self] _ in self?.clicked(at: NSEvent.mouseLocation) }
        monitors = [
            NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: outside) as Any,
            NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
                if event.window !== self { self?.clicked(at: NSEvent.mouseLocation) }
                return event
            } as Any,
        ]
        makeKeyAndOrderFront(nil)
    }

    /// Closes the panel, ending the icon's session too, so the icon's next click opens it again.
    public override func close() {
        guard isOpen else { return }
        isOpen = false
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        intentTimer?.invalidate()
        buttonRect = nil
        state.reset()
        #if canImport(AppKit, _version: 2700)
        if #available(macOS 27, *) { statusItem?.expandedInterfaceSession?.cancel() }
        #endif
        orderOut(nil)
        onClose?()
    }

    /// A click at `point` closes the panel unless it is inside the panel or on the icon, whose own click toggles it.
    static func closes(onClickAt point: NSPoint, panel: NSRect, button: NSRect?) -> Bool {
        !panel.contains(point) && !(button?.contains(point) ?? false)
    }

    func clicked(at point: NSPoint) {
        if isOpen, Self.closes(onClickAt: point, panel: frame, button: buttonRect) { close() }
    }

    public override func resignKey() {
        super.resignKey()
        intent.reset()
        close()
    }

    public override func cancelOperation(_ sender: Any?) {
        if onEscape?() != true { close() }
    }

    /// The keys a menu answers, handled before any view sees them: Escape, up and down, Return, and ⌘ with a footer
    /// item's key. Moves of the pointer feed its intent.
    public override func sendEvent(_ event: NSEvent) {
        switch event.type {
        case .keyDown:
            intent.reset()
            if handle(key: event) { return }
        case .mouseMoved:
            pointerMoved(to: NSEvent.mouseLocation, at: event.timestamp)
        default:
            break
        }
        super.sendEvent(event)
    }

    func handle(key event: NSEvent) -> Bool {
        let characters = event.charactersIgnoringModifiers ?? ""
        if event.modifierFlags.contains(.command) {
            return characters.first.map { state.shortcut(Character($0.lowercased())) } ?? false
        }
        switch characters.unicodeScalars.first.map({ Int($0.value) }) {
        case 0x1b:
            cancelOperation(nil)
        case NSUpArrowFunctionKey:
            state.move(-1)
        case NSDownArrowFunctionKey:
            state.move(1)
        case 0x0d, 0x03:
            state.act()
        default:
            return false
        }
        return true
    }

    func pointerMoved(to point: NSPoint, at time: TimeInterval) {
        intent.moved(to: point, at: time)
        intentTimer?.invalidate()
        intentTimer = Timer.scheduledTimer(withTimeInterval: PointerIntent.wait, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.pointerHeld(at: ProcessInfo.processInfo.systemUptime) }
        }
    }

    func pointerHeld(at time: TimeInterval) {
        if intent.tick(at: time), let over = state.pointerOver { state.selected = over }
    }

    /// Sizes the panel to its content, up to what the screen allows, keeping its top where it is.
    func fit(top: CGFloat? = nil, visibleFrame: NSRect? = nil) {
        guard let hosting = contentView else { return }
        hosting.layoutSubtreeIfNeeded()
        let size = NSSize(width: width, height: state.panelHeight)
        let placed = Self.place(below: NSRect(x: buttonRect?.minX ?? frame.minX, y: (top ?? frame.maxY) + Self.gap, width: 0, height: 0),
                                size: size, in: visibleFrame ?? screen?.visibleFrame ?? .infinite)
        setFrame(placed, display: isOpen)
    }

    static let gap: CGFloat = 4

    /// The panel's frame: its top `gap` under the icon and its left edge at the icon's, moved in to fit the screen.
    static func place(below button: NSRect, size: NSSize, in visible: NSRect) -> NSRect {
        let x = max(visible.minX + gap, min(button.minX, visible.maxX - gap - size.width))
        let top = min(button.minY - gap, visible.maxY)
        return NSRect(x: x, y: top - size.height, width: size.width, height: size.height)
    }

    /// How tall the panel may be under `button` before its content scrolls.
    static func maxHeight(below button: NSRect, in visible: NSRect) -> CGFloat {
        min(button.minY - gap, visible.maxY) - visible.minY - gap
    }
}

/// The panel's content in its frame, scrolling only when the screen is too short for it, and reporting its height so
/// the panel can fit it.
struct PanelRoot<Content: View>: View {
    let width: CGFloat
    let state: PanelState
    let content: Content
    /// The top of the content, scrolled back to as the panel closes: a type of its own, so no line's id is the same.
    struct Top: Hashable {}

    var body: some View {
        PanelFrame(width: width) {
            ScrollViewReader { scroller in
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        Color.clear.frame(height: 0).id(Top())
                        content
                    }
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { height in
                            state.contentHeight = height
                        }
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollIndicators(state.contentHeight + 2 * Metrics.line > state.maxHeight ? .automatic : .hidden)
                .frame(height: max(0, min(state.contentHeight, state.maxHeight - 2 * Metrics.line)))
                // A line the keys chose is never out of sight, so Return never runs one that cannot be seen.
                // Nothing selected is a panel just closed, which opens again at the top, as a menu does.
                .onChange(of: state.selected) { _, selected in
                    if let selected {
                        if selected != state.pointerOver { scroller.scrollTo(selected) }
                    } else {
                        scroller.scrollTo(Top(), anchor: .top)
                    }
                }
            }
        }
        .environment(state)
        .onPreferenceChange(SelectableLines.self) { lines in MainActor.assumeIsolated { state.lines = lines } }
        .onPreferenceChange(Shortcuts.self) { keys in MainActor.assumeIsolated { state.shortcuts = keys } }
        .onChange(of: state.contentHeight) { _, _ in state.resized?() }
    }
}

// AppKit 27xx is the macOS 27 SDK, the first to declare the expanded interface session; the macOS 26 SDKs' AppKit is
// 26xx. `@available` only guards running, so without the check an older SDK fails to compile this.
#if canImport(AppKit, _version: 2700)
/// The macOS 27 hookup: the icon's session opens the panel and its end closes it.
@available(macOS 27, *)
@MainActor
final class ExpandedInterface: NSObject, @preconcurrency NSStatusItemExpandedInterfaceDelegate {
    weak var panel: MenuBarPanel?

    init(panel: MenuBarPanel) { self.panel = panel }

    func statusItem(_ statusItem: NSStatusItem, didBegin session: NSStatusItemExpandedInterfaceSession) {
        panel?.open(below: statusItem)
    }

    func statusItemDidEndExpandedInterfaceSession(_ statusItem: NSStatusItem, animated: Bool) {
        panel?.close()
    }
}
#endif
