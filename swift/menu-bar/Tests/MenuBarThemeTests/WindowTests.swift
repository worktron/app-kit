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

    func pick(_ palette: Palette, light: Bool, accent: Accent = .default) -> UInt32 {
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
        #expect(count[pick(.surfaceHi, light: true), default: 0] == 0)
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
}
