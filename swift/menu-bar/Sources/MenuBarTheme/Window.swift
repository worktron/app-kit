import AppKit
import SwiftUI

// The pieces of a Mac window in the plain look, from the Plain Look Studies page's option C: a page on the paper with
// no boxes or cards, sections under a label in secondary, rows between hairlines, status in colored words, actions as
// words in the accent, removal in the error color, and the build in a line at the foot. They read the app's look
// (`Look.app`) for their colors, as the panel's pieces do, and PlainMetrics for their sizes.

extension View {
    /// Text at a plain window's line height, 1.4 times its size.
    func plain(_ size: CGFloat, weight: NSFont.Weight = .regular, tone: Tone? = nil) -> some View {
        console(size, weight: weight, tone: tone, lineHeight: PlainMetrics.lineHeight)
    }
}

/// A window's content: the paper, 24 points in from each side, 20 above and 24 below, in the text color.
public struct WindowPage<Content: View>: View {
    let content: Content

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, PlainMetrics.sideWindow)
            .padding(.top, 20)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(Palette.text.color)
            .background(Palette.bg.color)
    }
}

/// A page's title, and what the page is for under it in secondary.
public struct PageTitle: View {
    let title: String
    let subtitle: String?

    public init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).plain(PlainMetrics.titleWindow, weight: .semibold)
            if let subtitle { Text(subtitle).plain(PlainMetrics.body, tone: .secondary) }
        }
    }
}

/// A section's label in secondary, 24 points below what is above it and 8 above what it labels. The page's first one,
/// `first`, sits 4 points from the top. A label that says something is wrong, as "Issues 2" while any is open, takes a
/// `tone`, red for that.
public struct SectionLabel: View {
    let text: String
    let first: Bool
    let tone: Tone

    public init(_ text: String, first: Bool = false, tone: Tone = .secondary) {
        self.text = text
        self.first = first
        self.tone = tone
    }

    public var body: some View {
        LabelText(text: text, lineHeight: PlainMetrics.lineHeight, tone: tone)
            .padding(.top, first ? 4 : PlainMetrics.sectionGap)
            .padding(.bottom, PlainMetrics.labelGap)
    }
}

/// A hairline the width of what it is in.
struct Hairline: View {
    var body: some View { Palette.border.color.frame(height: PlainMetrics.line) }
}

/// Rows between hairlines: one above the first, and one below each row.
public struct Lines<Content: View>: View {
    let content: Content

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        VStack(spacing: 0) {
            Hairline()
            content
        }
    }
}

/// A row of a window: its name, a line of detail under it in secondary, what goes under them (a text field), and on
/// the right a status word, an action, a switch or a menu. At least 48 points tall with 10 above and below, its hairline
/// below it. A thing's name, as a profile's, is `strong`; a setting's is not. A problem's name takes a `tone`, red for
/// that, and its detail a `detailTone`, secondary unless asked; a row's button on the right is a `WindowButton`. A row
/// that `open`s a thing, as an issue's page, takes the click anywhere on it and lights in the highlight under a pointer
/// that has travelled, or while `lit`, as `opens` does, out to the page's edges, 24 points past its words on each side,
/// as the Fleet Window Studies page's Y draws it; a button in it keeps its own click, and VoiceOver reads it as a button
/// named by its name and detail.
public struct WindowRow<Below: View, Trailing: View>: View {
    let name: String
    let detail: String?
    let strong: Bool
    let tone: Tone?
    let detailTone: Tone
    let lit: Bool
    let open: (() -> Void)?
    let below: Below
    let trailing: Trailing

    public init(_ name: String, detail: String? = nil, strong: Bool = false, tone: Tone? = nil, detailTone: Tone = .secondary,
                lit: Bool = false, open: (() -> Void)? = nil, @ViewBuilder below: () -> Below, @ViewBuilder trailing: () -> Trailing) {
        self.name = name
        self.detail = detail
        self.strong = strong
        self.tone = tone
        self.detailTone = detailTone
        self.lit = lit
        self.open = open
        self.below = below()
        self.trailing = trailing()
    }

    public var body: some View {
        if let open {
            row.padding(.horizontal, PlainMetrics.sideWindow).opens(Self.spoken(name: name, detail: detail), lit: lit, open)
                .padding(.horizontal, -PlainMetrics.sideWindow)
        } else {
            row
        }
    }

    /// What VoiceOver reads for a row that opens: "Backups have not run for 3 days, The backup disk was last seen on Friday."
    static func spoken(name: String, detail: String?) -> String {
        ([name] + [detail].compactMap { $0 }).filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private var row: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).plain(PlainMetrics.body, weight: strong ? PlainMetrics.strongWeight : .regular, tone: tone).lineLimit(1).truncationMode(.tail)
                    if let detail { Text(detail).plain(PlainMetrics.small, tone: detailTone).fixedSize(horizontal: false, vertical: true) }
                    below
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                trailing.fixedSize()
            }
            .padding(.vertical, PlainMetrics.rowPadding)
            .frame(minHeight: PlainMetrics.rowWindow - PlainMetrics.line)
            Hairline()
        }
    }
}

extension WindowRow where Below == EmptyView {
    public init(_ name: String, detail: String? = nil, strong: Bool = false, tone: Tone? = nil, detailTone: Tone = .secondary,
                lit: Bool = false, open: (() -> Void)? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.init(name, detail: detail, strong: strong, tone: tone, detailTone: detailTone, lit: lit, open: open, below: { EmptyView() },
                  trailing: trailing)
    }
}

extension View {
    /// A row of an app's own that opens a thing, as an issue's page: a click anywhere on it calls `open`, and under a
    /// pointer that has travelled (`\.pointerTravelled`), or while `lit`, as the row the keyboard is on, it fills in the
    /// highlight, the side column's selected fill, edge to edge of the view, so the row's own padding is the room the
    /// light leaves round its words. A button in it keeps its own click. VoiceOver reads it as a button named `label`, as
    /// "8 minor issues", with its own buttons inside it, and opens it with its default action. `WindowRow(open:)` is the
    /// kit's row with it, named by its name and detail.
    public func opens(_ label: String, lit: Bool = false, _ open: @escaping () -> Void) -> some View {
        modifier(Opens(label: label, lit: lit, open: open))
    }
}

struct Opens: ViewModifier {
    let label: String
    let lit: Bool
    let open: () -> Void
    @State private var over = false
    @Environment(\.pointerTravelled) private var travelled

    /// Whether the row fills in the highlight: while asked, or under a pointer that has travelled.
    static func lights(lit: Bool, over: Bool, travelled: Bool) -> Bool { lit || over && travelled }

    func body(content: Content) -> some View {
        content
            .background(Self.lights(lit: lit, over: over, travelled: travelled) ? Palette.hover.color : .clear)
            .contentShape(Rectangle())
            .onHover { over = $0 }
            .onTapGesture(perform: open)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, open)
    }
}

/// A status said in a colored word, as "Connected" in ok or "Quiet" in warn: never a chip.
public struct StatusWord: View {
    let text: String
    let tone: Tone

    public init(_ text: String, _ tone: Tone) {
        self.text = text
        self.tone = tone
    }

    public var body: some View { Text(text).plain(PlainMetrics.small, tone: tone) }
}

/// An action as a word in the accent, with no box: in a row, as "Test", or as a page's `main` action at the foot, as
/// "Done", in semibold. A `removes` action, as "Forget all", is in the error color, which means removal and failure only.
public struct ActionWord: View {
    let label: String
    let main: Bool
    let removes: Bool
    let action: () -> Void

    public init(_ label: String, main: Bool = false, removes: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.main = main
        self.removes = removes
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(label).plain(PlainMetrics.body, weight: main ? PlainMetrics.strongWeight : .regular, tone: removes ? .error : .info)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A line of explanation under a section, in secondary.
public struct FootNote: View {
    let text: String

    public init(_ text: String) { self.text = text }

    public var body: some View {
        Text(text).plain(PlainMetrics.small, tone: .secondary).fixedSize(horizontal: false, vertical: true).padding(.top, 12)
    }
}

/// The page's foot: what is said there on the left, as "2 profiles set up", and its main action on the right.
public struct ActionBar<Leading: View, Trailing: View>: View {
    let leading: Leading
    let trailing: Trailing

    public init(@ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.leading = leading()
        self.trailing = trailing()
    }

    public var body: some View {
        HStack {
            leading
            Spacer(minLength: 12)
            trailing
        }
        .padding(.top, PlainMetrics.sectionGap)
    }
}

/// The build the window shows, as About does, as "Beeline 1.0.0, 873623f", at the page's foot.
public struct BuildLine: View {
    let text: String

    public init(_ text: String) { self.text = text }

    public var body: some View {
        Text(text).plain(PlainMetrics.small, tone: .secondary).padding(.top, PlainMetrics.sectionGap)
    }
}
