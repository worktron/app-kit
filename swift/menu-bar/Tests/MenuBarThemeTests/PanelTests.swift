import AppKit
import SwiftUI
import Testing
@testable import MenuBarTheme

/// The panel is never put on the screen here: `staysOffScreen` places it and marks it open, and events are handed to it
/// directly, the way the window server would.
@MainActor
@Suite struct PanelTests {
    init() {
        _ = NSApplication.shared
        MenuBarPanel.staysOffScreen = true
    }

    static let icon = NSRect(x: 1200, y: 1000, width: 24, height: 24)
    static let screen = NSRect(x: 0, y: 0, width: 1440, height: 1000)

    func key(_ characters: String, code: UInt16, command: Bool = false) -> NSEvent {
        NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: command ? .command : [], timestamp: 0, windowNumber: 0, context: nil,
                         characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
    }

    static let up = String(UnicodeScalar(UInt16(NSUpArrowFunctionKey))!)
    static let down = String(UnicodeScalar(UInt16(NSDownArrowFunctionKey))!)
    static let right = String(UnicodeScalar(UInt16(NSRightArrowFunctionKey))!)
    static let left = String(UnicodeScalar(UInt16(NSLeftArrowFunctionKey))!)

    /// A panel of three rows and a footer, laid out so its lines and shortcuts are known, with what each did.
    func panel(acted: @escaping (String) -> Void = { _ in }) -> MenuBarPanel {
        let panel = MenuBarPanel(width: 400, state: PanelState(pasteboard: .withUniqueName())) {
            Header("fleet", status: Words("all 3 fine", .ok), note: "read just now")
            Row("alpha", status: Words("fine", .ok), age: "4m") { acted("alpha") }
            Row("bravo", status: Words("fine", .ok), age: "9m") { acted("bravo") }
            Row("charlie", status: Words("fine", .ok), age: "2m") { acted("charlie") }
            Footer([FooterItem("settings", key: ",") { acted("settings") }], trailing: [FooterItem("quit", key: "q") { acted("quit") }])
        }
        panel.open(below: Self.icon, in: Self.screen)
        panel.contentView?.layoutSubtreeIfNeeded()
        return panel
    }

    @Test func takesTheKeysWithoutMakingTheAppActive() {
        let panel = panel()
        #expect(panel.styleMask.contains(.nonactivatingPanel))
        #expect(panel.styleMask.contains(.borderless) || !panel.styleMask.contains(.titled))
        #expect(panel.canBecomeKey)
        #expect(!panel.canBecomeMain)
        #expect(panel.level == .statusBar)
        #expect(panel.collectionBehavior.isSuperset(of: [.moveToActiveSpace, .fullScreenAuxiliary, .auxiliary]))
        #expect(!panel.hidesOnDeactivate)
    }

    @Test func escapeClosesThePanel() {
        let panel = panel()
        var closed = 0
        panel.onClose = { closed += 1 }
        panel.sendEvent(key("\u{1b}", code: 53))
        #expect(!panel.isOpen)
        #expect(closed == 1)
    }

    @Test func escapeGoesBackAPageBeforeItCloses() {
        let panel = panel()
        var onPage = true
        panel.onEscape = {
            guard onPage else { return false }
            onPage = false
            return true
        }
        panel.sendEvent(key("\u{1b}", code: 53))
        #expect(panel.isOpen)
        #expect(!onPage)
        panel.sendEvent(key("\u{1b}", code: 53))
        #expect(!panel.isOpen)
    }

    @Test func aClickOutsideClosesAndAClickOnThePanelOrTheIconDoesNot() {
        let panel = panel()
        #expect(MenuBarPanel.closes(onClickAt: NSPoint(x: 10, y: 10), panel: panel.frame, button: Self.icon))
        #expect(!MenuBarPanel.closes(onClickAt: NSPoint(x: panel.frame.midX, y: panel.frame.midY), panel: panel.frame, button: Self.icon))
        #expect(!MenuBarPanel.closes(onClickAt: NSPoint(x: Self.icon.midX, y: Self.icon.midY), panel: panel.frame, button: Self.icon))
        panel.clicked(at: NSPoint(x: Self.icon.midX, y: Self.icon.midY))
        #expect(panel.isOpen)
        panel.clicked(at: NSPoint(x: 10, y: 10))
        #expect(!panel.isOpen)
    }

    @Test func arrowKeysMoveThroughTheLinesAndReturnActs() {
        var acted: [String] = []
        let panel = panel { acted.append($0) }
        // The footer's items come last, as a menu's last items do.
        #expect(panel.state.list.lines.map(\.id) == ["alpha", "bravo", "charlie", ["footer", "settings"], ["footer", "quit"]])
        panel.sendEvent(key(Self.down, code: 125))
        #expect(panel.state.selected == AnyHashable("alpha"))
        for _ in 0..<5 { panel.sendEvent(key(Self.down, code: 125)) }
        #expect(panel.state.selected == AnyHashable(["footer", "quit"]))
        panel.sendEvent(key(Self.up, code: 126))
        panel.sendEvent(key("\r", code: 36))
        panel.sendEvent(key(Self.up, code: 126))
        panel.sendEvent(key(Self.up, code: 126))
        panel.sendEvent(key("\r", code: 36))
        #expect(acted == ["settings", "bravo"])
    }

    @Test func theSameProblemUnderTwoMacsIsTwoLines() {
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        let panel = MenuBarPanel(width: 420, state: PanelState(pasteboard: pasteboard)) {
            ItemGroup("alpha", age: "never reported") { ItemLine("has never reported", copy: "on alpha: bun bin/sync.ts install") }
            ItemGroup("bravo", age: "2h ago") { ItemLine("has never reported", copy: "on bravo: bun bin/sync.ts install") }
            ItemGroup("charlie", age: "2m ago") { ItemLine("apply stopped on share-page", copy: "bun bin/apply.ts") }
        }
        panel.open(below: Self.icon, in: Self.screen)
        panel.contentView?.layoutSubtreeIfNeeded()
        #expect(Set(panel.state.list.lines.map(\.id)).count == 3)
        panel.sendEvent(key(Self.down, code: 125))
        panel.sendEvent(key(Self.down, code: 125))
        panel.sendEvent(key("\r", code: 36))
        #expect(pasteboard.string(forType: .string) == "on bravo: bun bin/sync.ts install")
        panel.sendEvent(key(Self.down, code: 125))
        #expect(panel.state.selected == panel.state.list.lines.last?.id)
    }

    @Observable final class Status {
        var age = "4m"
    }

    struct StatusRows: View {
        let status: Status
        let opened: (String) -> Void
        var body: some View {
            let age = status.age
            Row("alpha", status: Words("fine", .ok), age: age) { opened(age) }
            Footer([FooterItem("refresh", key: "r") { opened("refresh at \(age)") }])
        }
    }

    @Test func returnAndShortcutsRunWhatTheLatestUpdateDrew() {
        let status = Status()
        var opened: [String] = []
        let panel = MenuBarPanel(width: 400, state: PanelState(pasteboard: .withUniqueName())) {
            StatusRows(status: status) { opened.append($0) }
        }
        panel.open(below: Self.icon, in: Self.screen)
        panel.contentView?.layoutSubtreeIfNeeded()
        // A refresh: the same row, by the same id, with newer data.
        status.age = "1m"
        panel.contentView?.layoutSubtreeIfNeeded()
        panel.sendEvent(key(Self.down, code: 125))
        panel.sendEvent(key("\r", code: 36))
        panel.sendEvent(key("r", code: 15, command: true))
        #expect(opened == ["1m", "refresh at 1m"])
    }

    @Test func upFromNothingSelectsTheLastLine() {
        let panel = panel()
        panel.sendEvent(key(Self.up, code: 126))
        #expect(panel.state.selected == AnyHashable(["footer", "quit"]))
    }

    @Test func commandAndAFooterItemsKeyRunIt() {
        var acted: [String] = []
        let panel = panel { acted.append($0) }
        panel.sendEvent(key(",", code: 43, command: true))
        panel.sendEvent(key("q", code: 12, command: true))
        #expect(acted == ["settings", "quit"])
    }

    @Test func closingForgetsTheSelectionAndTheCopy() {
        let panel = panel()
        panel.sendEvent(key(Self.down, code: 125))
        panel.state.copy("bun bin/apply.ts")
        panel.close()
        #expect(panel.state.selected == nil)
        #expect(panel.state.copied == nil)
    }

    @Test func thePanelSitsUnderTheIconAndInsideTheScreen() {
        let size = NSSize(width: 400, height: 300)
        let under = MenuBarPanel.place(below: NSRect(x: 600, y: 1000, width: 24, height: 24), size: size, in: Self.screen)
        #expect(under == NSRect(x: 600, y: 696, width: 400, height: 300))
        // An icon near the right edge: the panel moves left to stay on the screen.
        let right = MenuBarPanel.place(below: Self.icon, size: size, in: Self.screen)
        #expect(right.maxX == Self.screen.maxX - MenuBarPanel.gap)
        #expect(right.maxY == Self.icon.minY - MenuBarPanel.gap)
        #expect(MenuBarPanel.maxHeight(below: Self.icon, in: Self.screen) == CGFloat(1000 - 4 - 4))
    }

    @Observable final class Links {
        var shown: [String] = []
    }

    struct LinkRows: View {
        let links: Links
        var body: some View {
            ForEach(links.shown, id: \.self) { Row(Words($0), id: $0) {} }
        }
    }

    @Test func onOpenRunsOnceBeforeThePanelIsShownAndItsChangeIsInTheFirstFrame() {
        let links = Links()
        let panel = MenuBarPanel(width: 400, state: PanelState(pasteboard: .withUniqueName())) {
            LinkRows(links: links)
        }
        var opened: [Bool] = []
        panel.onOpen = {
            opened.append(panel.isOpen)
            links.shown = ["github.com/acme/widgets/pull/12", "docs.example.com/document/d/1AbCdEf/edit"]
        }
        panel.open(below: Self.icon, in: Self.screen)
        // Called while still closed, and the panel was sized for the two rows it read.
        #expect(opened == [false])
        let twoRows: CGFloat = 2 * 44 + 2
        #expect(panel.frame.height == twoRows)
        // A second open while open, as by a second session, leaves the content alone.
        panel.open(below: Self.icon, in: Self.screen)
        #expect(opened == [false])
        panel.close()
        panel.open(below: Self.icon, in: Self.screen)
        #expect(opened == [false, false])
    }

    /// How far the panel's content is scrolled down, in points.
    func scrolled(_ panel: MenuBarPanel) throws -> CGFloat {
        func find(_ view: NSView) -> NSScrollView? {
            if let scroll = view as? NSScrollView { return scroll }
            return view.subviews.lazy.compactMap(find).first
        }
        let content = try #require(panel.contentView)
        let scroll = try #require(find(content))
        return scroll.contentView.bounds.origin.y
    }

    @Test func aLineTheKeysChooseScrollsIntoView() throws {
        // A screen 200 points tall under the icon: the 210 point panel scrolls, and the footer starts out of sight.
        let short = NSRect(x: 0, y: 800, width: 1440, height: 200)
        let panel = MenuBarPanel(width: 400, state: PanelState(pasteboard: .withUniqueName())) {
            Header("fleet", status: Words("all 3 fine", .ok), note: "read just now")
            Row("alpha", status: Words("fine", .ok), age: "4m") {}
            Row("bravo", status: Words("fine", .ok), age: "9m") {}
            Row("charlie", status: Words("fine", .ok), age: "2m") {}
            Footer([FooterItem("settings", key: ",") {}], trailing: [FooterItem("quit", key: "q") {}])
        }
        panel.open(below: Self.icon, in: short)
        panel.contentView?.layoutSubtreeIfNeeded()
        let whole: CGFloat = 40 + 3 * 44 + 36 + 2
        #expect(panel.frame.height < whole)
        #expect(try scrolled(panel) == 0)
        // Up from nothing chooses the footer's last item, at the bottom.
        panel.sendEvent(key(Self.up, code: 126))
        panel.contentView?.layoutSubtreeIfNeeded()
        #expect(panel.state.selected == AnyHashable(["footer", "quit"]))
        #expect(try scrolled(panel) > 0)
        // Opened again, it starts at the top, as a menu does, and Down chooses the top line, already in sight.
        panel.close()
        panel.open(below: Self.icon, in: short)
        panel.sendEvent(key(Self.down, code: 125))
        panel.contentView?.layoutSubtreeIfNeeded()
        #expect(panel.state.selected == AnyHashable("alpha"))
        #expect(try scrolled(panel) == 0)
    }

    @Test func aPanelScrolledByHandOpensAgainAtItsTop() throws {
        let short = NSRect(x: 0, y: 800, width: 1440, height: 200)
        let panel = MenuBarPanel(width: 400, state: PanelState(pasteboard: .withUniqueName())) {
            ForEach(0..<6) { Row("mac \($0)", status: Words("fine", .ok), age: "\($0)m") {} }
        }
        panel.open(below: Self.icon, in: short)
        panel.contentView?.layoutSubtreeIfNeeded()
        // As the wheel would: scrolled, with no line selected.
        func find(_ view: NSView) -> NSScrollView? {
            if let scroll = view as? NSScrollView { return scroll }
            return view.subviews.lazy.compactMap(find).first
        }
        let content = try #require(panel.contentView)
        let scroll = try #require(find(content))
        scroll.contentView.scroll(to: NSPoint(x: 0, y: 60))
        scroll.reflectScrolledClipView(scroll.contentView)
        #expect(try scrolled(panel) == 60)
        #expect(panel.state.selected == nil)
        panel.close()
        panel.open(below: Self.icon, in: short)
        panel.contentView?.layoutSubtreeIfNeeded()
        #expect(try scrolled(panel) == 0)
    }

    /// The color the open panel draws at `x`, `y` points from its top left, read from its own view, off the screen.
    func drawn(_ panel: MenuBarPanel, x: CGFloat, y: CGFloat) throws -> UInt32 {
        let view = try #require(panel.contentView)
        view.layoutSubtreeIfNeeded()
        let rep = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: rep)
        let srgb = try #require(rep.converting(to: .sRGB, renderingIntent: .default))
        let scale = CGFloat(srgb.pixelsWide) / view.bounds.width
        let color = try #require(srgb.colorAt(x: Int(x * scale), y: Int(y * scale)))
        let channel = { (value: CGFloat) in UInt32((value * 255).rounded()) }
        return channel(color.redComponent) << 16 | channel(color.greenComponent) << 8 | channel(color.blueComponent)
    }

    /// Turns the run loop until the panel takes on the app's appearance, as it does a turn after the app's changes.
    func settle(_ panel: MenuBarPanel, to name: NSAppearance.Name) {
        var turns = 0
        while panel.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) != name, turns < 50 {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
            turns += 1
        }
    }

    @Test func thePanelFollowsTheAppsAppearance() throws {
        let before = NSApp.appearance
        defer { NSApp.appearance = before }
        let panel = panel()
        #expect(panel.appearance == nil)
        // In alpha's row, left of its name: the panel's own background.
        NSApp.appearance = NSAppearance(named: .aqua)
        settle(panel, to: .aqua)
        #expect(try drawn(panel, x: 6, y: 1 + 40 + 1 + 22) == Palette.bg.light)
        NSApp.appearance = NSAppearance(named: .darkAqua)
        settle(panel, to: .darkAqua)
        #expect(try drawn(panel, x: 6, y: 1 + 40 + 1 + 22) == Palette.bg.dark)
    }

    /// A side page of five profiles a link can open in, under a line saying why, taller than the list it opens from.
    static func linkPage(_ link: String, _ acted: @escaping (String) -> Void) -> AnyView {
        AnyView(VStack(spacing: 0) {
            SubLine("why \(link) opened where it did")
            ForEach(["home", "work", "school", "club", "shop"], id: \.self) { profile in
                Row(Words(profile), opens: false, id: [link, profile]) { acted("\(link) in \(profile)") }
            }
        })
    }

    /// Three links, the first two with side pages and the third acting in place, and a footer, opened under `icon`.
    func linksPanel(icon: NSRect = NSRect(x: 100, y: 1000, width: 24, height: 24), acted: @escaping (String) -> Void = { _ in }) -> MenuBarPanel {
        let panel = MenuBarPanel(width: 400, state: PanelState(pasteboard: .withUniqueName())) {
            Header("links", note: "links it opened")
            Row(Words("a.example.com"), trailing: "work", id: "a", page: { Self.linkPage("a", acted) })
            Row(Words("b.example.com"), trailing: "home", id: "b", page: { Self.linkPage("b", acted) })
            Row(Words("c.example.com"), trailing: "home", opens: false, id: "c") { acted("c") }
            Footer([FooterItem("settings", key: ",") { acted("settings") }])
        }
        panel.open(below: icon, in: Self.screen)
        panel.contentView?.layoutSubtreeIfNeeded()
        return panel
    }

    /// The pointer travels, then rests on the line `id`, long enough for the panel to take it as meant.
    func rest(_ panel: MenuBarPanel, on id: AnyHashable) {
        panel.state.pointerOver = id
        panel.pointerMoved(to: NSPoint(x: 0, y: 0), at: 0)
        panel.pointerMoved(to: NSPoint(x: 0, y: 20), at: 1)
        panel.pointerHeld(at: 1 + PointerIntent.wait)
    }

    @Test func aHeldPointerOpensTheRowsSidePageLevelWithIt() throws {
        let panel = linksPanel()
        let list = panel.frame
        rest(panel, on: "b")
        #expect(panel.state.sidePage == AnyHashable("b"))
        #expect(panel.state.selected == AnyHashable("b"))
        let side = try #require(panel.sidePanel)
        // To the right, its first line where row b starts: under the frame's top line, the header and row a.
        #expect(side.frame.minX == list.maxX + MenuBarPanel.gap)
        #expect(side.frame.maxY - Metrics.line == list.maxY - (Metrics.line + Metrics.header + Metrics.row))
        #expect(side.frame.height > list.height)
    }

    @Test func theListNeverMovesWhenTheSidePageOpens() throws {
        var acted: [String] = []
        let panel = linksPanel { acted.append($0) }
        let list = panel.frame
        let lines = panel.state.list.lines.map(\.id)
        rest(panel, on: "a")
        rest(panel, on: "b")
        // The page is taller than the list and reports its own height and lines, which leave the list's alone.
        #expect(panel.state.sidePage == AnyHashable("b"))
        #expect(try #require(panel.sidePanel).frame.height != list.height)
        #expect(panel.frame == list)
        #expect(panel.state.list.lines.map(\.id) == lines)
        #expect(lines == ["a", "b", "c", ["footer", "settings"]])
        rest(panel, on: "c")
        panel.sendEvent(key("\r", code: 36))
        #expect(acted == ["c"])
    }

    @Test func theSidePageOpensOnTheLeftAtTheScreensRightEdge() throws {
        // Under an icon near the right edge, the list ends 4 points from it, so the page has no room on the right.
        let panel = linksPanel(icon: Self.icon)
        rest(panel, on: "a")
        #expect(try #require(panel.sidePanel).frame.maxX == panel.frame.minX - MenuBarPanel.gap)
        // A row near the bottom of the screen keeps a tall page inside it.
        let low = MenuBarPanel.place(side: NSSize(width: 400, height: 300), beside: NSRect(x: 0, y: 50, width: 400, height: 44),
                                     of: NSRect(x: 0, y: 0, width: 400, height: 500), in: Self.screen)
        #expect(low.minY == MenuBarPanel.gap)
        #expect(low.minX == 400 + MenuBarPanel.gap)
        // With room on neither side, it goes to the side with more and covers part of the list, inside the screen.
        let narrow = NSRect(x: 0, y: 0, width: 1024, height: 768)
        let list = NSRect(x: 300, y: 300, width: 480, height: 400)
        let cramped = MenuBarPanel.place(side: NSSize(width: 480, height: 300), beside: NSRect(x: 300, y: 600, width: 480, height: 44),
                                         of: list, in: narrow)
        // 296 points free on the left and 240 on the right.
        #expect(cramped.minX == narrow.minX + MenuBarPanel.gap)
    }

    @Test func aClickOnARowOpensItsSidePageAndAClickInThePageActs() throws {
        var acted: [String] = []
        let panel = linksPanel { acted.append($0) }
        panel.state.clicked("b", opensSide: true) { acted.append("the row's action") }
        #expect(panel.state.sidePage == AnyHashable("b"))
        #expect(panel.state.selected == AnyHashable("b"))
        let line = try #require(panel.state.side.lines.dropFirst().first)
        panel.state.clicked(line.id, opensSide: line.opensSide, action: line.action)
        #expect(acted == ["b in work"])
        #expect(panel.state.sidePage == AnyHashable("b"))
    }

    @Test func aSidePageFollowsTheListWhenItOpensAgainWhileOpen() throws {
        let panel = linksPanel()
        rest(panel, on: "a")
        panel.open(below: NSRect(x: 300, y: 1000, width: 24, height: 24), in: Self.screen)
        #expect(try #require(panel.sidePanel).frame.minX == panel.frame.maxX + MenuBarPanel.gap)
    }

    @Test func rightOrReturnOpensTheSidePageAndLeftOrEscapeComesBack() {
        let panel = linksPanel()
        // The keys stopping on a row open nothing, as in a menu.
        panel.sendEvent(key(Self.down, code: 125))
        #expect(panel.state.selected == AnyHashable("a"))
        #expect(panel.state.sidePage == nil)
        panel.sendEvent(key(Self.right, code: 124))
        #expect(panel.state.sidePage == AnyHashable("a"))
        #expect(panel.state.selected == AnyHashable(["a", "home"]))
        panel.sendEvent(key(Self.left, code: 123))
        #expect(panel.state.sidePage == nil)
        #expect(panel.state.selected == AnyHashable("a"))
        panel.sendEvent(key("\r", code: 36))
        #expect(panel.state.sidePage == AnyHashable("a"))
        #expect(panel.state.selected == AnyHashable(["a", "home"]))
        panel.sendEvent(key("\u{1b}", code: 53))
        #expect(panel.isOpen)
        #expect(panel.state.sidePage == nil)
        #expect(panel.state.selected == AnyHashable("a"))
        panel.sendEvent(key("\u{1b}", code: 53))
        #expect(!panel.isOpen)
    }

    @Test func upAndDownStayInTheSidePage() {
        var acted: [String] = []
        let panel = linksPanel { acted.append($0) }
        panel.sendEvent(key(Self.down, code: 125))
        panel.sendEvent(key(Self.right, code: 124))
        for _ in 0..<8 { panel.sendEvent(key(Self.down, code: 125)) }
        #expect(panel.state.selected == AnyHashable(["a", "shop"]))
        for _ in 0..<8 { panel.sendEvent(key(Self.up, code: 126)) }
        #expect(panel.state.selected == AnyHashable(["a", "home"]))
        #expect(panel.state.sidePage == AnyHashable("a"))
        panel.sendEvent(key(Self.down, code: 125))
        panel.sendEvent(key("\r", code: 36))
        #expect(acted == ["a in work"])
    }

    @Test func restingOnAnotherRowSwapsTheSidePage() {
        let panel = linksPanel()
        rest(panel, on: "a")
        #expect(panel.state.sidePage == AnyHashable("a"))
        // Into the page, which stays open, and its row with it.
        rest(panel, on: ["a", "work"])
        #expect(panel.state.sidePage == AnyHashable("a"))
        #expect(panel.state.selected == AnyHashable(["a", "work"]))
        rest(panel, on: "b")
        #expect(panel.state.sidePage == AnyHashable("b"))
        rest(panel, on: "c")
        #expect(panel.state.sidePage == nil)
        #expect(panel.state.selected == AnyHashable("c"))
        // The keys moving off the open row close its page too.
        rest(panel, on: "b")
        panel.sendEvent(key(Self.down, code: 125))
        #expect(panel.state.selected == AnyHashable("c"))
        #expect(panel.state.sidePage == nil)
    }

    @Test func aClickInTheSidePageKeepsBothOpenAndOutsideClosesBoth() throws {
        let panel = linksPanel()
        rest(panel, on: "a")
        let side = try #require(panel.sidePanel)
        panel.clicked(at: NSPoint(x: side.frame.midX, y: side.frame.midY))
        #expect(panel.isOpen)
        #expect(panel.state.sidePage == AnyHashable("a"))
        panel.clicked(at: NSPoint(x: side.frame.maxX + 50, y: side.frame.midY))
        #expect(!panel.isOpen)
        #expect(panel.state.sidePage == nil)
    }

    @Test func theSidePageStaysOffTheScreenInTests() throws {
        let panel = linksPanel()
        rest(panel, on: "a")
        let side = try #require(panel.sidePanel)
        #expect(!side.isVisible)
        #expect(side.parent == nil)
        #expect(!side.canBecomeKey)
    }

    @Test func theOpenPanelFitsItsContent() {
        let panel = panel()
        // A 40 point header, three 44 point rows, a 36 point footer and the 1 point border above and below.
        let expected: CGFloat = 40 + 3 * 44 + 36 + 2
        #expect(panel.frame.height == expected)
        #expect(panel.frame.maxY == Self.icon.minY - MenuBarPanel.gap)
    }
}
