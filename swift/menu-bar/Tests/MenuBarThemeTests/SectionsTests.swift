import AppKit
import SwiftUI
import Testing
@testable import MenuBarTheme
@testable import menu_bar_snapshots

/// The pieces that give a panel sections, at the sizes the Beeline Menu Studies page's D and E draw them, in the plain
/// look they were drawn in, light. Nothing is put on the screen: the panel stays off it and drawing goes through `snapshot`.
/// The look is given to each drawing, never set for the app here, since other suites run beside this one and set their own:
/// a test that needs `Look.app` sets it and puts it back within its own body.
@MainActor
@Suite struct SectionsTests {
    init() {
        _ = NSApplication.shared
        MenuBarPanel.staysOffScreen = true
    }

    static let light = NSAppearance(named: .aqua)!
    /// A role's plain light value, the color the snapshots below draw in.
    func plain(_ palette: Palette) -> UInt32 { palette.plain(accent: Look.defaultAccent).light }

    /// `content` drawn alone, without the room a panel keeps at its top and bottom, so a piece is measured from its own top.
    func draw(selecting id: AnyHashable? = nil, @ViewBuilder _ content: () -> some View) throws -> NSBitmapImageRep {
        let state = PanelState(pasteboard: .withUniqueName())
        state.selected = id
        return try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .plain(), state: state,
                                                                edgeRoom: false, content)))
    }

    /// How tall `content` draws, without the panel's border above and below.
    func height(@ViewBuilder _ content: () -> some View) throws -> CGFloat {
        CGFloat(try draw(content).pixelsHigh) / 2 - 2
    }

    /// The color at `x`, `y` points inside the panel's 1 point border.
    func color(_ rep: NSBitmapImageRep, _ x: CGFloat, _ y: CGFloat) -> UInt32 {
        var pixel = [Int](repeating: 0, count: 4)
        rep.getPixel(&pixel, atX: Int((1 + x) * 2), y: Int((1 + y) * 2))
        return UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2])
    }

    @Test func eachPieceIsTheDrawingsHeight() throws {
        // A line of text is 1.4 times its size in the plain look: 16.8 at 12, 18.2 at 13, to the half point a Retina
        // screen draws.
        #expect(abs(try height { PanelSectionLabel("Opened recently") } - (24 + 16.8 + 8)) <= 0.5)
        #expect(abs(try height { PanelSectionLabel("Needs you", first: true) } - (14 + 16.8 + 8)) <= 0.5)
        #expect(abs(try height { ProblemRow("Profile 6 is open without Beeline", detail: "Links there are unknown to Beeline.", fix: "Set it up…") {} }
            - (2 + 18.2 + 2 + 16.8 + 4)) <= 0.5)
        #expect(try height { CompactRow("budget.example.com", time: "1:11 PM", trailing: "Personal", id: "a") {} } == 30)
        #expect(try height {
            CompactRow("alpha", icon: RowIcon(Image(systemName: "desktopcomputer")), trailing: "offline", dot: .error, key: "o", id: "a") {}
        } == 30)
        #expect(try height { CompactList { CompactRow("Personal", opens: false, id: "a") {} } } == 34)
        #expect(try height { CompactList(closing: true) { CompactRow("Change it in Settings…", opens: false, id: "a") {} } } == 8 + 1 + 4 + 30 + 10)
        #expect(try height { Footer([FooterItem("Settings…", key: ",") {}], lineAbove: true) } == 36)
    }

    @Test func aSelectedCompactRowFillsSixPointsInWithTheDarkerFill() throws {
        let row = { CompactRow("budget.example.com", time: "1:11 PM", trailing: "Personal", id: "a") {} }
        let selected = try draw(selecting: "a", row)
        #expect(color(selected, 8, 15) == plain(.hover))
        #expect(color(selected, 400 - 2 - 8, 15) == plain(.hover))
        // The 6 points at each side stay paper.
        #expect(color(selected, 3, 15) == plain(.bg))
        #expect(color(selected, 400 - 2 - 3, 15) == plain(.bg))
        #expect(color(try draw(row), 8, 15) == plain(.bg))
        #expect(plain(.hover) == 0xdfddd6)
    }

    @Test func aSelectedProblemRowFillsLikeACompactRow() throws {
        let row = { ProblemRow("Profile 6 is open without Beeline", detail: "Links there are unknown to Beeline.", fix: "Set it up…", id: "p") {} }
        let selected = try draw(selecting: "p", row)
        #expect(color(selected, 8, 21) == plain(.hover))
        #expect(color(selected, 3, 21) == plain(.bg))
        #expect(color(try draw(row), 8, 21) == plain(.bg))
    }

    /// The darkest pixel's columns in `rep` between `x0` and `x1` points, over its whole height: where something is drawn.
    func inked(_ rep: NSBitmapImageRep, from x0: CGFloat, to x1: CGFloat) -> [Int] {
        (Int((1 + x0) * 2)..<Int((1 + x1) * 2)).filter { x in
            (0..<rep.pixelsHigh).contains { y in
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: x, y: y)
                return pixel[0] < 0xc0
            }
        }
    }

    @Test func aRowsProfileStaysInItsColumnWhateverItsTime() throws {
        // From the right: the 20 point side, the 6 point mark, 12, then the 56 point column, 12, and the 62 point time.
        let right: CGFloat = 400 - 2 - 20 - 6 - 12
        let column = (from: right - Metrics.trailingColumn, to: right)
        let short = try draw { CompactRow("budget.example.com", time: "1:11 PM", trailing: "Personal", id: "a") {} }
        let long = try draw { CompactRow("budget.example.com", time: "12:58 PM", trailing: "Personal", id: "a") {} }
        let drawn = inked(short, from: column.from, to: column.to)
        #expect(!drawn.isEmpty)
        #expect(drawn == inked(long, from: column.from, to: column.to))
        // The profile starts where its column starts, and a name too long for it is cut short inside it.
        #expect(drawn.first.map { abs(CGFloat($0) / 2 - 1 - column.from) <= 1.5 } == true)
        let cut = try draw { CompactRow("budget.example.com", time: "1:11 PM", trailing: "A profile with a long name", id: "a") {} }
        #expect(inked(cut, from: column.to, to: column.to + 12).isEmpty)
    }

    @Test func theHeadersTitleIsAPopupsTitleInPlainAndTheBodysInConsole() {
        let before = Look.app
        defer { Look.app = before }
        Look.app = .plain()
        #expect(Header("Beeline").titleSize == PlainMetrics.titlePopup)
        #expect(PlainMetrics.titlePopup == 15)
        Look.app = .console
        #expect(Header("fleet").titleSize == Metrics.body)
    }

    @Test func aFooterWithALineAboveDrawsItAlongItsTop() throws {
        let footer = { (line: Bool) in Footer([FooterItem("Settings…", key: ",") {}], trailing: [FooterItem("Quit", key: "q") {}], lineAbove: line) }
        #expect(color(try draw { footer(true) }, 200, 0) == plain(.border))
        #expect(color(try draw { footer(false) }, 200, 0) == plain(.bg))
    }

    /// The machines-icons sample, Fleet's menu, drawn as the panel draws it, with `id` selected.
    func fleetMenu(selecting id: AnyHashable) throws -> NSBitmapImageRep {
        let sample = try #require(samples.first { $0.name == "machines-icons" })
        let state = PanelState(pasteboard: .withUniqueName())
        state.selected = id
        return try #require(NSBitmapImageRep(data: try snapshot(width: sample.width, appearance: Self.light, look: .plain(), state: state) {
            sample.content()
        }))
    }

    /// The first and last point, in steps of a pixel down the middle, inside the panel's border, drawn in `hex`.
    func span(_ rep: NSBitmapImageRep, of hex: UInt32, x: CGFloat) -> (first: CGFloat, last: CGFloat)? {
        let ys = stride(from: CGFloat(0), to: CGFloat(rep.pixelsHigh) / 2 - 2, by: 0.5).filter { color(rep, x, $0) == hex }
        return ys.first.flatMap { first in ys.last.map { (first, $0) } }
    }

    @Test func aPanelThatStartsWithRowsHasTheRoomAboveThemThatItHasBelowItsLastRow() throws {
        // Fleet's menu opens on its machines, with no header: the first row's fill starts 10 points below the panel's
        // top edge, the room the panel keeps there.
        let first = try #require(span(try fleetMenu(selecting: ["machine", "alpha"]), of: plain(.hover), x: 150))
        #expect(first.first == Metrics.panelEdge)
        #expect(first.last == Metrics.panelEdge + PlainMetrics.rowCompact - 0.5)
        // The last row's fill ends the same 10 points above the footer's line, which sits on the bottom edge.
        let menu = try fleetMenu(selecting: "dashboard")
        let last = try #require(span(menu, of: plain(.hover), x: 150))
        let inside = CGFloat(menu.pixelsHigh) / 2 - 2
        let footerLine = inside - Metrics.footer
        #expect(color(menu, 150, footerLine) == plain(.border))
        #expect(footerLine - (last.last + 0.5) == first.first)
    }

    @Test func aFirstLabelWithNoHeaderSitsTwentyFourBelowTheEdgeAndUnderAHeaderStaysWhereItWas() throws {
        let state = { PanelState(pasteboard: .withUniqueName()) }
        let ink = { (rep: NSBitmapImageRep) in
            stride(from: CGFloat(0), to: 80, by: 0.5).first { y in
                stride(from: CGFloat(20), to: 200, by: 0.5).contains { self.color(rep, $0, y) != self.plain(.bg) }
            }
        }
        let alone = try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .plain(), state: state()) {
            PanelSectionLabel("Needs you", first: true)
            CompactList { CompactRow("alpha", opens: false, id: "a") {} }
        }))
        let unroomed = try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .plain(), state: state(),
                                                                         edgeRoom: false) {
            PanelSectionLabel("Needs you", first: true)
            CompactList { CompactRow("alpha", opens: false, id: "a") {} }
        }))
        // The label's 14 of room, then the panel's 10 above it.
        let label = try #require(ink(unroomed))
        #expect(label >= 14)
        #expect(try #require(ink(alone)) == label + Metrics.panelEdge)
        // Drawn to the nearest pixel, as the label's 16.8 point line rounds.
        #expect(abs(CGFloat(alone.pixelsHigh) / 2 - 2 - (14 + 16.8 + 8 + 30 + 4 + 2 * Metrics.panelEdge)) <= 0.5)
        // Under a header, the header takes the panel's top room, and the label stays 14 below it.
        let headed = try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .plain(), state: state()) {
            Header("Beeline")
            PanelSectionLabel("Needs you", first: true)
        }))
        #expect(color(headed, 200, 0) == plain(.surface))
        #expect(abs(CGFloat(headed.pixelsHigh) / 2 - 2 - (Metrics.header + 14 + 16.8 + 8 + Metrics.panelEdge)) <= 0.5)
    }

    @Test func aSectionLabelIsSecondaryInThePanelAndInAWindow() throws {
        let panel = try draw { PanelSectionLabel("Opened recently") }
        let window = try #require(NSBitmapImageRep(data: try windowSnapshot(width: 400, appearance: Self.light, look: .plain()) { SectionLabel("Profiles") }))
        // A glyph's edges blend into the paper, so the text's own color is its darkest ink: secondary, where muted would
        // leave nothing darker than #8e9197.
        let channels = { (hex: UInt32) in [Int(hex >> 16 & 0xff), Int(hex >> 8 & 0xff), Int(hex & 0xff)] }
        for rep in [panel, window] {
            var darkest = [255, 255, 255]
            for y in 0..<rep.pixelsHigh {
                for x in 0..<rep.pixelsWide {
                    var pixel = [Int](repeating: 0, count: 4)
                    rep.getPixel(&pixel, atX: x, y: y)
                    if pixel[3] == 255, pixel[0] + pixel[1] + pixel[2] < darkest.reduce(0, +) { darkest = Array(pixel[0..<3]) }
                }
            }
            let secondary = channels(plain(.secondary))
            #expect(zip(darkest, secondary).allSatisfy { abs($0 - $1) <= 6 }, "the label's darkest ink is \(darkest)")
        }
    }

    @Test func theArrowKeysPassOverTheLabelsAndAClosingListComesBeforeTheFooter() {
        var acted: [String] = []
        let panel = MenuBarPanel(width: 480, state: PanelState(pasteboard: .withUniqueName())) {
            Header("Beeline")
            PanelSectionLabel("Needs you", first: true)
            ProblemRow("Profile 6 is open without Beeline", detail: "Links there are unknown to Beeline.", fix: "Set it up…", id: "problem") {
                acted.append("set up")
            }
            PanelSectionLabel("Opened recently")
            CompactList {
                CompactRow("budget.example.com", time: "1:11 PM", trailing: "Personal", opens: false, id: "budget") { acted.append("budget") }
                CompactRow("share.example.com", time: "12:58 PM", trailing: "Work", opens: false, id: "share") { acted.append("share") }
            }
            Footer([FooterItem("Settings…", key: ",") {}], lineAbove: true)
        }
        panel.open(below: NSRect(x: 1200, y: 1000, width: 24, height: 24), in: NSRect(x: 0, y: 0, width: 1440, height: 1000))
        panel.contentView?.layoutSubtreeIfNeeded()
        #expect(panel.state.list.lines.map(\.id) == ["problem", "budget", "share", ["footer", "Settings…"]])
        let down = String(UnicodeScalar(UInt16(NSDownArrowFunctionKey))!)
        let key = { (characters: String, code: UInt16) in
            NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
                             characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
        }
        panel.sendEvent(key(down, 125))
        panel.sendEvent(key("\r", 36))
        panel.sendEvent(key(down, 125))
        #expect(panel.state.selected == AnyHashable("budget"))
        panel.sendEvent(key("\r", 36))
        #expect(acted == ["set up", "budget"])
        panel.close()
    }

    @Test func aRowsArrowShowsOnlyWhenItIsSelectedInPlainAndAlwaysInConsole() throws {
        let row = { CompactRow("budget.example.com", time: "1:11 PM", trailing: "Personal", id: "a") {} }
        // The arrow's column: the 20 point side and the 6 point mark, at the row's right.
        let column = (from: 400 - 2 - 20 - 6 as CGFloat, to: 400 - 2 - 20 as CGFloat)
        #expect(inked(try draw(row), from: column.from, to: column.to).isEmpty)
        #expect(!inked(try draw(selecting: "a", row), from: column.from, to: column.to).isEmpty)
        // Its column stays, so the time and profile sit where they did.
        let unselected = try draw(row)
        let selected = try draw(selecting: "a", row)
        // On the darker fill the letters' smoothing inks a pixel or two more at their edges, so where they start and end is
        // held to the point and a half the profile's column is held to.
        let words = { (rep: NSBitmapImageRep) in inked(rep, from: 200, to: column.from - 6) }
        #expect(abs((words(unselected).first ?? 0) - (words(selected).first ?? -9)) <= 3)
        #expect(abs((words(unselected).last ?? 0) - (words(selected).last ?? -9)) <= 3)
        let console = try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .console, state: PanelState(pasteboard: .withUniqueName()), row)))
        #expect(!inked(console, from: column.from + 6, to: column.to + 6).isEmpty)
    }

    @Test func aSidePagesGroupsSitUnderALineButNotItsFirstOrInTheList() throws {
        let label = { (first: Bool, inSide: Bool) in PanelSectionLabel("Open once in", first: first).environment(\.inSidePage, inSide) }
        // 8 below the group above, a line, then the label's own 24 less those 9: as tall as a label anywhere.
        let lined = try draw { label(false, true) }
        #expect(color(lined, 200, 8) == plain(.border))
        #expect(color(lined, 200, 6) == plain(.bg))
        #expect(color(lined, 200, 10) == plain(.bg))
        #expect(try height { label(false, true) } == height { label(false, false) })
        #expect(color(try draw { label(false, false) }, 200, 8) == plain(.bg))
        #expect(color(try draw { label(true, true) }, 200, 8) == plain(.bg))
        let console = try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .console) { label(false, true) }))
        #expect(color(console, 200, 8) == Palette.bg.light)
    }

    @Test func aCompactRowWithAPageOpensItBesideTheList() throws {
        let before = Look.app
        defer { Look.app = before }
        Look.app = .plain()
        let sample = try #require(samples.first { $0.name == "beeline-d-selected" })
        let rep = try #require(NSBitmapImageRep(data: try render(sample, appearance: Self.light)))
        #expect(rep.pixelsWide == Int((sample.width + MenuBarPanel.gap + (sample.sideWidth ?? sample.width)) * 2))
        // The page's first line sits level with its row: nothing drawn beside the header, the page there beside the row.
        let page = sample.width + MenuBarPanel.gap + 20
        let drawn = { (y: CGFloat) in
            var pixel = [Int](repeating: 0, count: 4)
            rep.getPixel(&pixel, atX: Int(page * 2), y: Int(y * 2))
            return pixel[3] > 0
        }
        #expect(!drawn(20))
        #expect(drawn(200))
    }

    // A compact row's icon, dot and key, from the Fleet Window Studies page's F with L's marks. In the plain look a row's
    // words start 20 points in, so its icon's column runs from 20 to 52 and its words from 60, and its right side ends 20
    // points in from the panel's 398 point inside.

    static let dark = NSAppearance(named: .darkAqua)!

    /// `content` drawn alone 400 wide in the plain look, light or dark, nothing selected, without the panel's edge room.
    func draw(light: Bool, @ViewBuilder _ content: () -> some View) throws -> NSBitmapImageRep {
        try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: light ? Self.light : Self.dark, look: .plain(),
                                                         state: PanelState(pasteboard: .withUniqueName()), edgeRoom: false, content)))
    }

    func pick(_ palette: Palette, light: Bool) -> UInt32 {
        light ? palette.plain(accent: Look.defaultAccent).light : palette.plain(accent: Look.defaultAccent).dark
    }

    /// The points, in steps of a pixel, inside `x` and `y` whose color is within `within` of `hex` in red, green and blue.
    func points(_ rep: NSBitmapImageRep, near hex: UInt32, within: Int = 24, x: ClosedRange<CGFloat>, y: ClosedRange<CGFloat> = 0...30)
        -> [(x: CGFloat, y: CGFloat)] {
        stride(from: y.lowerBound, through: y.upperBound, by: 0.5).flatMap { py in
            stride(from: x.lowerBound, through: x.upperBound, by: 0.5).compactMap { px in
                let found = color(rep, px, py)
                let near = [16, 8, 0].allSatisfy { abs(Int((found >> $0) & 0xff) - Int((hex >> $0) & 0xff)) <= within }
                return near ? (px, py) : nil
            }
        }
    }

    @Test(arguments: [true, false])
    func aCompactRowsIconSitsInItsColumnInItsTone(light: Bool) throws {
        let rep = try draw(light: light) {
            CompactRow("delta", icon: RowIcon(Image(systemName: "laptopcomputer"), tone: .error), opens: false, id: "a") {}
        }
        let drawn = points(rep, near: pick(.error, light: light), within: 8, x: 0...398)
        #expect(drawn.count > 40)
        #expect(drawn.allSatisfy { (20...52).contains($0.x) && (6...24).contains($0.y) })
        // Fitted to the 28 by 18 points an icon takes, centered in its column and on the row.
        let xs = drawn.map(\.x), ys = drawn.map(\.y)
        #expect(try #require(xs.max()) - #require(xs.min()) <= RowIcon.width)
        #expect(try #require(ys.max()) - #require(ys.min()) <= RowIcon.height)
        #expect(abs((try #require(xs.max()) + #require(xs.min())) / 2 - 36) <= 1)
        #expect(abs((try #require(ys.max()) + #require(ys.min())) / 2 - 15) <= 1)
    }

    @Test func anIconOfAnySizeFitsItsColumnAndOnlyAOneColorOneTakesTheTone() throws {
        let drawing = { (template: Bool) in
            let image = NSImage(size: NSSize(width: 200, height: 100), flipped: false) { rect in
                NSColor(srgbRed: 0, green: 0, blue: 1, alpha: 1).setFill()
                rect.fill()
                return true
            }
            image.isTemplate = template
            return Image(nsImage: image)
        }
        let template = try draw(light: true) { CompactRow("delta", icon: RowIcon(drawing(true), tone: .error), opens: false, id: "a") {} }
        let drawn = points(template, near: plain(.error), within: 8, x: 0...398)
        // Two to one, so 28 wide and 14 tall, in the tone.
        #expect(abs(try #require(drawn.map(\.x).max()) - #require(drawn.map(\.x).min()) - (RowIcon.width - 0.5)) <= 1)
        #expect(abs(try #require(drawn.map(\.y).max()) - #require(drawn.map(\.y).min()) - (RowIcon.width / 2 - 0.5)) <= 1)
        let colored = try draw(light: true) { CompactRow("delta", icon: RowIcon(drawing(false), tone: .error), opens: false, id: "a") {} }
        #expect(points(colored, near: plain(.error), within: 8, x: 0...398).isEmpty)
        #expect(points(colored, near: 0x0000ff, within: 8, x: 20...52).count > 100)
    }

    @Test func aCompactRowsWordsSitAtOneHeightWhateverItsIcon() throws {
        /// The top and bottom of the words' ink, from 60 points in, where no icon reaches.
        func words(_ icon: RowIcon?) throws -> (CGFloat, CGFloat) {
            let ink = points(try draw(light: true) { CompactRow("delta", icon: icon, opens: false, id: "a") {} },
                             near: plain(.text), within: 60, x: 60...140)
            return (try #require(ink.map(\.y).min()), try #require(ink.map(\.y).max()))
        }
        // With no icon the words start at 20, so their own first 40 points are what reach past 60; the same text with
        // an icon starts at 60. Its height is what is compared.
        let bare = points(try draw(light: true) { CompactRow("delta", opens: false, id: "a") {} }, near: plain(.text), within: 60, x: 20...100)
        let expected = (try #require(bare.map(\.y).min()), try #require(bare.map(\.y).max()))
        for name in ["laptopcomputer", "desktopcomputer", "macmini", "questionmark.square.dashed", "no.such.symbol"] {
            let found = try words(RowIcon(Image(systemName: name)))
            #expect(found == expected, "\(name)")
        }
    }

    @Test func aSymbolTheMacLacksLeavesItsColumnEmpty() throws {
        let rep = try draw(light: true) { CompactRow("delta", icon: RowIcon(Image(systemName: "no.such.symbol")), opens: false, id: "a") {} }
        // From 4 in, past the panel's rounded corner, to the words' start.
        #expect(points(rep, near: plain(.bg), within: 0, x: 4...56, y: 2...28).count == 105 * 53)
        #expect(!points(rep, near: plain(.text), within: 60, x: 60...140).isEmpty)
    }

    @Test(arguments: [true, false])
    func aCompactRowsDotIsItsToneAtItsRight(light: Bool) throws {
        let rep = try draw(light: light) { CompactRow("alpha", dot: .ok, opens: false, id: "a") {} }
        // 8 across, 3 in from the row's right side at 378, sitting on the words' baseline as a lowercase letter does:
        // from 12 to 20, its middle a point below the row's.
        #expect(color(rep, 371, 16) == pick(.ok, light: light))
        #expect(color(rep, 371, 13) == pick(.ok, light: light))
        #expect(color(rep, 371, 19) == pick(.ok, light: light))
        #expect(color(rep, 371, 11) == pick(.bg, light: light))
        #expect(color(rep, 371, 21) == pick(.bg, light: light))
        #expect(color(rep, 376, 15) == pick(.bg, light: light))
        #expect(color(rep, 365, 15) == pick(.bg, light: light))
        // After the word on the right, and before the arrow, which stays last.
        let both = try draw(light: light) { CompactRow("charlie-2", trailing: "offline", dot: .error, id: "a") {} }
        let dot = points(both, near: pick(.error, light: light), within: 8, x: 200...398)
        #expect(try #require(dot.map(\.x).max()) < 378 - 6 - 12)
    }

    @Test func aCompactRowsKeyIsMutedAtItsRight() throws {
        let rep = try draw(light: true) { CompactRow("Quit", key: "q", opens: false, id: "quit") {} }
        let key = points(rep, near: plain(.muted), within: 16, x: 200...398)
        #expect(key.count > 20)
        #expect(try #require(key.map(\.x).max()) <= 378)
        #expect(try #require(key.map(\.x).min()) > 378 - 30)
    }
}
