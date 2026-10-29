import AppKit

/// What the Dock icon decision reads of a window. NSWindow has it; tests pass stand-ins, since a window that is really
/// visible is on the screen.
@MainActor
public protocol DockWindow: AnyObject {
    var isVisible: Bool { get }
    var isMiniaturized: Bool { get }
    var canBecomeMain: Bool { get }
    var isPanel: Bool { get }
}

extension NSWindow: DockWindow {
    public var isPanel: Bool { self is NSPanel }
}

/// A menu bar app has no Dock icon, except while one of its windows is open: then it is in the Dock and the app
/// switcher, so a window another app covered can be brought back, and the icon leaves when the last one closes. Panels
/// (the menu bar panel, a popup) never count.
@MainActor
public enum DockIcon {
    /// Regular while a window other than `closing` is open or in the Dock, else accessory.
    public static func policy(for windows: [any DockWindow], closing: ObjectIdentifier? = nil) -> NSApplication.ActivationPolicy {
        windows.contains { window in
            ObjectIdentifier(window) != closing && (window.isVisible || window.isMiniaturized) && window.canBecomeMain && !window.isPanel
        } ? .regular : .accessory
    }

    /// Sets the policy each time a window becomes key or is about to close, which covers windows the app opens itself
    /// and SwiftUI's Settings window alike. Keep what it returns for as long as the app runs.
    public static func follow(
        center: NotificationCenter = .default,
        windows: @escaping @MainActor () -> [any DockWindow] = { NSApp.windows },
        setPolicy: @escaping @MainActor (NSApplication.ActivationPolicy) -> Void = { _ = NSApp.setActivationPolicy($0) }
    ) -> Following {
        let decide: @MainActor (ObjectIdentifier?) -> Void = { closing in setPolicy(policy(for: windows(), closing: closing)) }
        let opened = center.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { decide(nil) }
        }
        let closed = center.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { note in
            // At willClose the window is still visible, so it is left out by name.
            let closing = (note.object as AnyObject?).map(ObjectIdentifier.init)
            MainActor.assumeIsolated { decide(closing) }
        }
        return Following(center: center, observers: [opened, closed])
    }

    /// The observers `follow` added; `stop` removes them.
    @MainActor
    public final class Following {
        let center: NotificationCenter
        var observers: [NSObjectProtocol]

        init(center: NotificationCenter, observers: [NSObjectProtocol]) {
            self.center = center
            self.observers = observers
        }

        public func stop() {
            observers.forEach(center.removeObserver)
            observers = []
        }
    }
}

/// Bringing one of the app's windows to the front from the menu bar, where the app is not active.
@MainActor
public enum AppWindows {
    /// Gives the app its Dock icon, asks macOS to bring it forward, runs `open`, which shows the window, and on the
    /// next turn of the run loop, once the window exists, brings it forward and asks again: since macOS 14 activating
    /// is only a request, and asking before the window exists can leave the icon in the Dock with the window behind.
    /// When `open` showed no window, the icon goes back to what the open windows call for.
    public static func show(log: AppLog? = nil, open: @MainActor () -> Void) {
        let shownBefore = Set(NSApp.windows.filter { isOrdinary($0) }.map(ObjectIdentifier.init))
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
        open()
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard let window = opened(shownBefore: shownBefore, frontToBack: NSApp.orderedWindows) as? NSWindow else {
                    NSApp.setActivationPolicy(DockIcon.policy(for: NSApp.windows))
                    return
                }
                window.makeKeyAndOrderFront(nil)
                NSApp.activate()
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        if !NSApp.isActive { log?.note("window", "asked macOS to bring the app forward; it was not in front on the next turn") }
                    }
                }
            }
        }
    }

    /// Opens SwiftUI's Settings scene through the Settings… item SwiftUI puts in the app menu with ⌘,: SwiftUI's own
    /// openSettings action does nothing from a menu bar panel, which is outside its scenes, and the old
    /// showSettingsWindow: action does nothing since macOS 14. Writes to the log when the app menu has no such item.
    /// An app that makes its own Settings window passes its opener to `show` instead.
    public static func openSettingsScene(log: AppLog? = nil) {
        show(log: log) {
            guard let menu = NSApp.mainMenu?.items.first?.submenu, let index = settingsItem(in: menu) else {
                log?.note("settings", "the app menu has no Settings… item with ⌘,, so Settings did not open")
                return
            }
            menu.performActionForItem(at: index)
        }
    }

    /// Where Settings… is in the app menu: the item whose key is ⌘,.
    public static func settingsItem(in menu: NSMenu) -> Int? {
        menu.items.firstIndex { $0.keyEquivalent == "," && $0.keyEquivalentModifierMask == .command }
    }

    /// The window `open` showed: one shown since, else the frontmost, which an opener that brought an open window
    /// forward put there. Nil when no ordinary window is showing.
    static func opened(shownBefore: Set<ObjectIdentifier>, frontToBack windows: [any DockWindow]) -> (any DockWindow)? {
        let showing = windows.filter { isOrdinary($0) }
        return showing.first { !shownBefore.contains(ObjectIdentifier($0)) } ?? showing.first
    }

    private static func isOrdinary(_ window: any DockWindow) -> Bool {
        window.isVisible && window.canBecomeMain && !window.isPanel
    }
}
