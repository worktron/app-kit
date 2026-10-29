import AppKit

/// Which of the kit's two looks an app draws in, one for all of its panels: plain, the system typeface on warm paper
/// with the app's accent, for people who never open a terminal; or console, JetBrains Mono on near-black, for the agent
/// tools. The pieces are the same in both; the look gives their colors, their typeface and their side padding.
public enum Look: Sendable, Equatable {
    case console
    case plain(accent: Accent = .default)

    /// What an app draws in unless it sets `app`.
    public static let `default` = Look.plain()

    /// The look this app draws in. Set it once at launch, before the first panel or snapshot draws, and before any
    /// argument handling that draws a snapshot without launching: every color, typeface and padding reads it as it draws.
    public nonisolated(unsafe) static var app: Look = .default

    /// Left and right padding of every line: the plain look's popup sides, the console look's tighter ones.
    public var inset: CGFloat {
        switch self {
        case .console: 14
        case .plain: 20
        }
    }
}

/// The app's one color in the plain look, as sRGB, in light and in dark: actions such as "copy", and the info tone.
public struct Accent: Sendable, Equatable {
    public var light: UInt32
    public var dark: UInt32

    public init(light: UInt32, dark: UInt32) {
        self.light = light
        self.dark = dark
    }

    /// The blue the Plain Look Studies page draws in.
    public static let `default` = Accent(light: 0x2f5fa7, dark: 0x8fb0e6)
}
