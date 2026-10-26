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

    @Test func theBundledFontIsTheOneDrawn() {
        #expect(Typeface.register())
        #expect(Typeface.loaded)
        #expect(Typeface.nsFont(size: 13, weight: .semibold).fontName == "JetBrainsMono-SemiBold")
        #expect(Typeface.nsFont(size: 13, weight: .bold).fontName == "JetBrainsMono-Bold")
        #expect(Typeface.nsFont(size: 12).familyName == "JetBrains Mono")
    }

    @Test func theTokensAreTheConsoleFamilys() {
        #expect(Palette.text.rawValue == 0xd4d4d4)
        #expect(Palette.error.rawValue == 0xf48771)
        #expect(Palette.bg.rawValue == 0x050505)
        #expect(Palette.borderHi.rawValue == 0x282828)
        let red = Palette.error.nsColor.usingColorSpace(.sRGB)!
        #expect(Int((red.redComponent * 255).rounded()) == 0xf4)
        #expect(Int((red.greenComponent * 255).rounded()) == 0x87)
        #expect(Int((red.blueComponent * 255).rounded()) == 0x71)
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

    @Test func contentTallerThanTheScreenScrollsAndStillDraws() throws {
        let state = PanelState(pasteboard: .withUniqueName())
        state.maxHeight = 120
        let png = try snapshot(width: 400, state: state) {
            ForEach(0..<10) { Row("mac \($0)", status: Words("fine", .ok), age: "\($0)m") {} }
        }
        let rep = try #require(NSBitmapImageRep(data: png))
        #expect(rep.pixelsHigh == 240)
        #expect(colors(in: png) > 20)
    }
}
