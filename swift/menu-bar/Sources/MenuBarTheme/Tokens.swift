import AppKit
import SwiftUI

/// The console family's colors, the ones metamax's web client, argon-watcher and perf-buddy's web client share, as sRGB:
/// each case's raw value is its dark look, and `light` its light one. A color draws in whichever look the view it is in
/// has, which is the app's appearance, so the Mac's own Light and Dark setting unless the app pins one.
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

    /// The value for `appearance`: light for an aqua one, dark for a dark one.
    public func hex(for appearance: NSAppearance) -> UInt32 {
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .aqua ? light : dark
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
    /// Left and right padding of every line.
    public static let inset: CGFloat = 14
    /// An item line's text starts further in, under its group's name.
    public static let itemInset: CGFloat = 28
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
