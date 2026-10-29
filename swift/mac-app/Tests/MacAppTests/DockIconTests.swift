import AppKit
import Testing
@testable import MacApp

@MainActor
final class StandInWindow: DockWindow {
    var isVisible: Bool
    var isMiniaturized = false
    var canBecomeMain = true
    var isPanel = false
    init(visible: Bool = true) { isVisible = visible }
}

@MainActor
final class Recorded {
    var windows: [any DockWindow]
    var set: [NSApplication.ActivationPolicy] = []
    init(windows: [any DockWindow]) { self.windows = windows }
}

@MainActor
@Suite struct DockIconTests {
    @Test func anOpenWindowGivesTheAppADockIconAndPanelsNever() {
        let settings = StandInWindow()
        let panel = StandInWindow()
        panel.isPanel = true
        let hidden = StandInWindow(visible: false)
        #expect(DockIcon.policy(for: []) == .accessory)
        #expect(DockIcon.policy(for: [panel, hidden]) == .accessory)
        #expect(DockIcon.policy(for: [panel, settings]) == .regular)
        hidden.isMiniaturized = true
        #expect(DockIcon.policy(for: [hidden]) == .regular)
    }

    /// At willClose the closing window is still visible: left in, the icon would stay after the last window closed.
    @Test func theLastWindowClosingTakesTheIconAway() {
        let settings = StandInWindow()
        let other = StandInWindow()
        let center = NotificationCenter()
        let state = Recorded(windows: [settings, other])
        let following = DockIcon.follow(center: center, windows: { state.windows }) { state.set.append($0) }
        center.post(name: NSWindow.didBecomeKeyNotification, object: settings)
        center.post(name: NSWindow.willCloseNotification, object: other)
        state.windows = [settings]
        center.post(name: NSWindow.willCloseNotification, object: settings)
        #expect(state.set == [.regular, .regular, .accessory])
        following.stop()
        center.post(name: NSWindow.didBecomeKeyNotification, object: settings)
        #expect(state.set.count == 3)
    }

    /// Another window already open in front must not be brought forward over the one just opened.
    @Test func theWindowJustOpenedIsTheOneBroughtForward() {
        let main = StandInWindow()
        let settings = StandInWindow()
        let panel = StandInWindow()
        panel.isPanel = true
        let before: Set = [ObjectIdentifier(main)]
        #expect(AppWindows.opened(shownBefore: before, frontToBack: [panel, main, settings]) === settings)
        #expect(AppWindows.opened(shownBefore: [ObjectIdentifier(main), ObjectIdentifier(settings)], frontToBack: [settings, main]) === settings)
        #expect(AppWindows.opened(shownBefore: before, frontToBack: [panel, StandInWindow(visible: false)]) == nil)
    }

    @Test func settingsIsTheAppMenusCommandCommaItem() {
        let menu = NSMenu()
        menu.addItem(withTitle: "About My App", action: nil, keyEquivalent: "")
        #expect(AppWindows.settingsItem(in: menu) == nil)
        menu.addItem(withTitle: "Hide", action: nil, keyEquivalent: "h")
        let shifted = menu.addItem(withTitle: "Something", action: nil, keyEquivalent: ",")
        shifted.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(withTitle: "Settings…", action: nil, keyEquivalent: ",")
        #expect(AppWindows.settingsItem(in: menu) == 3)
    }
}
