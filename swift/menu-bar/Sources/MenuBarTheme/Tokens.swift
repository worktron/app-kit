import AppKit
import SwiftUI

/// The colors, by what each one says, as sRGB. Each case's raw value is the console look's dark value, the console
/// family's that metamax's web client, argon-watcher and perf-buddy's web client share, `light` the console look's light
/// one, and `plain` the plain look's pair. A color draws in the app's look (`Look.app`) and in whichever appearance the
/// view it is in has, which is the Mac's own Light and Dark setting unless the app pins one.
public enum Palette: UInt32, CaseIterable, Sendable {
    case text = 0xd4d4d4
    case secondary = 0x888888
    case muted = 0x555555
    case ok = 0x89d185
    case warn = 0xe2c08d
    case error = 0xf48771
    case info = 0x6cb6ff
    case bg = 0x050505
    case surface = 0x0e0e0e
    case surfaceHi = 0x141414
    case border = 0x1c1c1c
    case borderHi = 0x282828
    /// The selected line's fill: the line the arrow keys or the pointer are on.
    case hover = 0x222222

    public var dark: UInt32 { rawValue }

    /// The light look: neutral greys, with every tone but muted reading at least 4.5 to 1 on the panel, a code box and a
    /// selected line, and muted as faint as it is in dark.
    public var light: UInt32 {
        switch self {
        case .text: 0x1f1f1f
        case .secondary: 0x5e5e5e
        case .muted: 0x9e9e9e
        case .ok: 0x276f2b
        case .warn: 0x825400
        case .error: 0xb72f1c
        case .info: 0x0a5cb8
        case .bg: 0xfbfbfb
        case .surface: 0xf0f0f0
        case .surfaceHi: 0xe8e8e8
        case .border: 0xe6e6e6
        case .borderHi: 0xd0d0d0
        case .hover: 0xe5e5e5
        }
    }

    /// The plain look, from the Plain Look Studies page's option C: Beeline's paper and graphites, with no boxes, so the
    /// header and a code box sit on the panel's own paper. Info is the app's accent. Every tone but muted reads at least
    /// 4.5 to 1 on the panel and on a selected line, in light and in dark, for which ok in light is a shade darker than
    /// the page's #2e7d4f, which read 4.2 on a selected line.
    public func plain(accent: Accent) -> (light: UInt32, dark: UInt32) {
        switch self {
        case .text: (0x2a2c30, 0xe6e4df)
        case .secondary: (0x5c5f65, 0xa3a6ab)
        case .muted: (0x8e9197, 0x74777d)
        case .ok: (0x2a774b, 0x7cc49a)
        case .warn: (0x9a5b00, 0xe0b46a)
        case .error: (0xb3261e, 0xf2a39c)
        case .info: (accent.light, accent.dark)
        case .bg, .surface: (0xf6f5f2, 0x1d1e20)
        case .surfaceHi: (0xefeee9, 0x242628)
        case .border: (0xe2e0da, 0x323438)
        case .borderHi: (0xd3d1ca, 0x3c3e42)
        case .hover: (0xecebe6, 0x2a2c2f)
        }
    }

    /// The value in `look` for `appearance`: light for an aqua one, dark for a dark one.
    public func hex(for appearance: NSAppearance, in look: Look = Look.app) -> UInt32 {
        let isLight = appearance.bestMatch(from: [.darkAqua, .aqua]) == .aqua
        switch look {
        case .console: return isLight ? light : dark
        case .plain(let accent):
            let pair = plain(accent: accent)
            return isLight ? pair.light : pair.dark
        }
    }

    /// Resolved again whenever the appearance it draws in changes, so an open panel follows the Mac's setting.
    public var nsColor: NSColor {
        NSColor(name: "MenuBarTheme.\(self)") { appearance in
            let hex = hex(for: appearance)
            return NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                           blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        }
    }

    /// The same color for SwiftUI, which resolves it against the view's color scheme.
    public var color: Color { Color(nsColor: nsColor) }
}

/// Sizes in points, from the Studies page's `.oc` rules: one height per kind of line, so every list keeps one rhythm.
public enum Metrics {
    /// A row of the list, metamax's layout.rowHeight.
    public static let row: CGFloat = 44
    public static let header: CGFloat = 40
    public static let footer: CGFloat = 36
    /// A group's heading line, and an item line under it.
    public static let groupLine: CGFloat = 36
    public static let itemLine: CGFloat = 26
    /// Left and right padding of every line, which the look gives: 14 in console, 20 in plain.
    public static var inset: CGFloat { Look.app.inset }
    /// An item line's text starts further in, 14 past its group's name.
    public static var itemInset: CGFloat { inset + 14 }
    /// The width of a row's name column.
    public static let nameColumn: CGFloat = 92
    public static let cornerInside: CGFloat = 3
    public static let cornerPanel: CGFloat = 8
    public static let line: CGFloat = 1
    /// Text sizes: the body, the smaller status and detail text, and the header's note.
    public static let body: CGFloat = 13
    public static let small: CGFloat = 12
    public static let note: CGFloat = 11
    /// A line of text is 1.5 times its size, as the web's line-height.
    public static let lineHeight: CGFloat = 1.5
}

/// What a status word says by its color: each color means one thing.
public enum Tone: Sendable {
    case text, ok, warn, error, info, secondary, muted

    public var palette: Palette {
        switch self {
        case .text: .text
        case .ok: .ok
        case .warn: .warn
        case .error: .error
        case .info: .info
        case .secondary: .secondary
        case .muted: .muted
        }
    }
}
