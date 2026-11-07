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
    func plain(_ palette: Palette) -> UInt32 { palette.plain(accent: .default).light }

    func draw(selecting id: AnyHashable? = nil, @ViewBuilder _ content: () -> some View) throws -> NSBitmapImageRep {
        let state = PanelState(pasteboard: .withUniqueName())
        state.selected = id
        return try #require(NSBitmapImageRep(data: try snapshot(width: 400, appearance: Self.light, look: .plain(), state: state, content)))
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

    @Test func aCompactRowWithAPageOpensItBesideTheList() throws {
        let before = Look.app
        defer { Look.app = before }
        Look.app = .plain()
        let sample = try #require(samples.first { $0.name == "beeline-d-selected" })
        let rep = try #require(NSBitmapImageRep(data: try render(sample, appearance: Self.light)))
        #expect(rep.pixelsWide == Int((2 * sample.width + MenuBarPanel.gap) * 2))
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
}
