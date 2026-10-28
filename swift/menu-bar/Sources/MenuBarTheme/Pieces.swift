import AppKit
import SwiftUI

// The pieces options F and G of the Fleet Menu Studies page are built from, each the height its `.oc` rule gives,
// its bottom line included. Status is said in colored words, never chips.

/// Words in tones, said on one line: "has never reported" in error, then "+1" in muted.
public struct Words: Sendable, ExpressibleByStringLiteral {
    public var runs: [(text: String, tone: Tone)]

    public init(_ text: String, _ tone: Tone = .text) { runs = [(text, tone)] }
    public init(stringLiteral text: String) { self.init(text) }

    /// These words, then `text` in `tone` after a space.
    public func then(_ text: String, _ tone: Tone) -> Words {
        var next = self
        next.runs.append((" ", .text))
        next.runs.append((text, tone))
        return next
    }

    var attributed: AttributedString {
        runs.reduce(into: AttributedString()) { all, run in
            var part = AttributedString(run.text)
            part.foregroundColor = run.tone.palette.color
            all += part
        }
    }
}

/// The group or block a copy line sits in, part of its selection id, so the same text under two Macs is two lines.
struct LineScope: EnvironmentKey {
    static let defaultValue = ""
}

extension EnvironmentValues {
    var lineScope: String {
        get { self[LineScope.self] }
        set { self[LineScope.self] = newValue }
    }
}

/// A line of `height` with the 1 point border below it, inside that height.
struct Lined<Content: View>: View {
    let height: CGFloat?
    let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content.frame(maxWidth: .infinity, minHeight: height.map { $0 - Metrics.line }, maxHeight: height.map { $0 - Metrics.line }, alignment: .leading)
            Palette.border.color.frame(height: Metrics.line)
        }
    }
}

/// The panel's top line: an optional back mark, the title in bold, its status in words, and a note on the right.
/// With `back`, the whole line takes the click.
public struct Header: View {
    let title: String
    let status: Words?
    let note: String
    let back: (() -> Void)?

    public init(_ title: String, status: Words? = nil, note: String = "", back: (() -> Void)? = nil) {
        self.title = title
        self.status = status
        self.note = note
        self.back = back
    }

    public var body: some View {
        let line = Lined(height: Metrics.header, content: HStack(spacing: 10) {
            if back != nil { Text("‹").console(Metrics.body, tone: .secondary) }
            // On one line, cut in the middle so a path keeps its start and its end, and the first to give way.
            Text(title).console(Metrics.body, weight: .bold).lineLimit(1).truncationMode(.middle)
            if let status { Text(status.attributed).console(Metrics.body).lineLimit(1).layoutPriority(1) }
            Spacer(minLength: 0)
            Text(note).console(Metrics.note, tone: .muted).lineLimit(1).layoutPriority(2)
        }
        .padding(.horizontal, Metrics.inset)
        .frame(maxHeight: .infinity)
        .background(Palette.surface.color))
        if let back {
            line.contentShape(Rectangle()).onTapGesture(perform: back)
        } else {
            line
        }
    }
}

/// A 44 point row: the name in its column, its status in words, cut short with an ellipsis, its age, and on the right
/// the mark that says a click opens something, as a menu's submenu arrow does. Without a name, its words take the
/// row's width, as a link with its account on the right, and a row whose click acts in place leaves the mark off.
/// Given a `page`, the row opens it beside the list, as a menu's submenu: on the pointer resting on it, a click, Return
/// or Right.
public struct Row: View {
    let name: String?
    let status: Words
    let age: String
    let opens: Bool
    let id: AnyHashable
    let action: () -> Void
    var page: (@MainActor () -> AnyView)?

    public init(_ name: String, status: Words, age: String, id: AnyHashable? = nil, action: @escaping () -> Void) {
        self.name = name
        self.status = status
        self.age = age
        opens = true
        self.id = id ?? AnyHashable(name)
        self.action = action
    }

    /// A row whose `text` runs from the inset to the `trailing` text, in secondary on the right; `opens` false for one
    /// whose click acts in place, as "open once in" a profile, rather than opening a page.
    public init(_ text: Words, trailing: String = "", opens: Bool = true, id: AnyHashable, action: @escaping () -> Void) {
        name = nil
        status = text
        age = trailing
        self.opens = opens
        self.id = id
        self.action = action
    }

    /// The row with a name, whose `page` opens beside the list.
    @MainActor public init<Page: View>(_ name: String, status: Words, age: String, id: AnyHashable? = nil, @ViewBuilder page: @escaping @MainActor () -> Page) {
        self.init(name, status: status, age: age, id: id) {}
        self.page = { AnyView(page()) }
    }

    /// The row without a name, whose `page` opens beside the list.
    @MainActor public init<Page: View>(_ text: Words, trailing: String = "", id: AnyHashable, @ViewBuilder page: @escaping @MainActor () -> Page) {
        self.init(text, trailing: trailing, id: id) {}
        self.page = { AnyView(page()) }
    }

    public var body: some View {
        line
            .background(GeometryReader { geometry in
                Color.clear.preference(key: SidePages.self, value: page.map { [SidePage(id: id, content: $0(), row: geometry.frame(in: .global))] } ?? [])
            })
            .modifier(Selectable(id: id, action: action, opensSide: page != nil))
    }

    private var line: some View {
        Lined(height: Metrics.row, content: HStack(spacing: 12) {
            if let name {
                Text(name).console(Metrics.body, weight: .semibold).lineLimit(1).truncationMode(.tail)
                    .frame(width: Metrics.nameColumn, alignment: .leading)
            }
            Text(status.attributed).console(name == nil ? Metrics.body : Metrics.small).lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(age).console(Metrics.small, tone: .secondary).monospacedDigit().lineLimit(1).fixedSize()
            if opens { Brightening(text: "›", size: Metrics.body, tone: .muted, selected: .text).fixedSize() }
        }
        .padding(.horizontal, Metrics.inset)
        .frame(maxHeight: .infinity))
    }
}

/// A line of detail under a header, in secondary.
public struct SubLine: View {
    let text: String

    public init(_ text: String) { self.text = text }

    public var body: some View {
        Lined(height: nil, content: Text(text).console(Metrics.small, tone: .secondary)
            .padding(.horizontal, Metrics.inset).padding(.top, 8).padding(.bottom, 10))
    }
}

/// A problem on a page: its title in red, what to do in secondary, and the thing to copy in a code box.
public struct ProblemBlock: View {
    let title: String
    let hint: String
    let copy: String?

    public init(_ title: String, hint: String, copy: String? = nil) {
        self.title = title
        self.hint = hint
        self.copy = copy
    }

    public var body: some View {
        Lined(height: nil, content: VStack(alignment: .leading, spacing: 0) {
            Text(title).console(Metrics.body, weight: .semibold, tone: .error)
            Text(hint).console(Metrics.small, tone: .secondary).padding(.top, 2).padding(.bottom, copy == nil ? 0 : 8)
            if let copy { CodeBox(copy) }
        }
        .padding(.horizontal, Metrics.inset).padding(.vertical, 12)
        .environment(\.lineScope, title))
    }
}

/// The exact command or line to copy, wrapped wherever it must be to show all of it, with "copy" on the right that
/// turns to "copied" once it is on the pasteboard. A click anywhere on the box copies. Its id, for the arrow keys, is its
/// block's title and its text unless `id` is given: no two lines in a panel may share one.
public struct CodeBox: View {
    let text: String
    let id: AnyHashable?
    @Environment(PanelState.self) private var state: PanelState?
    @Environment(\.lineScope) private var scope

    public init(_ text: String, id: AnyHashable? = nil) {
        self.text = text
        self.id = id
    }

    public var body: some View {
        let copied = state?.copied == text
        HStack(alignment: .top, spacing: 12) {
            Text(text).console(Metrics.small).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            Text(copied ? "copied" : "copy").console(Metrics.small, tone: copied ? .ok : .info).fixedSize()
        }
        .padding(.vertical, 6 + Metrics.line)
        .padding(.horizontal, 8 + Metrics.line)
        .modifier(Selectable(id: id ?? AnyHashable(["copy", scope, text]), action: { state?.copy(text) },
                             rest: Palette.surface.color, corner: Metrics.cornerInside))
        .overlay(RoundedRectangle(cornerRadius: Metrics.cornerInside).strokeBorder(Palette.border.color, lineWidth: Metrics.line))
    }
}

/// A group's heading line: the name in bold, an optional status in words, and the age on the right. Alone, as a group
/// with nothing under it, it has its bottom line; as an `ItemGroup`'s heading, the group has it.
public struct GroupLine: View {
    let name: String
    let status: Words?
    let age: String
    var lined = true

    public init(_ name: String, status: Words? = nil, age: String) {
        self.name = name
        self.status = status
        self.age = age
    }

    public var body: some View {
        let line = HStack(spacing: 10) {
            Text(name).console(Metrics.body, weight: .semibold).lineLimit(1).truncationMode(.tail)
            if let status { Text(status.attributed).console(Metrics.small).lineLimit(1) }
            Spacer(minLength: 0)
            Text(age).console(Metrics.small, tone: .secondary).lineLimit(1).fixedSize().layoutPriority(1)
        }
        .padding(.horizontal, Metrics.inset)
        .frame(maxHeight: .infinity)
        if lined {
            Lined(height: Metrics.groupLine, content: line)
        } else {
            line.frame(height: Metrics.groupLine)
        }
    }
}

/// One thing under a group's heading, in red, with "copy" on the right when there is something to copy, or "by hand"
/// in muted when there is not. Its id, for the arrow keys, is its group's name, its text and what it copies unless `id` is
/// given: no two lines in a panel may share one.
public struct ItemLine: View {
    let text: String
    let copy: String?
    let id: AnyHashable?
    @Environment(PanelState.self) private var state: PanelState?
    @Environment(\.lineScope) private var scope

    public init(_ text: String, copy: String?, id: AnyHashable? = nil) {
        self.text = text
        self.copy = copy
        self.id = id
    }

    public var body: some View {
        let copied = copy != nil && state?.copied == copy
        let line = HStack(spacing: 10) {
            Text(text).console(Metrics.small, tone: .error).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
            Text(copy == nil ? "by hand" : copied ? "copied" : "copy").console(Metrics.small, tone: copy == nil ? .muted : copied ? .ok : .info).fixedSize()
        }
        .padding(.leading, Metrics.itemInset)
        .padding(.trailing, Metrics.inset)
        .frame(height: Metrics.itemLine)
        if let copy {
            line.modifier(Selectable(id: id ?? AnyHashable(["item", scope, text, copy]), action: { state?.copy(copy) }))
        } else {
            line
        }
    }
}

/// A group: its heading, its item lines, and room below them before the group's bottom line.
public struct ItemGroup<Items: View>: View {
    let name: String
    let heading: GroupLine
    let items: Items

    public init(_ name: String, age: String, @ViewBuilder items: () -> Items) {
        var heading = GroupLine(name, age: age)
        heading.lined = false
        self.heading = heading
        self.name = name
        self.items = items()
    }

    public var body: some View {
        Lined(height: nil, content: VStack(spacing: 0) {
            heading
            items
        }
        .padding(.bottom, 6)
        .environment(\.lineScope, name))
    }
}

/// An action in the footer, with the ⌘ shortcut it answers to. The arrow keys stop on it after the lines above, as a
/// menu's last items, and selected it brightens on a fill a little wider than its words.
public struct FooterItem {
    let label: String
    let key: Character?
    let action: () -> Void

    public init(_ label: String, key: Character? = nil, action: @escaping () -> Void) {
        self.label = label
        self.key = key
        self.action = action
    }

    @MainActor var view: some View {
        HStack(spacing: 6) {
            Brightening(text: label, size: Metrics.small, tone: .secondary, selected: .text)
            if let key { Text("⌘\(String(key).uppercased())").console(Metrics.small, tone: .muted) }
        }
        .fixedSize()
        .modifier(Selectable(id: AnyHashable(["footer", label]), action: action, corner: Metrics.cornerInside,
                             outset: EdgeInsets(top: 5, leading: 7, bottom: 5, trailing: 7)))
    }
}

/// The panel's last line: its actions on the left and the last ones (Quit) on the right.
public struct Footer: View {
    let leading: [FooterItem]
    let trailing: [FooterItem]

    public init(_ leading: [FooterItem], trailing: [FooterItem] = []) {
        self.leading = leading
        self.trailing = trailing
    }

    public var body: some View {
        HStack(spacing: 18) {
            ForEach(leading.indices, id: \.self) { leading[$0].view }
            Spacer(minLength: 0)
            ForEach(trailing.indices, id: \.self) { trailing[$0].view }
        }
        .padding(.horizontal, Metrics.inset)
        .frame(height: Metrics.footer)
        .preference(key: Shortcuts.self, value: (leading + trailing).compactMap { item in
            item.key.map { Shortcut(key: Character($0.lowercased()), action: item.action) }
        })
    }
}

/// The panel's frame: the content on the background, inside a 1 point border with 8 point corners, `width` wide in all.
public struct PanelFrame<Content: View>: View {
    let width: CGFloat
    let content: Content

    public init(width: CGFloat, @ViewBuilder content: () -> Content) {
        self.width = width
        self.content = content()
    }

    public var body: some View {
        content
            .frame(width: width - 2 * Metrics.line)
            .foregroundStyle(Palette.text.color)
            .background(Palette.bg.color)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.cornerPanel - Metrics.line))
            .padding(Metrics.line)
            .background(RoundedRectangle(cornerRadius: Metrics.cornerPanel).fill(Palette.borderHi.color))
    }
}
