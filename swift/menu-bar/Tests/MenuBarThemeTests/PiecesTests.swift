import AppKit
import SwiftUI
import Testing
@testable import MenuBarTheme
@testable import menu_bar_snapshots

/// Each piece at the height its `.oc` rule gives on the Studies page, laid out for a Retina screen.
@MainActor
@Suite struct PiecesTests {
    init() {
        _ = NSApplication.shared
        Typeface.register()
    }

    /// How tall `view` draws in a snapshot at scale 2, without the panel's border above and below. A hosting view's
    /// own fitting size, outside a window, rounds to whole points.
    func height(_ view: some View) throws -> CGFloat {
        let rep = try #require(NSBitmapImageRep(data: try snapshot(width: 400) { view }))
        return CGFloat(rep.pixelsHigh) / 2 - 2
    }

    @Test func eachPieceIsItsMockupsHeight() throws {
        #expect(try height(Header("fleet", status: Words("3 of 4 need you", .error), note: "read just now")) == 40)
        #expect(try height(Row("alpha", status: Words("has never reported", .error).then("+1", .muted), age: "never") {}) == 44)
        #expect(try height(Footer([FooterItem("settings", key: ",") {}])) == 36)
        #expect(try height(GroupLine("delta", status: Words("fine", .ok), age: "16m ago")) == 36)
        #expect(try height(ItemLine("has never reported", copy: "bun bin/sync.ts install")) == 26)
        #expect(try height(SubLine("MacBook Air · reachable from charlie-2, delta")) == 37)
        // 12 and 12 padding, a 19.5 title, 2, an 18 hint, 8, a 32 code box, and its line.
        #expect(try height(ProblemBlock("apply stopped on share-page", hint: "on bravo, see why", copy: "bun bin/apply.ts")) == 104.5)
        #expect(try height(ItemGroup("bravo", age: "2h ago") { ItemLine("apply stopped on share-page", copy: "bun bin/apply.ts") }) == CGFloat(36 + 26 + 6 + 1))
    }

    @Test func aLongNameStaysInItsColumn() throws {
        let png = try snapshot(width: 400) {
            Row("a-mac-with-a-very-long-name", status: Words("fine", .ok), age: "4m") {}
        }
        let rep = try #require(NSBitmapImageRep(data: png))
        // The 12 point gap between the name's column (14 to 106 points in, after the 1 point border) and the status.
        var drawn = 0
        for x in (2 * (1 + 14 + 92 + 1))..<(2 * (1 + 14 + 92 + 11)) {
            for y in 2..<(rep.pixelsHigh - 4) {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: x, y: y)
                if pixel[0] > 0x20 { drawn += 1 }
            }
        }
        #expect(drawn == 0)
    }

    /// The color at `x`, `y` points inside the panel's 1 point border, in a snapshot at scale 2.
    func color(_ png: Data, _ x: CGFloat, _ y: CGFloat) throws -> UInt32 {
        let rep = try #require(NSBitmapImageRep(data: png))
        var pixel = [Int](repeating: 0, count: 4)
        rep.getPixel(&pixel, atX: Int((1 + x) * 2), y: Int((1 + y) * 2))
        return UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2])
    }

    func selecting(_ id: AnyHashable?) -> PanelState {
        let state = PanelState(pasteboard: .withUniqueName())
        state.selected = id
        return state
    }

    @Test func theSelectedLineIsPaintedInTheHoverFill() throws {
        let row = { Row("alpha", status: Words("fine", .ok), age: "4m") {} }
        #expect(try color(snapshot(width: 400, state: selecting("alpha"), row), 4, 22) == Palette.hover.rawValue)
        #expect(try color(snapshot(width: 400, state: selecting(nil), row), 4, 22) == Palette.bg.rawValue)
        // A code box has a fill of its own, which the hover fill takes the place of.
        let box = { CodeBox("bun bin/apply.ts") }
        #expect(try color(snapshot(width: 400, state: selecting(["copy", "", "bun bin/apply.ts"]), box), 3, 16) == Palette.hover.rawValue)
        #expect(try color(snapshot(width: 400, state: selecting(nil), box), 3, 16) == Palette.surface.rawValue)
        // A footer item's fill reaches past its words, which start at the line's inset.
        let footer = { Footer([FooterItem("settings", key: ",") {}]) }
        #expect(try color(snapshot(width: 400, state: selecting(["footer", "settings"]), footer), Metrics.inset - 4, 18) == Palette.hover.rawValue)
        #expect(try color(snapshot(width: 400, state: selecting(nil), footer), Metrics.inset - 4, 18) == Palette.bg.rawValue)
    }

    @Test func aRowsMarkIsOnTheRightAndBrightensWhenSelected() throws {
        /// The brightest red channel in the last 10 points before the row's right inset, where the mark sits.
        func brightest(_ selected: AnyHashable?) throws -> Int {
            let png = try snapshot(width: 400, state: selecting(selected)) { Row("alpha", status: Words("fine", .ok), age: "4m") {} }
            let rep = try #require(NSBitmapImageRep(data: png))
            var most = 0
            for x in Int((1 + 400 - 2 - Metrics.inset - 10) * 2)..<Int((1 + 400 - 2 - Metrics.inset) * 2) {
                for y in 2..<(rep.pixelsHigh - 4) {
                    var pixel = [Int](repeating: 0, count: 4)
                    rep.getPixel(&pixel, atX: x, y: y)
                    most = max(most, pixel[0])
                }
            }
            return most
        }
        let resting = try brightest(nil)
        let selected = try brightest("alpha")
        #expect(resting > 0x30 && resting <= 0x55 + 4)
        #expect(selected > 0xb0)
    }

    /// How many pixels in the points `x` and `y` span are brighter than the panel's background, in a snapshot at scale 2.
    func ink(_ png: Data, x: Range<CGFloat>, y: Range<CGFloat>) throws -> Int {
        let rep = try #require(NSBitmapImageRep(data: png))
        var drawn = 0
        for px in Int((1 + x.lowerBound) * 2)..<Int((1 + x.upperBound) * 2) {
            for py in Int((1 + y.lowerBound) * 2)..<Int((1 + y.upperBound) * 2) {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: px, y: py)
                if pixel[0] > 0x40 { drawn += 1 }
            }
        }
        return drawn
    }

    @Test func aRowWithoutANameRunsItsWordsAcrossTheRow() throws {
        let png = try snapshot(width: 480) {
            Row(Words("github.com/acme/widgets/pull/12"), trailing: "work@example.com", id: "link") {}
        }
        // The words start at the inset, where a name would be, and run through the gap after the name's column.
        #expect(try ink(png, x: Metrics.inset..<(Metrics.inset + 8), y: 12..<32) > 0)
        #expect(try ink(png, x: (Metrics.inset + Metrics.nameColumn)..<(Metrics.inset + Metrics.nameColumn + 12), y: 12..<32) > 0)
        // The trailing words end before the mark, at the right.
        let mark = 480 - 2 - Metrics.inset - 10
        #expect(try ink(png, x: (mark - 40)..<(mark - 12), y: 12..<32) > 0)
        #expect(try ink(png, x: mark..<(mark + 10), y: 12..<32) > 0)
        // A row whose click acts in place has no mark: its words run on to the inset.
        let acts = try snapshot(width: 480) { Row(Words("open once in work@example.com"), opens: false, id: "once") {} }
        #expect(try ink(acts, x: mark..<(mark + 10), y: 12..<32) == 0)
    }

    @Test func aLongTitleStaysOnOneLineAndTheNoteStaysWhole() throws {
        let png = try snapshot(width: 480) {
            Header("docs.example.com/document/d/1AbCdEf/edit/and/then/some/more/of/the/path", note: "read just now", back: {})
        }
        #expect(try height(Header("docs.example.com/document/d/1AbCdEf/edit/and/then/some/more/of/the/path", note: "read just now", back: {})) == 40)
        // One line of 13 point text centred in the 40 point header, so nothing above 10 points or below 30.
        #expect(try ink(png, x: 30..<300, y: 1..<10) == 0)
        #expect(try ink(png, x: 30..<300, y: 30..<39) == 0)
        // Cut in the middle: two titles that differ only at their end still draw differently.
        let other = try snapshot(width: 480) {
            Header("docs.example.com/document/d/1AbCdEf/edit/and/then/some/more/of/the/page", note: "read just now", back: {})
        }
        #expect(other != png)
        // The note at the right is drawn: its first word starts about 80 points from the right inset.
        #expect(try ink(png, x: (480 - 2 - Metrics.inset - 80)..<(480 - 2 - Metrics.inset - 60), y: 12..<28) > 0)
    }

    @Test func theBundledFontIsTheOneDrawn() {
        #expect(Typeface.register())
        #expect(Typeface.loaded)
        #expect(Typeface.nsFont(size: 13, weight: .semibold).fontName == "JetBrainsMono-SemiBold")
        #expect(Typeface.nsFont(size: 13, weight: .bold).fontName == "JetBrainsMono-Bold")
        #expect(Typeface.nsFont(size: 12).familyName == "JetBrains Mono")
    }

    /// The sRGB value SwiftUI draws `palette` as in `scheme`.
    func drawn(_ palette: Palette, _ scheme: ColorScheme) -> UInt32 {
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let resolved = palette.color.resolve(in: environment)
        let channel = { (value: Float) in UInt32((value * 255).rounded()) }
        return channel(resolved.red) << 16 | channel(resolved.green) << 8 | channel(resolved.blue)
    }

    @Test func theTokensAreTheConsoleFamilys() {
        #expect(Palette.text.rawValue == 0xd4d4d4)
        #expect(Palette.error.rawValue == 0xf48771)
        #expect(Palette.bg.rawValue == 0x050505)
        #expect(Palette.borderHi.rawValue == 0x282828)
        // What SwiftUI draws is each token's value in each look, as is what AppKit draws.
        for palette in Palette.allCases {
            #expect(drawn(palette, .dark) == palette.dark, "\(palette) in dark")
            #expect(drawn(palette, .light) == palette.light, "\(palette) in light")
        }
        let red = Palette.error.nsColor
        NSAppearance(named: .aqua)!.performAsCurrentDrawingAppearance {
            let light = red.usingColorSpace(.sRGB)!
            #expect(Int((light.redComponent * 255).rounded()) == Int(Palette.error.light >> 16))
        }
        NSAppearance(named: .darkAqua)!.performAsCurrentDrawingAppearance {
            let dark = red.usingColorSpace(.sRGB)!
            #expect(Int((dark.redComponent * 255).rounded()) == 0xf4)
            #expect(Int((dark.greenComponent * 255).rounded()) == 0x87)
            #expect(Int((dark.blueComponent * 255).rounded()) == 0x71)
        }
    }

    /// The contrast between two sRGB colors, as WCAG reckons it.
    func contrast(_ a: UInt32, _ b: UInt32) -> Double {
        func luminance(_ hex: UInt32) -> Double {
            let linear = [16, 8, 0].map { shift -> Double in
                let c = Double((hex >> UInt32(shift)) & 0xff) / 255
                return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
        }
        let (x, y) = (luminance(a), luminance(b))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    @Test func everyToneReadsOnThePanelInBothLooks() {
        let reading: [Palette] = [.text, .secondary, .ok, .warn, .error, .info]
        // Words sit on the panel, the header and a code box, and on a selected line. Dark's secondary reads 4.49 on a
        // selected line, as it has since that fill came in; the light look holds every one.
        for tone in reading {
            for ground in [Palette.bg, .surface] {
                #expect(contrast(tone.dark, ground.dark) >= 4.5, "\(tone) on \(ground) in dark")
                #expect(contrast(tone.light, ground.light) >= 4.5, "\(tone) on \(ground) in light")
            }
            #expect(contrast(tone.light, Palette.hover.light) >= 4.5, "\(tone) on a selected line in light")
        }
        // Muted, the ages and counts, is faint on purpose, and as faint in light as in dark.
        let dark = contrast(Palette.muted.dark, Palette.bg.dark)
        let light = contrast(Palette.muted.light, Palette.bg.light)
        #expect(abs(light - dark) <= 0.3)
    }

    @Test(arguments: ["f-list", "f-page", "g", "fine", "unreadable"])
    func aLightScreenFillsInLight(screen: String) throws {
        let sample = try #require(samples.first { $0.name == screen })
        let rep = try #require(NSBitmapImageRep(data: try render(sample, appearance: NSAppearance(named: .aqua)!)))
        var count: [UInt32: Int] = [:]
        for y in 0..<rep.pixelsHigh {
            for x in 0..<rep.pixelsWide {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: x, y: y)
                guard pixel[3] == 255 else { continue }
                count[UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2]), default: 0] += 1
            }
        }
        let total = rep.pixelsWide * rep.pixelsHigh
        // The panel, its header and its edge are in their light values.
        #expect(count[Palette.bg.light, default: 0] > total / 4)
        #expect(count[Palette.surface.light, default: 0] > 0)
        #expect(count[Palette.borderHi.light, default: 0] > 0)
        // No dark fill is left: these four are darker than any light ink, so no edge of a word can make them.
        for fill in [Palette.bg, .surface, .surfaceHi, .border] {
            #expect(count[fill.dark, default: 0] == 0, "\(fill)'s dark value in \(screen)")
        }
        if sample.selected != nil { #expect(count[Palette.hover.light, default: 0] > 0) }
    }

    @Test func aCopyGoesToThePanelsPasteboardAndSaysCopied() {
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        let state = PanelState(pasteboard: pasteboard)
        state.copy("bun bin/apply.ts")
        #expect(pasteboard.string(forType: .string) == "bun bin/apply.ts")
        #expect(state.copied == "bun bin/apply.ts")
        state.copy("bun bin/sync.ts log")
        #expect(state.copied == "bun bin/sync.ts log")
    }

    /// Distinct colors in a PNG: a blank or one-color image has one or two.
    func colors(in png: Data) -> Int {
        let rep = NSBitmapImageRep(data: png)!
        var seen = Set<UInt32>()
        for y in stride(from: 0, to: rep.pixelsHigh, by: 2) {
            for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: x, y: y)
                seen.insert(UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2]))
            }
        }
        return seen.count
    }

    @Test(arguments: ["f-list", "f-page", "g", "fine", "unreadable"])
    func everyScreenDrawsInTheBundledFont(screen: String) throws {
        let sample = try #require(samples.first { $0.name == screen })
        let png = try render(sample)
        let rep = try #require(NSBitmapImageRep(data: png))
        #expect(rep.pixelsWide == Int(sample.width * 2))
        #expect(colors(in: png) > 20)
    }

    @Test func aSnapshotDrawsTheSidePageBesideItsRow() throws {
        let sample = try #require(samples.first { $0.name == "side" })
        let rep = try #require(NSBitmapImageRep(data: try render(sample)))
        #expect(rep.pixelsWide == Int((2 * sample.width + MenuBarPanel.gap) * 2))
        /// Whether anything is drawn at `x`, `y` points from the top left.
        func drawn(_ x: CGFloat, _ y: CGFloat) -> Bool {
            var pixel = [Int](repeating: 0, count: 4)
            rep.getPixel(&pixel, atX: Int(x * 2), y: Int(y * 2))
            return pixel[3] > 0
        }
        // The page's row is the second link, which starts under the frame's line, the header and the first link.
        let row = Metrics.line + Metrics.header + Metrics.row
        let page = sample.width + MenuBarPanel.gap + 20
        #expect(!drawn(page, row - 4))
        #expect(drawn(page, row + 4))
        // Nothing in the gap between the two.
        #expect(!drawn(sample.width + MenuBarPanel.gap / 2, row + 20))
        // The row whose page is open stays lit, though the selection is in the page.
        #expect(try color(render(sample), 4, row + 22) == Palette.hover.dark)
    }

    @Test func contentTallerThanTheScreenScrollsAndStillDraws() throws {
        let state = PanelState(pasteboard: .withUniqueName())
        state.list.maxHeight = 120
        let png = try snapshot(width: 400, state: state) {
            ForEach(0..<10) { Row("mac \($0)", status: Words("fine", .ok), age: "\($0)m") {} }
        }
        let rep = try #require(NSBitmapImageRep(data: png))
        #expect(rep.pixelsHigh == 240)
        #expect(colors(in: png) > 20)
    }
}
