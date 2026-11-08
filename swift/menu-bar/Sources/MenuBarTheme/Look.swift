import AppKit

/// Which of the kit's two looks an app draws in, one for all of its panels: plain, the system typeface on warm paper
/// with the app's accent, for people who never open a terminal; or console, JetBrains Mono on near-black, for the agent
/// tools. The pieces are the same in both; the look gives their colors, their typeface and their side padding. In plain
/// an app may give its own accent, and its own paper with its highlight, as long as every text tone still reads on them.
public enum Look: Sendable, Equatable {
    case console
    case plain(accent: Accent = Look.defaultAccent, background: Background = .default)

    /// What an app draws in unless it sets `app`.
    public static let `default` = Look.plain()

    /// The blue the Plain Look Studies page draws in, Beeline's: the plain look's accent unless an app gives its own.
    public static let defaultAccent = Accent(light: 0x2f5fa7, dark: 0x8fb0e6)

    /// The look this app draws in. Set it once at launch, before the first panel or snapshot draws, and before any
    /// argument handling that draws a snapshot without launching: every color, typeface and padding reads it as it draws.
    /// A plain look whose colors leave a text tone under 4.5 to 1 stops the app here, naming each tone, since an app's
    /// colors are fixed in its code and its first run shows the mistake.
    public nonisolated(unsafe) static var app: Look = .default {
        didSet {
            let failing = app.unreadable
            if !failing.isEmpty { preconditionFailure("The plain look's colors must read at \(Palette.readable) to 1 or better: \(failing.joined(separator: "; "))") }
        }
    }

    /// Each text tone that reads under 4.5 to 1 on this look's paper or highlight, in words, as the tokens file's
    /// `unreadable` says it; none in console, whose colors are the kit's alone.
    public var unreadable: [String] {
        guard case .plain(let accent, let background) = self else { return [] }
        return Palette.unreadable(accent: accent, background: background)
    }

    /// Left and right padding of every line: the plain look's popup sides, the console look's tighter ones.
    public var inset: CGFloat {
        switch self {
        case .console: 14
        case .plain: 20
        }
    }

    /// How far apart a piece's lines of text are, as a multiple of their size: the plain look's 1.4, the console look's 1.5,
    /// for the pieces drawn to a mockup's text rather than to a fixed height.
    public var lineHeight: CGFloat {
        switch self {
        case .console: Metrics.lineHeight
        case .plain: PlainMetrics.lineHeight
        }
    }
}

/// A color as sRGB, in light and in dark.
public struct LightDark: Sendable, Equatable {
    public var light: UInt32
    public var dark: UInt32

    public init(light: UInt32, dark: UInt32) {
        self.light = light
        self.dark = dark
    }
}

/// The app's accent in the plain look: actions such as "copy", and the info tone.
public typealias Accent = LightDark

/// The plain look's paper, the ground of every panel and window, and its highlight, the selected line's fill, set
/// together, since the highlight is what has to read on that paper. The lines are worked out from the paper.
public struct Background: Sendable, Equatable {
    public var paper: LightDark
    public var highlight: LightDark

    public init(paper: LightDark, highlight: LightDark) {
        self.paper = paper
        self.highlight = highlight
    }

    /// Beeline's paper from the Plain Look Studies page's option C, and the Beeline Menu Studies page's darker selected
    /// line, since #ecebe6 measured 1.09 to 1 on the paper.
    public static let `default` = Background(paper: LightDark(light: 0xf6f5f2, dark: 0x1d1e20), highlight: LightDark(light: 0xdfddd6, dark: 0x36383c))
}
