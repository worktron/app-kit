import AppKit
import SwiftUI

// The pieces that give a panel sections, from the Beeline Menu Studies page's options D (the list) and E (a row's side
// page): a section's label, a problem with its fix on one row, and compact rows with no hairline between them, so space
// rather than lines sets one section apart from the next. Their text is drawn at the look's line height, to the page's.

/// A section's label in secondary, 12 at semibold, the one text a window's `SectionLabel` and a panel's draw. Secondary
/// rather than muted, since muted measures 2.9 to 1 on the plain paper.
struct LabelText: View {
    let text: String
    let lineHeight: CGFloat

    var body: some View {
        Text(text).console(PlainMetrics.label, weight: PlainMetrics.labelWeight, tone: .secondary, lineHeight: lineHeight)
    }
}

/// A section's label in a panel: 24 points below what is above it and 8 above what it labels, at the panel's sides. The
/// panel's `first`, under the header, sits 14 below it. In a row's side page in the plain look, the 24 points hold a line
/// across the page, 8 below the group above, from the Plain Panel Studies page's A, since a side page's groups are short
/// and run together on room alone; never above the page's first. The arrow keys pass over it, since it does nothing.
public struct PanelSectionLabel: View {
    let text: String
    let first: Bool
    @Environment(\.inSidePage) private var inSidePage

    public init(_ text: String, first: Bool = false) {
        self.text = text
        self.first = first
    }

    public var body: some View {
        let lined = if case .plain = Look.app { inSidePage && !first } else { false }
        VStack(spacing: 0) {
            if lined { Palette.border.color.frame(height: Metrics.line).padding(.top, Self.aboveLine) }
            LabelText(text: text, lineHeight: Look.app.lineHeight)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Metrics.inset)
                .padding(.top, first ? 14 : lined ? PlainMetrics.sectionGap - Self.aboveLine - Metrics.line : PlainMetrics.sectionGap)
        }
        .padding(.bottom, PlainMetrics.labelGap)
    }

    /// Room between a side page's group and the line under it.
    static let aboveLine: CGFloat = 8
}

/// A problem as one row, which one click on any of it acts on: its title in a tone, red unless asked, with the fix on the
/// right of the title's line in the accent at semibold ("Set it up…"), and what it means under it in secondary.
public struct ProblemRow: View {
    let title: String
    let tone: Tone
    let detail: String
    let fix: String
    let id: AnyHashable
    let action: () -> Void

    public init(_ title: String, tone: Tone = .error, detail: String, fix: String, id: AnyHashable? = nil, action: @escaping () -> Void) {
        self.title = title
        self.tone = tone
        self.detail = detail
        self.fix = fix
        self.id = id ?? AnyHashable(["problem", title])
        self.action = action
    }

    public var body: some View {
        let lineHeight = Look.app.lineHeight
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(title).console(Metrics.body, tone: tone, lineHeight: lineHeight)
                    .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                Text(fix).console(Metrics.body, weight: PlainMetrics.strongWeight, tone: .info, lineHeight: lineHeight).lineLimit(1).fixedSize()
            }
            Text(detail).console(Metrics.small, tone: .secondary, lineHeight: lineHeight).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Metrics.inset)
        .padding(.top, 2)
        .padding(.bottom, 4)
        .modifier(Selectable(id: id, action: action, corner: Metrics.cornerInside, fillInset: PlainMetrics.fillInset))
    }
}

/// A 30 point row with no line below it, as a Mac menu's recent items: its words cut short with an ellipsis and a `count`
/// after them in muted ("×2"), then a `time` in a column of its own, right-aligned, and a `trailing` word in secondary,
/// in a column of its own when there is a time so the rows line up (a link's profile), and as wide as it is otherwise
/// ("In effect"). The mark on the right says a click opens something; `opens` false leaves it off a row whose click acts in
/// place. Selected, its fill sits 6 points in from the panel's sides with 3 point corners. Given a `page`, the row opens it
/// beside the list, as `Row`'s does. As a Mac menu's items, it may take an `icon` on the left, in a 32 point column 8
/// before its words, a `dot` on the right after its trailing word, and a ⌘ `key` after that, which runs its action while
/// the panel is open, as a footer item's does; the arrow stays last, so arrows line up down a list. A row without them
/// keeps no room for them.
public struct CompactRow: View {
    let text: Words
    let icon: RowIcon?
    let count: String
    let time: String
    let trailing: String
    let dot: Tone?
    let key: Character?
    let opens: Bool
    let id: AnyHashable
    let action: () -> Void
    var page: (@MainActor () -> AnyView)?

    public init(_ text: Words, icon: RowIcon? = nil, count: String = "", time: String = "", trailing: String = "", dot: Tone? = nil,
                key: Character? = nil, opens: Bool = true, id: AnyHashable, action: @escaping () -> Void) {
        self.text = text
        self.icon = icon
        self.count = count
        self.time = time
        self.trailing = trailing
        self.dot = dot
        self.key = key
        self.opens = opens
        self.id = id
        self.action = action
    }

    /// The row whose `page` opens beside the list. It takes no key, since what it does is open its page.
    @MainActor public init<Page: View>(_ text: Words, icon: RowIcon? = nil, count: String = "", time: String = "", trailing: String = "",
                                       dot: Tone? = nil, id: AnyHashable, @ViewBuilder page: @escaping @MainActor () -> Page) {
        self.init(text, icon: icon, count: count, time: time, trailing: trailing, dot: dot, id: id) {}
        self.page = { AnyView(page()) }
    }

    /// The icon's column, at the row's left.
    static let iconColumn: CGFloat = 32

    public var body: some View {
        line
            .background(GeometryReader { geometry in
                Color.clear.preference(key: SidePages.self, value: page.map { [SidePage(id: id, content: $0(), row: geometry.frame(in: .global))] } ?? [])
            })
            .modifier(Selectable(id: id, action: action, opensSide: page != nil, corner: Metrics.cornerInside, fillInset: PlainMetrics.fillInset))
            .preference(key: Shortcuts.self, value: key.map { [Shortcut(key: Character($0.lowercased()), action: action)] } ?? [])
    }

    /// The words and what follows them, with the icon before them when there is one. The icon sits centered on the row
    /// beside the words' own line, never on their baseline, where each symbol's height would move the words a point or two.
    @ViewBuilder private var line: some View {
        if let icon {
            HStack(alignment: .center, spacing: 8) {
                icon.frame(width: Self.iconColumn, height: PlainMetrics.rowCompact)
                words(leading: 0)
            }
            .padding(.leading, Metrics.inset)
        } else {
            words(leading: Metrics.inset)
        }
    }

    private func words(leading: CGFloat) -> some View {
        let lineHeight = Look.app.lineHeight
        return HStack(alignment: .firstTextBaseline, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(text.attributed).console(Metrics.body, lineHeight: lineHeight).lineLimit(1).truncationMode(.tail)
                if !count.isEmpty { Text(count).console(Metrics.small, tone: .muted, lineHeight: lineHeight).lineLimit(1).fixedSize() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !time.isEmpty {
                Text(time).console(Metrics.small, tone: .secondary, lineHeight: lineHeight).monospacedDigit().lineLimit(1)
                    .frame(width: Metrics.timeColumn, alignment: .trailing)
            }
            if !trailing.isEmpty {
                let word = Text(trailing).console(Metrics.small, tone: .secondary, lineHeight: lineHeight).lineLimit(1).truncationMode(.tail)
                if time.isEmpty {
                    word.fixedSize()
                } else {
                    word.frame(width: Metrics.trailingColumn, alignment: .leading)
                }
            }
            if let dot { RowDot(dot) }
            if let key { Text("⌘\(String(key).uppercased())").console(Metrics.small, tone: .muted, lineHeight: lineHeight).fixedSize() }
            if opens { RowArrow().frame(width: 6) }
        }
        .padding(EdgeInsets(top: 0, leading: leading, bottom: 0, trailing: Metrics.inset))
        .frame(height: PlainMetrics.rowCompact)
    }
}

/// Compact rows as one list, with 4 points below the last. A `closing` list, a page's last actions, sits under a line
/// across the panel, 8 below what is above it and 4 above its rows, with 10 below them.
public struct CompactList<Rows: View>: View {
    let closing: Bool
    let rows: Rows

    public init(closing: Bool = false, @ViewBuilder rows: () -> Rows) {
        self.closing = closing
        self.rows = rows()
    }

    public var body: some View {
        VStack(spacing: 0) {
            if closing { Palette.border.color.frame(height: Metrics.line).padding(.top, 8).padding(.bottom, 4) }
            rows
        }
        .padding(.bottom, closing ? 10 : 4)
    }
}

/// An icon for a row: any image, an Apple symbol (`Image(systemName: "laptopcomputer")`), one from the app's assets or
/// one it drew, scaled to fit 28 points wide and 18 tall, from the Fleet Window Studies page's menu. A one-color image, as
/// a symbol or a template image is, draws in `tone`; a full-color one keeps its colors. A symbol draws hierarchically,
/// as the page drew the laptop's screen, filled faintly in its tone, set here so no symbol's own default decides it. A
/// symbol name the Mac does not have draws nothing. A compact row places it in its column; a row of an app's own, as a
/// window's side column, places it as it likes.
public struct RowIcon: View {
    let image: Image
    let tone: Tone

    public init(_ image: Image, tone: Tone = .text) {
        self.image = image
        self.tone = tone
    }

    static let width: CGFloat = 28
    static let height: CGFloat = 18

    public var body: some View {
        image.resizable().symbolRenderingMode(.hierarchical).scaledToFit()
            .foregroundStyle(tone.palette.color)
            .frame(maxWidth: Self.width, maxHeight: Self.height)
    }
}

/// A dot that says a row needs the person, in `tone`, red for that: 8 points across, with 3 points of room each side. A
/// compact row draws it on its right; a row of an app's own places it as it likes.
public struct RowDot: View {
    let tone: Tone

    public init(_ tone: Tone = .error) { self.tone = tone }

    static let size: CGFloat = 8

    public var body: some View {
        Circle().fill(tone.palette.color).frame(width: Self.size, height: Self.size).padding(.horizontal, 3)
    }
}
