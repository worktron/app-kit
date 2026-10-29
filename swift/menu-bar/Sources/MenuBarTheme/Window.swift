import AppKit
import SwiftUI

// The pieces of a Mac window in the plain look, from the Plain Look Studies page's option C: a page on the paper with
// no boxes or cards, sections under a muted label, rows between hairlines, status in colored words, actions as words in
// the accent, removal in the error color, and the build in a line at the foot. They read the app's look (`Look.app`)
// for their colors, as the panel's pieces do, and PlainMetrics for their sizes.

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

/// A section's label in muted, 24 points below what is above it and 8 above what it labels. The page's first one,
/// `first`, sits 4 points from the top.
public struct SectionLabel: View {
    let text: String
    let first: Bool

    public init(_ text: String, first: Bool = false) {
        self.text = text
        self.first = first
    }

    public var body: some View {
        Text(text).plain(PlainMetrics.label, weight: PlainMetrics.labelWeight, tone: .muted)
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
/// below it. A thing's name, as a profile's, is `strong`; a setting's is not.
public struct WindowRow<Below: View, Trailing: View>: View {
    let name: String
    let detail: String?
    let strong: Bool
    let below: Below
    let trailing: Trailing

    public init(_ name: String, detail: String? = nil, strong: Bool = false, @ViewBuilder below: () -> Below,
                @ViewBuilder trailing: () -> Trailing) {
        self.name = name
        self.detail = detail
        self.strong = strong
        self.below = below()
        self.trailing = trailing()
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).plain(PlainMetrics.body, weight: strong ? PlainMetrics.strongWeight : .regular).lineLimit(1).truncationMode(.tail)
                    if let detail { Text(detail).plain(PlainMetrics.small, tone: .secondary).fixedSize(horizontal: false, vertical: true) }
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
    public init(_ name: String, detail: String? = nil, strong: Bool = false, @ViewBuilder trailing: () -> Trailing) {
        self.init(name, detail: detail, strong: strong, below: { EmptyView() }, trailing: trailing)
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
