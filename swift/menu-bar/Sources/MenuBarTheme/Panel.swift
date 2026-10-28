import AppKit
import SwiftUI

/// The panel under a menu bar icon, which behaves as a menu does: Escape and a click outside close it, the arrow keys
/// and Return work, ⌘ and a footer item's key run it, and it takes the keys without making the app active, so the app
/// the person was in stays in front. A row with a page opens it in a side panel beside it, as a submenu. It never
/// shows a Dock icon (the app's Info.plist sets LSUIElement).
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
    /// The visible frame of the screen the panel opened on, which the side panel keeps inside too.
    private var visibleFrame: NSRect?
    /// The panel beside this one that shows a row's side page, made the first time one opens.
    private(set) var sidePanel: SidePanel?

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
        let root = PanelRoot(width: width, state: state, surface: state.list, content: content())
        let hosting = NSHostingView(rootView: root)
        hosting.sizingOptions = []
        contentView = hosting
        state.list.resized = { [weak self] in self?.fit() }
        state.side.resized = { [weak self] in self?.fitSide() }
        state.sideChanged = { [weak self] selectingFirst in self?.sideChanged(selectingFirst: selectingFirst) }
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
        self.visibleFrame = visibleFrame
        state.list.maxHeight = Self.maxHeight(below: button, in: visibleFrame)
        state.side.maxHeight = visibleFrame.height - 2 * Self.gap
        fit(top: button.minY - Self.gap, visibleFrame: visibleFrame)
        intent.reset()
        isOpen = true
        guard !Self.staysOffScreen else { return }
        let outside: (NSEvent) -> Void = { [weak self] _ in self?.clicked(at: NSEvent.mouseLocation) }
        monitors = [
            NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: outside) as Any,
            NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
                if event.window !== self, event.window !== self?.sidePanel { self?.clicked(at: NSEvent.mouseLocation) }
                return event
            } as Any,
            // The pointer's moves over this panel and the side panel, whichever of the two AppKit sends them to.
            NSEvent.addLocalMonitorForEvents(matching: .mouseMoved) { [weak self] event in
                self?.pointerMoved(to: NSEvent.mouseLocation, at: event.timestamp)
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
        hideSide()
        #if canImport(AppKit, _version: 2700)
        if #available(macOS 27, *) { statusItem?.expandedInterfaceSession?.cancel() }
        #endif
        orderOut(nil)
        onClose?()
    }

    /// A click at `point` closes the panel unless it is inside the panel or its open side panel, or on the icon, whose
    /// own click toggles it.
    static func closes(onClickAt point: NSPoint, panel: NSRect, button: NSRect?, side: NSRect? = nil) -> Bool {
        !panel.contains(point) && !(button?.contains(point) ?? false) && !(side?.contains(point) ?? false)
    }

    func clicked(at point: NSPoint) {
        let side = state.sidePage == nil ? nil : sidePanel?.frame
        if isOpen, Self.closes(onClickAt: point, panel: frame, button: buttonRect, side: side) { close() }
    }

    public override func resignKey() {
        super.resignKey()
        intent.reset()
        close()
    }

    /// Escape closes an open side page first, then goes back a page through `onEscape`, then closes the panel.
    public override func cancelOperation(_ sender: Any?) {
        if state.leaveSide() { return }
        if onEscape?() != true { close() }
    }

    /// The keys a menu answers, handled before any view sees them: Escape, the arrows, Return, and ⌘ with a footer
    /// item's key. The side panel never takes the keys, so this is where its keys come too.
    public override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown {
            intent.reset()
            if handle(key: event) { return }
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
        case NSRightArrowFunctionKey:
            state.enterSide()
        case NSLeftArrowFunctionKey:
            state.leaveSide()
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
        if intent.tick(at: time), let over = state.pointerOver { state.pointed(at: over) }
    }

    /// Sizes the panel to its content, up to what the screen allows, keeping its top where it is.
    func fit(top: CGFloat? = nil, visibleFrame: NSRect? = nil) {
        guard let hosting = contentView else { return }
        hosting.layoutSubtreeIfNeeded()
        let size = NSSize(width: width, height: state.list.panelHeight)
        let placed = Self.place(below: NSRect(x: buttonRect?.minX ?? frame.minX, y: (top ?? frame.maxY) + Self.gap, width: 0, height: 0),
                                size: size, in: visibleFrame ?? self.visibleFrame ?? screen?.visibleFrame ?? .infinite)
        setFrame(placed, display: isOpen)
    }

    /// A side page opened, swapped or closed, or the list's rows were drawn again: the side panel shows the open page
    /// beside its row, or hides when none is open or its row is gone.
    func sideChanged(selectingFirst: Bool) {
        guard isOpen, let id = state.sidePage else { return hideSide() }
        guard state.sidePages.contains(where: { $0.id == id }) else { return state.closeSide() }
        let side = sidePanel ?? SidePanel(width: width, state: state)
        sidePanel = side
        fitSide()
        // A child window is on the screen as soon as it is added to one that is, so a check never adds it.
        if !Self.staysOffScreen, side.parent == nil { addChildWindow(side, ordered: .above) }
        if selectingFirst, let first = state.side.lines.first { state.selected = first.id }
    }

    /// Sizes the side panel to its page and puts it beside its row.
    func fitSide() {
        guard let side = sidePanel, let hosting = side.contentView,
              let page = state.sidePages.first(where: { $0.id == state.sidePage }) else { return }
        hosting.layoutSubtreeIfNeeded()
        let row = NSRect(x: frame.minX + page.row.minX, y: frame.maxY - page.row.maxY, width: page.row.width, height: page.row.height)
        let size = NSSize(width: width, height: state.side.panelHeight)
        side.setFrame(Self.place(side: size, beside: row, of: frame, in: visibleFrame ?? screen?.visibleFrame ?? .infinite), display: isOpen)
        hosting.layoutSubtreeIfNeeded()
    }

    func hideSide() {
        guard let side = sidePanel else { return }
        if side.parent != nil { removeChildWindow(side) }
        side.orderOut(nil)
    }

    static let gap: CGFloat = 4

    /// The panel's frame: its top `gap` under the icon and its left edge at the icon's, moved in to fit the screen.
    static func place(below button: NSRect, size: NSSize, in visible: NSRect) -> NSRect {
        let x = max(visible.minX + gap, min(button.minX, visible.maxX - gap - size.width))
        let top = min(button.minY - gap, visible.maxY)
        return NSRect(x: x, y: top - size.height, width: size.width, height: size.height)
    }

    /// The side panel's frame: `gap` to the right of the panel, or to its left when the screen has no room on the right,
    /// with its first line level with `row` and kept inside `visible`, all in screen coordinates.
    static func place(side size: NSSize, beside row: NSRect, of panel: NSRect, in visible: NSRect) -> NSRect {
        let right = panel.maxX + gap
        let x = right + size.width <= visible.maxX - gap ? right : max(visible.minX + gap, panel.minX - gap - size.width)
        // Its frame's top line sits just above the row's top, so its first line starts where the row does.
        let top = max(min(row.maxY + Metrics.line, visible.maxY), visible.minY + gap + size.height)
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
    /// The list's surface or the side page's: where this panel's lines and height go.
    let surface: Surface
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
                            surface.contentHeight = height
                        }
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollIndicators(surface.contentHeight + 2 * Metrics.line > surface.maxHeight ? .automatic : .hidden)
                .frame(height: max(0, min(surface.contentHeight, surface.maxHeight - 2 * Metrics.line)))
                // A line the keys chose is never out of sight, so Return never runs one that cannot be seen.
                .onChange(of: state.selected) { _, selected in
                    if let selected, selected != state.pointerOver { scroller.scrollTo(selected) }
                }
                // Closed, it opens again at the top, as a menu does, however it was scrolled.
                .onChange(of: state.closes) { _, _ in scroller.scrollTo(Top(), anchor: .top) }
            }
        }
        .environment(state)
        .onPreferenceChange(SelectableLines.self) { lines in MainActor.assumeIsolated { surface.lines = lines } }
        .onPreferenceChange(Shortcuts.self) { keys in MainActor.assumeIsolated { surface.shortcuts = keys } }
        .onPreferenceChange(SidePages.self) { pages in
            MainActor.assumeIsolated {
                // Only the list's rows open side pages; a side page holds none of its own.
                guard surface === state.list else { return }
                state.sidePages = pages
                state.sideChanged?(false)
            }
        }
        .onChange(of: surface.contentHeight) { _, _ in surface.resized?() }
    }
}

/// The open side page's content, or nothing.
struct SideContent: View {
    let state: PanelState

    var body: some View {
        if let id = state.sidePage, let page = state.sidePages.first(where: { $0.id == id }) { page.content }
    }
}

/// The panel beside the list that shows a row's side page. It never takes the keys or makes the app active, so the
/// list's panel keeps the keyboard, and it takes a click at once, though it is never the key window.
@MainActor
final class SidePanel: NSPanel {
    init(width: CGFloat, state: PanelState) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: width, height: 1), styleMask: MenuBarPanel.style, backing: .buffered, defer: true)
        isFloatingPanel = true
        level = MenuBarPanel.windowLevel
        collectionBehavior = MenuBarPanel.spaces
        hidesOnDeactivate = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        acceptsMouseMovedEvents = true
        isReleasedWhenClosed = false
        let hosting = FirstClickHostingView(rootView: PanelRoot(width: width, state: state, surface: state.side, content: SideContent(state: state)))
        hosting.sizingOptions = []
        contentView = hosting
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// A hosting view that acts on the click that reaches a window not in front, which SwiftUI before macOS 15 drops.
final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
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
