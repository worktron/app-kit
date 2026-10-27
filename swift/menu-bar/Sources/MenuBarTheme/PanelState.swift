import AppKit
import Observation
import SwiftUI

/// What one panel's pieces share: which line the keyboard or the pointer has selected, the one thing last copied, and
/// the pasteboard copies go to. The panel makes one; a snapshot or a test makes its own.
@MainActor
@Observable
public final class PanelState {
    /// The selected line's id, painted as hovered: the arrow keys move it, and the pointer moves it only on intent.
    public var selected: AnyHashable?
    /// The text last copied from this panel, whose copy says "copied" until another copy or the panel closes.
    public internal(set) var copied: String?
    /// The lines the arrow keys move through, and the footer's shortcuts, in the order the panel shows them. Handed
    /// over on every update and read only on a key, so no view redraws for them.
    @ObservationIgnored var lines: [SelectableLine] = []
    @ObservationIgnored var shortcuts: [Shortcut] = []
    /// The line under the pointer, which becomes the selection once the pointer means it.
    var pointerOver: AnyHashable?
    /// How tall the content is, and how tall the screen lets the panel be.
    var contentHeight: CGFloat = 0
    var maxHeight: CGFloat = .greatestFiniteMagnitude
    /// The panel fits itself to the content when its height changes.
    /// The panel's height: its content and frame, up to what the screen allows.
    var panelHeight: CGFloat { min(contentHeight, maxHeight - 2 * Metrics.line) + 2 * Metrics.line }
    @ObservationIgnored var resized: (@MainActor () -> Void)?
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
    /// line and up the last.
    public func move(_ step: Int) {
        guard !lines.isEmpty else { return }
        let index = lines.firstIndex { $0.id == selected }
        let next: Int
        if let index { next = min(max(index + step, 0), lines.count - 1) } else { next = step > 0 ? 0 : lines.count - 1 }
        selected = lines[next].id
    }

    /// Acts on the selected line, as a click on it would. False when none is selected.
    @discardableResult
    public func act() -> Bool {
        guard let line = lines.first(where: { $0.id == selected }) else { return false }
        line.action()
        return true
    }

    /// Runs the footer action whose shortcut is ⌘ and `key`. False when none has it.
    @discardableResult
    public func shortcut(_ key: Character) -> Bool {
        guard let found = shortcuts.first(where: { $0.key == key }) else { return false }
        found.action()
        return true
    }

    /// The panel closed: nothing stays selected or copied.
    func reset() {
        selected = nil
        copied = nil
        pointerOver = nil
    }
}

/// A line the arrow keys stop on, and what Return does there.
// Unchecked: preferences carry them only on the main actor, where SwiftUI reads them. Never equal: an update that
// keeps a line's id can change what it does (a row's status refreshed), and an equal value would keep the old action.
struct SelectableLine: Equatable, @unchecked Sendable {
    let id: AnyHashable
    let action: () -> Void
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
/// reads whether it is selected from `lineSelected`, so a mark on it can brighten.
struct Selectable: ViewModifier {
    let id: AnyHashable
    let action: () -> Void
    var rest: Color = .clear
    var corner: CGFloat = 0
    var outset = EdgeInsets()
    @Environment(PanelState.self) private var state: PanelState?

    func body(content: Content) -> some View {
        let selected = state?.selected == id
        content
            .environment(\.lineSelected, selected)
            .padding(outset)
            .background(RoundedRectangle(cornerRadius: corner).fill(selected ? Palette.hover.color : rest))
            .padding(EdgeInsets(top: -outset.top, leading: -outset.leading, bottom: -outset.bottom, trailing: -outset.trailing))
            .contentShape(Rectangle())
            .onTapGesture {
                state?.selected = id
                action()
            }
            .onHover { inside in
                if inside { state?.pointerOver = id } else if state?.pointerOver == id { state?.pointerOver = nil }
            }
            .preference(key: SelectableLines.self, value: [SelectableLine(id: id, action: action)])
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
