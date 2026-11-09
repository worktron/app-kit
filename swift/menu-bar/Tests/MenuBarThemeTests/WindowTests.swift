import AppKit
import SwiftUI
import Testing
@testable import MenuBarTheme
@testable import menu_bar_snapshots

/// A window's pieces and the plain look's controls, drawn through `windowSnapshot(look:)`, which sets the look for its
/// draw and puts the suite's back, so nothing opens on the screen and no test leaves the look set.
@MainActor
@Suite struct WindowTests {
    init() { _ = NSApplication.shared }

    static let light = NSAppearance(named: .aqua)!
    static let dark = NSAppearance(named: .darkAqua)!

    /// Each sRGB value a PNG holds, with how many opaque pixels have it.
    func counts(_ png: Data) throws -> (count: [UInt32: Int], total: Int) {
        let rep = try #require(NSBitmapImageRep(data: png))
        var count: [UInt32: Int] = [:]
        for y in 0..<rep.pixelsHigh {
            for x in 0..<rep.pixelsWide {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: x, y: y)
                guard pixel[3] == 255 else { continue }
                count[UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2]), default: 0] += 1
            }
        }
        return (count, rep.pixelsWide * rep.pixelsHigh)
    }

    /// How many opaque pixels are within `within` of `hex` in each of red, green and blue: text at 13 points is mostly
    /// edges, which blend into the paper, so few pixels are exactly its color, in dark fewer still.
    func near(_ png: Data, _ hex: UInt32, within: Int = 24) throws -> Int {
        try counts(png).count.filter { color, _ in
            [16, 8, 0].allSatisfy { abs(Int((color >> $0) & 0xff) - Int((hex >> $0) & 0xff)) <= within }
        }.values.reduce(0, +)
    }

    func pick(_ palette: Palette, light: Bool, accent: Accent = Look.defaultAccent) -> UInt32 {
        light ? palette.plain(accent: accent).light : palette.plain(accent: accent).dark
    }

    @Test(arguments: ["window-setup", "window-profiles", "window-general"], [true, false])
    func aWindowFillsInThePaperWithHairlinesBetweenItsRows(screen: String, light: Bool) throws {
        let sample = try #require(windowSamples.first { $0.name == screen })
        let before = Look.app
        let png = try windowSnapshot(width: sample.width, appearance: light ? Self.light : Self.dark, look: .plain()) { sample.content() }
        #expect(Look.app == before, "the snapshot puts the look back")
        let (count, total) = try counts(png)
        // The paper fills the whole window, to its edges: no band left undrawn above or below the page.
        #expect(count[pick(.bg, light: light), default: 0] > total * 3 / 4)
        let rep = try #require(NSBitmapImageRep(data: png))
        for (x, y) in [(0, 0), (rep.pixelsWide - 1, 0), (0, rep.pixelsHigh - 1), (rep.pixelsWide - 1, rep.pixelsHigh - 1)] {
            var pixel = [Int](repeating: 0, count: 4)
            rep.getPixel(&pixel, atX: x, y: y)
            #expect(UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2]) == pick(.bg, light: light), "corner \(x), \(y)")
        }
        // Each hairline is a full row of pixels across the content, 24 points in from each side: 2 pixels at scale 2.
        #expect(count[pick(.border, light: light), default: 0] > Int(sample.width - 48) * 2 * 3)
        // No box, no card: nothing is filled in surfaceHi or hover. An edge of a word may blend to one, a few hundred
        // pixels at most; the smallest box, a field, would fill thousands.
        #expect(count[pick(.surfaceHi, light: light), default: 0] < 1000)
        #expect(count[pick(.hover, light: light), default: 0] < 1000)
    }

    @Test(arguments: [true, false])
    func aSwitchThatIsOnFillsInTheAccentAndOneThatIsOffIsAMutedOutline(light: Bool) throws {
        let accent = Accent(light: 0x7a2fa7, dark: 0xd29be6)
        let draw = { (on: Bool) in
            try windowSnapshot(width: 60, appearance: light ? Self.light : Self.dark, look: .plain(accent: accent)) {
                Switch("A setting", isOn: .constant(on)).padding(10).background(Palette.bg.color)
            }
        }
        let on = try counts(try draw(true)).count
        let off = try counts(try draw(false)).count
        // 28 by 16 points at scale 2, less its rounded ends and its knob: well over 400 pixels of fill.
        #expect(on[pick(.info, light: light, accent: accent), default: 0] > 400)
        #expect(on[pick(.bg, light: light), default: 0] > 0, "the knob is the paper")
        #expect(off[pick(.info, light: light, accent: accent), default: 0] == 0)
        // The outline and the knob, and the paper inside the outline: not filled.
        #expect(off[pick(.muted, light: light), default: 0] > 100)
    }

    @Test(arguments: [true, false])
    func aRemovalIsInTheErrorColorAndAnActionInTheAccent(light: Bool) throws {
        let png = try windowSnapshot(width: 200, appearance: light ? Self.light : Self.dark, look: .plain()) {
            WindowPage {
                HStack {
                    ActionWord("Forget all", removes: true) {}
                    ActionWord("Test") {}
                }
            }
        }
        // Each word draws dozens of pixels in or near its color.
        #expect(try near(png, pick(.error, light: light)) > 20)
        #expect(try near(png, pick(.info, light: light)) > 20)
    }

    @Test func aMenuReadsAsItsChoiceOverAHairlineAndAFieldSitsInAHairlineBox() throws {
        let png = try windowSnapshot(width: 300, appearance: Self.light, look: .plain()) {
            WindowPage {
                TextMenu(selection: .constant(2), options: [(value: 1, name: "Personal"), (value: 2, name: "Work")])
                HairlineField("A link", text: .constant("https://example.com/"))
            }
        }
        let count = try counts(png).count
        // The menu's hairline under its words and the field's box: both in the border color, and neither filled.
        #expect(count[pick(.border, light: true), default: 0] > 300)
        #expect(count[pick(.text, light: true), default: 0] > 20)
        // A fill would cover the field's box, thousands of pixels at 2x; the raised surface, 4% of the way from the paper to
        // the text, also turns up at a few edges of the text, where its smoothing passes through that grey.
        #expect(count[pick(.surfaceHi, light: true), default: 0] < 100, "\(count[pick(.surfaceHi, light: true), default: 0]) pixels in surfaceHi")
    }

    @Test func theWindowSizesAreTheTokensFiles() {
        // test/look-swift.test.ts holds every value equal to look/index.ts; here, that the pieces use them.
        #expect(PlainMetrics.rowWindow == 48)
        #expect(PlainMetrics.sideWindow == 24)
        #expect(Look.plain().inset == PlainMetrics.sidePopup)
    }

    @Test func aRowIsAtLeastTheWindowRowHeight() throws {
        let png = try windowSnapshot(width: 300, appearance: Self.light, look: .plain()) {
            WindowRow("Short") { StatusWord("Fine", .ok) }
        }
        let rep = try #require(NSBitmapImageRep(data: png))
        #expect(rep.pixelsHigh == Int(PlainMetrics.rowWindow * 2))
    }

    // ── one window with a side column ─────────────────────────

    @Test(arguments: [true, false])
    func theSideColumnFillsTheChosenRowAndDrawsAHairlineDownItsRight(light: Bool) throws {
        let sample = try #require(windowSamples.first { $0.name == "window-side-column" })
        let png = try windowSnapshot(width: sample.width, appearance: light ? Self.light : Self.dark, look: .plain()) { sample.content() }
        let rep = try #require(NSBitmapImageRep(data: png))
        let (count, _) = try counts(png)
        // The chosen row's fill: 224 by about 48 points less its corners, at scale 2, and nothing else is in the highlight.
        #expect(count[pick(.hover, light: light), default: 0] > 30_000)
        // The hairline down the column's right, at 240 points: in the border color from top to bottom.
        let x = Int(240 * 2)
        var line = 0
        for y in 0..<rep.pixelsHigh {
            var pixel = [Int](repeating: 0, count: 4)
            rep.getPixel(&pixel, atX: x, y: y)
            if UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2]) == pick(.border, light: light) { line += 1 }
        }
        // All but the half point the snapshot rounds its height up to, which it fills with the paper.
        #expect(line >= rep.pixelsHigh - 1, "\(line) of \(rep.pixelsHigh) pixels down the column's edge are the hairline")
        // The dot, "Issues 2" and the two problems' titles, in the error color.
        #expect(try near(png, pick(.error, light: light)) > 300)
    }

    @Test(arguments: [true, false])
    func aSideRowsDotIsTheErrorColorAndARowWithoutOneHasNone(light: Bool) throws {
        let draw = { (dot: Tone?) in
            try windowSnapshot(width: 240, appearance: light ? Self.light : Self.dark, look: .plain()) {
                SideRow("Disk", under: "41 GB free", dot: dot, selected: false) {}.padding(.vertical, 8)
            }
        }
        // 8 points across at scale 2: about 50 pixels of solid color in the middle of the dot.
        #expect(try counts(try draw(.error)).count[pick(.error, light: light), default: 0] > 40)
        #expect(try near(try draw(nil), pick(.error, light: light), within: 12) == 0)
    }

    @Test(arguments: [true, false])
    func aSectionLabelAndARowsNameTakeTheirTone(light: Bool) throws {
        let draw = { (tone: Tone?) in
            try windowSnapshot(width: 400, appearance: light ? Self.light : Self.dark, look: .plain()) {
                WindowPage {
                    SectionLabel("Issues 2", tone: tone ?? .secondary)
                    Lines { WindowRow("The disk is nearly full", detail: "41 GB free.", tone: tone) { EmptyView() } }
                }
            }
        }
        #expect(try near(try draw(.error), pick(.error, light: light)) > 40)
        #expect(try near(try draw(nil), pick(.error, light: light), within: 12) == 0, "untoned, nothing is red")
    }

    @Test(arguments: [true, false])
    func aFilledButtonFillsInTheTextColorAndAnOutlinedOneIsALine(light: Bool) throws {
        let draw = { (filled: Bool, enabled: Bool) in
            try counts(try windowSnapshot(width: 200, appearance: light ? Self.light : Self.dark, look: .plain()) {
                WindowButton("Show Downloads", filled: filled, enabled: enabled) {}.padding(10)
            }).count
        }
        let filled = try draw(true, true), outlined = try draw(false, true), off = try draw(true, false)
        // 28 points tall and over 100 wide at scale 2, less the label: thousands of pixels of fill.
        #expect(filled[pick(.text, light: light), default: 0] > 5_000)
        #expect(outlined[pick(.text, light: light), default: 0] < 1_000)
        #expect(outlined[pick(.borderHi, light: light), default: 0] > 300)
        // A button that does nothing is outlined, however it was asked for.
        #expect(off[pick(.text, light: light), default: 0] < 1_000)
        #expect(off[pick(.borderHi, light: light), default: 0] > 300)
    }

    @Test func aSideRowSaysItsNameItsLineAndThatItNeedsYou() {
        #expect(SideRow.spoken(name: "m3", under: "Mac mini", dot: .error) == "m3, Mac mini, needs you")
        #expect(SideRow.spoken(name: "Everything", under: nil, dot: nil) == "Everything")
        #expect(SideRow.spoken(name: "m3", under: "", dot: nil) == "m3")
    }

    @Test func theSidePiecesAreButtons() throws {
        // VoiceOver's reading of them needs a window on the screen, so it is not checked here: these are Buttons, which
        // VoiceOver and Tab (with the Mac's Keyboard navigation on) reach, and nothing in the file takes a bare tap.
        let source = try String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/MenuBarTheme/SideWindow.swift"), encoding: .utf8)
        #expect(!source.contains("onTapGesture"))
        #expect(source.components(separatedBy: "Button(action: action)").count - 1 == 2, "SideRow and WindowButton")
        #expect(source.contains(".accessibilityAddTraits(selected ? .isSelected : [])"))
    }

    func key(_ characters: String, code: UInt16, flags: NSEvent.ModifierFlags = [.numericPad, .function]) -> NSEvent {
        NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
                         characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
    }

    @Test func theArrowKeysMoveTheSideColumnAndDarkenWhatThePointerLit() {
        var steps: [Int] = []
        let window = AppWindow(size: CGSize(width: 600, height: 400), minimum: CGSize(width: 400, height: 300), name: nil, title: "test",
                               arrows: { steps.append($0) }) { Color.clear }
        defer { window.close() }
        #expect(window.opening == "at 600×400 (default, not remembered)")
        window.pointer.moved(to: .zero)
        window.pointer.moved(to: CGPoint(x: 0, y: PointerIntent.travel))
        #expect(window.pointer.travelled)
        window.sendEvent(key(String(UnicodeScalar(UInt16(NSDownArrowFunctionKey))!), code: 125))
        window.sendEvent(key(String(UnicodeScalar(UInt16(NSUpArrowFunctionKey))!), code: 126))
        #expect(steps == [1, -1])
        #expect(!window.pointer.travelled, "a key press darkens what the pointer lit")
        // A modifier held is the system's or a text field's, not the column's.
        window.sendEvent(key(String(UnicodeScalar(UInt16(NSDownArrowFunctionKey))!), code: 125, flags: [.numericPad, .function, .command]))
        // A text field with the keyboard keeps its arrows.
        let field = NSTextView(frame: NSRect(x: 0, y: 0, width: 100, height: 20))
        window.contentView?.addSubview(field)
        #expect(window.makeFirstResponder(field))
        window.sendEvent(key(String(UnicodeScalar(UInt16(NSDownArrowFunctionKey))!), code: 125))
        #expect(steps == [1, -1])
    }

    @Test func aPointerThatHasNotTravelledLightsNothing() {
        let pointer = WindowPointer()
        pointer.moved(to: CGPoint(x: 100, y: 100))
        pointer.moved(to: CGPoint(x: 110, y: 108))
        #expect(!pointer.travelled)
        pointer.moved(to: CGPoint(x: 100, y: 100 + PointerIntent.travel))
        #expect(pointer.travelled)
        pointer.reset()
        #expect(!pointer.travelled)
    }

    @Test func aSavedPlaceIsKeptOnlyWhollyOnOneDisplayAndAtLeastTheMinimum() {
        let left = CGRect(x: 0, y: 0, width: 1512, height: 982), right = CGRect(x: 1512, y: 0, width: 2560, height: 1440)
        let min = CGSize(width: 720, height: 480)
        // Over the Dock's strip at the bottom of a display is still on it.
        #expect(keepsSavedFrame(CGRect(x: 100, y: 0, width: 880, height: 640), screens: [left, right], min: min))
        #expect(!keepsSavedFrame(CGRect(x: 1000, y: 100, width: 880, height: 640), screens: [left, right], min: min), "across two displays")
        #expect(!keepsSavedFrame(CGRect(x: 100, y: 100, width: 600, height: 640), screens: [left, right], min: min), "under the minimum")
        #expect(!keepsSavedFrame(CGRect(x: 2000, y: 100, width: 880, height: 640), screens: [left], min: min), "on a display that left")
    }

    @Test func theRealWindowOpensAtTheDefaultKeepsAPlaceThatFitsAndNeverLeavesTheDisplays() throws {
        // menu-bar-snapshots window-check, built beside this test bundle, run as its own program so the places its windows
        // save go to its own preferences, which it clears.
        let program = Bundle(for: Marker.self).bundleURL.deletingLastPathComponent().appendingPathComponent("menu-bar-snapshots")
        try #require(FileManager.default.isExecutableFile(atPath: program.path), "no menu-bar-snapshots at \(program.path)")
        let process = Process()
        process.executableURL = program
        process.arguments = ["window-check"]
        let out = Pipe()
        process.standardOutput = out
        try process.run()
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        let lines = text.split(separator: "\n")
        #expect(process.terminationStatus == 0, "\(text)")
        #expect(lines.count == 6 && lines.allSatisfy { $0.hasPrefix("ok ") }, "\(text)")
    }
}

private final class Marker {}
