import AppKit
import Observation
import SwiftUI

/// What one panel's pieces share, its side page's included: which line the keyboard or the pointer has selected, the
/// one thing last copied, which row's side page is open, and the pasteboard copies go to. The panel makes one; a
/// snapshot or a test makes its own.
@MainActor
@Observable
public final class PanelState {
    /// The selected line's id, painted as hovered: the arrow keys move it, and the pointer moves it once it has
    /// travelled from where it rested (`PointerIntent`).
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
    /// The line under the pointer, which the lines report as it enters and leaves them. Once the pointer has travelled
    /// it is the selection, so a line lights as the pointer enters it and goes dark as it leaves.
    var pointerOver: AnyHashable? {
        didSet { if pointerReached, pointerOver != oldValue { selected = pointerOver } }
    }
    /// Whether the pointer has travelled since it last rested, which the panel sets from its `PointerIntent`. Until it
    /// has, the pointer lights nothing, so a key's choice and a list scrolled under a still pointer stay as they are.
    var pointerReached = false {
        didSet { if pointerReached, !oldValue { selected = pointerOver } }
    }
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

    /// A click on the line `id`: it is selected, and a row with a side page opens it, leaving the selection on the row;
    /// any other line acts.
    func clicked(_ id: AnyHashable, opensSide: Bool, action: () -> Void) {
        selected = id
        if opensSide { openSide(id) } else { action() }
    }

    /// The pointer held still on `id`: it is selected, and a row's side page opens, swaps or closes to match it. Only a
    /// hold does this, so crossing other rows on the way into an open side page leaves the page open.
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
            side.shortcuts = []
            sidePage = id
        }
        sideChanged?(selectingFirst)
    }

    func closeSide() {
        guard let row = sidePage else { return }
        if side.lines.contains(where: { $0.id == selected }) { selected = row }
        sidePage = nil
        side.lines = []
        side.shortcuts = []
        sideChanged?(false)
    }

    /// Runs the action whose shortcut is ⌘ and `key`, a footer item's or a row's: the list's first, then those of the side
    /// page open beside it, whose keys go when it closes. False when none has it.
    @discardableResult
    public func shortcut(_ key: Character) -> Bool {
        guard let found = (list.shortcuts + side.shortcuts).first(where: { $0.key == key }) else { return false }
        found.action()
        return true
    }

    /// The panel closed: nothing stays selected, copied or open beside it, and it opens again at its top.
    func reset() {
        selected = nil
        copied = nil
        pointerReached = false
        pointerOver = nil
        sidePage = nil
        side.lines = []
        side.shortcuts = []
        closes += 1
    }
}

/// One panel's lines and size: the list's, or its side page's.
@MainActor
@Observable
final class Surface {
    /// The lines the arrow keys move through, and the ⌘ shortcuts of its footer and rows, in the order the panel shows them. Handed
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
/// `rest` is its fill otherwise, `outset` the room its fill takes around it and `fillInset` the room it leaves at its sides,
/// with `corner` its rounding. Its content reads whether it is selected from `lineSelected`, so a mark on it can brighten.
/// With `opensSide`, a click opens its row's side page instead of acting.
struct Selectable: ViewModifier {
    let id: AnyHashable
    let action: () -> Void
    var opensSide = false
    var rest: Color = .clear
    var corner: CGFloat = 0
    var outset = EdgeInsets()
    /// How far in from each side its fill sits, while the click still takes its whole width, as a Mac menu's selection.
    var fillInset: CGFloat = 0
    @Environment(PanelState.self) private var state: PanelState?

    func body(content: Content) -> some View {
        // A row whose side page is open stays lit as the selection moves into the page, as a menu's does for its submenu.
        let selected = state?.selected == id || state?.sidePage == id
        content
            .environment(\.lineSelected, selected)
            .padding(outset)
            .background(RoundedRectangle(cornerRadius: corner).fill(selected ? Palette.hover.color : rest).padding(.horizontal, fillInset))
            .contentShape(Rectangle())
            .onTapGesture { state?.clicked(id, opensSide: opensSide, action: action) }
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

    var inSidePage: Bool {
        get { self[InSidePage.self] }
        set { self[InSidePage.self] = newValue }
    }
}

/// Whether a view is drawn in a row's side page, beside the list, rather than in the list.
struct InSidePage: EnvironmentKey {
    static let defaultValue = false
}

/// The room the panel a view is drawn in keeps at its top and bottom: `Metrics.panelEdge` in a menu bar panel's list, and
/// none in a side page, a window or anywhere else, so the header and footer that draw out into it move only there.
struct PanelEdge: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var panelEdge: CGFloat {
        get { self[PanelEdge.self] }
        set { self[PanelEdge.self] = newValue }
    }
}

/// A row's mark that a click on it opens something. In console it is on every such row and brightens while its row is
/// selected; in plain it shows on the selected row only, so a list of links carries one mark rather than one a row, and
/// its column stays, so nothing moves as the selection does.
struct RowArrow: View {
    @Environment(\.lineSelected) private var isSelected

    var body: some View {
        let onSelectedOnly = if case .plain = Look.app { true } else { false }
        Brightening(text: "›", size: Metrics.body, tone: .muted, selected: .text).opacity(onSelectedOnly && !isSelected ? 0 : 1)
    }
}

/// Text that brightens to `selected` while its line is selected, as a row's mark or a footer item's label does.
struct Brightening: View {
    let text: String
    let size: CGFloat
    let tone: Tone
    let selected: Tone
    var lineHeight = Metrics.lineHeight
    @Environment(\.lineSelected) private var isSelected

    var body: some View {
        Text(text).console(size, tone: isSelected ? selected : tone, lineHeight: lineHeight)
    }
}
