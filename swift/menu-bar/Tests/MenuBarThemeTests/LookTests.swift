import AppKit
import SwiftUI
import Testing
@testable import MenuBarTheme
@testable import menu_bar_snapshots

/// The plain look, drawn through `snapshot(look:)`, which sets the look for its draw and puts the suite's back. The
/// console look's colors, face and padding are PiecesTests' and PanelTests'.
@MainActor
@Suite struct LookTests {
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

    /// How many pixels in a band of points, at scale 2, differ from the plain panel's paper in light.
    func ink(_ png: Data, x: Range<CGFloat>, y: Range<CGFloat>) throws -> Int {
        let rep = try #require(NSBitmapImageRep(data: png))
        let paper = Palette.bg.plain(accent: .default).light
        var inked = 0
        for py in Int(y.lowerBound * 2)..<Int(y.upperBound * 2) {
            for px in Int(x.lowerBound * 2)..<Int(x.upperBound * 2) {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: px, y: py)
                if UInt32(pixel[0] << 16 | pixel[1] << 8 | pixel[2]) != paper { inked += 1 }
            }
        }
        return inked
    }

    @Test func anAppThatSetsNoLookDrawsPlain() {
        #expect(Look.default == .plain(accent: .default))
        #expect(Look.default.inset == 20)
        #expect(Look.console.inset == 14)
    }

    @Test func plainDrawsInTheSystemFaceAndCodeInItsMonospacedOne() {
        let system = NSFont.systemFont(ofSize: 13)
        #expect(Typeface.nsFont(size: 13, in: .plain()).familyName == system.familyName)
        #expect(Typeface.nsFont(size: 13, weight: .bold, in: .plain()).fontName == NSFont.systemFont(ofSize: 13, weight: .bold).fontName)
        #expect(Typeface.nsFont(size: 12, in: .plain(), code: true).fontName == NSFont.monospacedSystemFont(ofSize: 12, weight: .regular).fontName)
        Typeface.register()
        #expect(Typeface.nsFont(size: 13, in: .console).familyName == "JetBrains Mono")
        #expect(Typeface.nsFont(size: 12, in: .console, code: true).familyName == "JetBrains Mono")
    }

    @Test(arguments: ["f-list", "f-page", "g", "fine", "unreadable", "side"], [true, false])
    func aPlainScreenFillsInThePlainColors(screen: String, light: Bool) throws {
        let sample = try #require(samples.first { $0.name == screen })
        let before = Look.app
        let png = try snapshot(width: sample.width, appearance: light ? Self.light : Self.dark, look: .plain(), state: PanelState(pasteboard: .withUniqueName())) {
            sample.content()
        }
        #expect(Look.app == before, "the snapshot puts the look back")
        let (count, total) = try counts(png)
        let pick = { (palette: Palette) in light ? palette.plain(accent: .default).light : palette.plain(accent: .default).dark }
        // The paper fills the panel, header included, inside the plain outline.
        #expect(count[pick(.bg), default: 0] > total / 3)
        #expect(count[pick(.borderHi), default: 0] > 0)
        // No area is filled in a console color in either appearance: an edge of a word may blend to one of the greys, a
        // few pixels in a hundred thousand, never a fill.
        for fill in [Palette.bg, .surface, .surfaceHi, .border, .borderHi] {
            #expect(count[fill.light, default: 0] < total / 10_000, "\(fill)'s console light value in \(screen): \(count[fill.light, default: 0]) of \(total)")
            #expect(count[fill.dark, default: 0] < total / 10_000, "\(fill)'s console dark value in \(screen): \(count[fill.dark, default: 0]) of \(total)")
        }
    }

    @Test func everyToneReadsOnThePlainPanel() {
        let reading: [Palette] = [.text, .secondary, .ok, .warn, .error, .info]
        for tone in reading {
            let words = tone.plain(accent: .default)
            for ground in [Palette.bg, .hover] {
                let paper = ground.plain(accent: .default)
                #expect(contrast(words.light, paper.light) >= 4.5, "\(tone) on \(ground) in light: \(contrast(words.light, paper.light))")
                #expect(contrast(words.dark, paper.dark) >= 4.5, "\(tone) on \(ground) in dark")
            }
        }
    }

    @Test func theAppsAccentDrawsTheCopyWord() throws {
        let accent = Accent(light: 0xc0187a, dark: 0xf08ac8)
        let png = try snapshot(width: 400, appearance: Self.light, look: .plain(accent: accent)) { CodeBox("bun bin/apply.ts") }
        let rep = try #require(NSBitmapImageRep(data: png))
        // "copy", on the right of the box, is the only ink in the accent's hue: far more red and blue than green.
        var near = 0
        for y in 0..<rep.pixelsHigh {
            for x in (rep.pixelsWide - 120)..<rep.pixelsWide {
                var pixel = [Int](repeating: 0, count: 4)
                rep.getPixel(&pixel, atX: x, y: y)
                if pixel[0] - pixel[1] > 80, pixel[2] - pixel[1] > 40 { near += 1 }
            }
        }
        #expect(near > 0, "\(near)")
        #expect(Palette.info.hex(for: Self.light, in: .plain(accent: accent)) == 0xc0187a)
        #expect(Palette.info.hex(for: Self.dark, in: .plain(accent: accent)) == 0xf08ac8)
    }

    /// How tall `view` draws in `look`, at scale 2, without the panel's border above and below.
    func height(_ look: Look, _ view: some View) throws -> CGFloat {
        let rep = try #require(NSBitmapImageRep(data: try snapshot(width: 400, look: look) { view }))
        return CGFloat(rep.pixelsHigh) / 2 - 2
    }

    @Test func eachPieceIsAsTallInPlainAsInConsole() throws {
        Typeface.register()
        let pieces: [(String, AnyView)] = [
            ("header", AnyView(Header("fleet", status: Words("3 of 4 need you", .error), note: "read just now"))),
            ("row", AnyView(Row("alpha", status: Words("has never reported", .error).then("+1", .muted), age: "never") {})),
            ("footer", AnyView(Footer([FooterItem("settings", key: ",") {}]))),
            ("group line", AnyView(GroupLine("delta", status: Words("fine", .ok), age: "16m ago"))),
            ("item line", AnyView(ItemLine("has never reported", copy: "bun bin/sync.ts install"))),
            ("sub line", AnyView(SubLine("MacBook Air · reachable from charlie-2, delta"))),
            ("problem block", AnyView(ProblemBlock("apply stopped on share-page", hint: "on bravo, see why", copy: "bun bin/apply.ts"))),
        ]
        for (name, view) in pieces {
            #expect(try height(.plain(), view) == height(.console, view), "\(name)")
        }
    }

    @Test func aPlainLineStartsAtThePlainSides() throws {
        let png = try snapshot(width: 400, appearance: Self.light, look: .plain()) { Row("alpha", status: Words("fine", .ok), age: "4m") {} }
        // Inside the 1 point outline, nothing until the plain inset, then the name.
        #expect(try ink(png, x: 2..<(1 + 20 - 1), y: 8..<36) == 0)
        #expect(try ink(png, x: (1 + 20)..<(1 + 20 + 8), y: 8..<36) > 0)
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
}
