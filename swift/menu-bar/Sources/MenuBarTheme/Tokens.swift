import AppKit
import SwiftUI

/// The console family's colors, the ones metamax's web client, argon-watcher and perf-buddy's web client share, as sRGB.
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

    var red: CGFloat { CGFloat((rawValue >> 16) & 0xff) / 255 }
    var green: CGFloat { CGFloat((rawValue >> 8) & 0xff) / 255 }
    var blue: CGFloat { CGFloat(rawValue & 0xff) / 255 }

    public var color: Color { Color(.sRGB, red: red, green: green, blue: blue) }
    public var nsColor: NSColor { NSColor(srgbRed: red, green: green, blue: blue, alpha: 1) }
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
