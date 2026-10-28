import AppKit
import Observation
import SwiftUI

/// What one panel's pieces share, its side page's included: which line the keyboard or the pointer has selected, the
/// one thing last copied, which row's side page is open, and the pasteboard copies go to. The panel makes one; a
/// snapshot or a test makes its own.
@MainActor
@Observable
public final class PanelState {
    /// The selected line's id, painted as hovered: the arrow keys move it, and the pointer moves it only on intent.
    public var selected: AnyHashable?
    /// The text last copied from this panel, whose copy says "copied" until another copy or the panel closes.
    public internal(set) var copied: String?
    /// The row whose side page is open beside the list, nil while none is.
    public private(set) var sidePage: AnyHashable?
    /// The list's own lines and size, and the side page's: each panel measures and reports into its own.
    let list = Surface()
    let side = Surface()
    /// The side pages the list's rows carry, with where each row is, handed over on every update of the list.
    var sidePages: [SidePage] = []
    /// The line under the pointer, which becomes the selection once the pointer means it.
    var pointerOver: AnyHashable?
    /// How many times the panel has closed, so its content scrolls back to the top for the next open.
    var closes = 0
    /// Called when a side page opens, swaps or closes, and on each update of the list's rows, so the panel can put the
    /// side panel where its row is; true when the page's first line is to be selected once it is drawn.
    @ObservationIgnored var sideChanged: (@MainActor (_ selectingFirst: Bool) -> Void)?
    @ObservationIgnored let pasteboard: NSPasteboard

    public init(pasteboard: NSPasteboard = .general) {
        self.pasteboard = pasteboard
    }

    public func copy(_ text: String) {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        copied = text
    }

    /// Moves the selection by `step` lines, stopping at the first and last as a menu does; from none, down is the first
    /// line and up the last. Inside the side page it moves among the page's lines; in the list, a move off the row
    /// whose page is open closes the page.
    public func move(_ step: Int) {
        let inSide = side.lines.contains { $0.id == selected }
        let lines = inSide ? side.lines : list.lines
        guard !lines.isEmpty else { return }
        let index = lines.firstIndex { $0.id == selected }
        let next: Int
        if let index { next = min(max(index + step, 0), lines.count - 1) } else { next = step > 0 ? 0 : lines.count - 1 }
        selected = lines[next].id
        if !inSide, selected != sidePage { closeSide() }
    }

    /// Acts on the selected line, as a click on it would, except that a row with a side page opens it with its first
    /// line selected, as Right does. False when none is selected.
    @discardableResult
    public func act() -> Bool {
        guard let line = (side.lines + list.lines).first(where: { $0.id == selected }) else { return false }
        if line.opensSide { openSide(line.id, selectingFirst: true) } else { line.action() }
        return true
    }

    /// Right: opens the selected row's side page and selects its first line. False when the row has none.
    @discardableResult
    public func enterSide() -> Bool {
        guard let line = list.lines.first(where: { $0.id == selected }), line.opensSide else { return false }
        openSide(line.id, selectingFirst: true)
        return true
    }

    /// Left or Escape: closes the side page, and a selection inside it goes back to its row. False when none is open.
    @discardableResult
    public func leaveSide() -> Bool {
        guard sidePage != nil else { return false }
        closeSide()
        return true
    }

    /// The pointer came to rest on `id`: it is selected, and a row's side page opens, swaps or closes to match it.
    func pointed(at id: AnyHashable) {
        selected = id
        guard let line = list.lines.first(where: { $0.id == id }) else { return }
        if line.opensSide { openSide(id, selectingFirst: false) } else { closeSide() }
    }

    /// Opens the side page of the row `id`, as a click on the row does, and with `selectingFirst` its first line selected,
    /// as Right does; a snapshot draws it beside its row.
    public func openSide(_ id: AnyHashable, selectingFirst: Bool = false) {
        if sidePage != id {
            side.lines = []
            sidePage = id
        }
        sideChanged?(selectingFirst)
    }

    func closeSide() {
        guard let row = sidePage else { return }
        if side.lines.contains(where: { $0.id == selected }) { selected = row }
        sidePage = nil
        side.lines = []
        sideChanged?(false)
    }

    /// Runs the footer action whose shortcut is ⌘ and `key`. False when none has it.
    @discardableResult
    public func shortcut(_ key: Character) -> Bool {
        guard let found = list.shortcuts.first(where: { $0.key == key }) else { return false }
        found.action()
        return true
    }

    /// The panel closed: nothing stays selected, copied or open beside it, and it opens again at its top.
    func reset() {
        selected = nil
        copied = nil
        pointerOver = nil
        sidePage = nil
        side.lines = []
        closes += 1
    }
}

/// One panel's lines and size: the list's, or its side page's.
@MainActor
@Observable
final class Surface {
    /// The lines the arrow keys move through, and the footer's shortcuts, in the order the panel shows them. Handed
    /// over on every update and read only on a key, so no view redraws for them.
    @ObservationIgnored var lines: [SelectableLine] = []
    @ObservationIgnored var shortcuts: [Shortcut] = []
    /// How tall the content is, and how tall the screen lets the panel be.
    var contentHeight: CGFloat = 0
    var maxHeight: CGFloat = .greatestFiniteMagnitude
    /// The panel's height: its content and frame, up to what the screen allows.
    var panelHeight: CGFloat { min(contentHeight, maxHeight - 2 * Metrics.line) + 2 * Metrics.line }
    /// The panel fits itself to the content when its height changes.
    @ObservationIgnored var resized: (@MainActor () -> Void)?
}

/// A row's side page: its content, and the row's frame in the list panel's coordinates, top left at the origin.
// Unchecked and never equal for the reasons SelectableLine is.
struct SidePage: Equatable, @unchecked Sendable {
    let id: AnyHashable
    let content: AnyView
    let row: CGRect
    static func == (a: Self, b: Self) -> Bool { false }
}

struct SidePages: PreferenceKey {
    static let defaultValue: [SidePage] = []
    static func reduce(value: inout [SidePage], nextValue: () -> [SidePage]) { value += nextValue() }
}

/// A line the arrow keys stop on, and what Return does there.
// Unchecked: preferences carry them only on the main actor, where SwiftUI reads them. Never equal: an update that
// keeps a line's id can change what it does (a row's status refreshed), and an equal value would keep the old action.
struct SelectableLine: Equatable, @unchecked Sendable {
    let id: AnyHashable
    let action: () -> Void
    /// A row with a side page, which a click, Return or Right opens instead of acting.
    var opensSide = false
    static func == (a: Self, b: Self) -> Bool { false }
}

struct Shortcut: Equatable, @unchecked Sendable {
    let key: Character
    let action: () -> Void
    static func == (a: Self, b: Self) -> Bool { false }
}

struct SelectableLines: PreferenceKey {
    static let defaultValue: [SelectableLine] = []
    static func reduce(value: inout [SelectableLine], nextValue: () -> [SelectableLine]) { value += nextValue() }
}

struct Shortcuts: PreferenceKey {
    static let defaultValue: [Shortcut] = []
    static func reduce(value: inout [Shortcut], nextValue: () -> [Shortcut]) { value += nextValue() }
}

/// A line that acts on a click on its whole background, is one the arrow keys stop on, and paints as hovered when selected:
/// `rest` is its fill otherwise, and `outset` the room its fill takes around it, with `corner` its rounding. Its content
/// reads whether it is selected from `lineSelected`, so a mark on it can brighten. With `opensSide`, a click opens its row's
/// side page instead of acting.
struct Selectable: ViewModifier {
    let id: AnyHashable
    let action: () -> Void
    var opensSide = false
    var rest: Color = .clear
    var corner: CGFloat = 0
    var outset = EdgeInsets()
    @Environment(PanelState.self) private var state: PanelState?

    func body(content: Content) -> some View {
        // A row whose side page is open stays lit as the selection moves into the page, as a menu's does for its submenu.
        let selected = state?.selected == id || state?.sidePage == id
        content
            .environment(\.lineSelected, selected)
            .padding(outset)
            .background(RoundedRectangle(cornerRadius: corner).fill(selected ? Palette.hover.color : rest))
            .contentShape(Rectangle())
            .onTapGesture {
                state?.selected = id
                if opensSide { state?.openSide(id, selectingFirst: false) } else { action() }
            }
            .onHover { inside in
                if inside { state?.pointerOver = id } else if state?.pointerOver == id { state?.pointerOver = nil }
            }
            .preference(key: SelectableLines.self, value: [SelectableLine(id: id, action: action, opensSide: opensSide)])
            // What the panel scrolls to when the keys choose this line, fill and all.
            .id(id)
            // Laid out at its content's size, while the fill and the click reach over the outset.
            .padding(EdgeInsets(top: -outset.top, leading: -outset.leading, bottom: -outset.bottom, trailing: -outset.trailing))
    }
}

/// Whether the line a view sits on is selected.
struct LineSelected: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var lineSelected: Bool {
        get { self[LineSelected.self] }
        set { self[LineSelected.self] = newValue }
    }
}

/// Text that brightens to `selected` while its line is selected, as a row's mark or a footer item's label does.
struct Brightening: View {
    let text: String
    let size: CGFloat
    let tone: Tone
    let selected: Tone
    @Environment(\.lineSelected) private var isSelected

    var body: some View {
        Text(text).console(size, tone: isSelected ? selected : tone)
    }
}
