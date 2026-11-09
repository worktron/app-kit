import AppKit
import Observation
import SwiftUI

// One window for an app, from the Fleet Window Studies page's A and the Buddy System Window Studies page's D: a window
// that opens at a set size and comes back where it was left while that place fits a display, a side column of the app's
// things with the chosen one filled, which the up and down arrows move through, and a button for a row of the page beside
// it. Drawn in the plain look; they read `Look.app` for their colors, as the other window pieces do.

/// A window holding one app's view: titled, closable and resizable, its title bar see-through so the content sits under
/// the window's close, minimize and zoom buttons, and draggable by its empty background. It opens at `size`, centered,
/// the first time, and after that where and as large as the person left it, under `name`, while that place is at least
/// `minimum` and wholly on one connected display, the Dock's strip included; anything else opens at `size` again, but for
/// a place larger than every display, which AppKit itself shrinks onto one as it restores it. It
/// never measures its content, which scrolls when it is longer. `opening` says which, in words for the app's log.
///
/// With `arrows`, the up and down keys go to it as -1 and +1 while no control has the keyboard, so the app moves its
/// side column's selection, as a Mac sidebar answers the arrows, whether or not the Mac's Keyboard navigation is on.
/// Every key press darkens what the pointer lit, and the pointer lights nothing again until it has travelled
/// (`PointerIntent`), as in the menu panel.
@MainActor
public final class AppWindow: NSWindow {
    public let panelState = PanelState()
    let pointer = WindowPointer()
    let arrows: ((Int) -> Void)?
    /// "at 880×640 (saved place)", "(default, nothing saved)", "(default, the saved place did not fit a display)",
    /// "(default, another window has this name)", "(default, not remembered)".
    public private(set) var opening = ""

    public init<Content: View>(size: CGSize, minimum: CGSize, maximum: CGSize? = nil, name: String?, title: String,
                               arrows: ((Int) -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.arrows = arrows
        super.init(contentRect: NSRect(origin: .zero, size: size),
                   styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        self.title = title
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isReleasedWhenClosed = false
        isMovableByWindowBackground = true
        backgroundColor = Palette.bg.nsColor
        // Never acceptsMouseMovedEvents: it stops SwiftUI's own hover (developer.apple.com/forums/thread/736594).
        let hosting = NSHostingView(rootView: WindowRoot(pointer: pointer, content: content()).environment(panelState).ignoresSafeArea())
        hosting.sizingOptions = []
        contentView = hosting
        contentMinSize = minimum
        if let maximum { contentMaxSize = maximum }
        setContentSize(size)
        center()
        let why: String
        if let name {
            // Naming it restores the frame saved under the name over the one set above, and saves every move and resize
            // from then on. So the default goes first, and a restored frame is checked after. Whether one was saved is read
            // before, since a saved place may equal the default.
            let saved = UserDefaults.standard.object(forKey: Self.savedKey(name)) != nil
            if !setFrameAutosaveName(name) {
                why = "default, another window has this name"
            } else if !saved {
                why = "default, nothing saved"
            } else if keepsSavedFrame(frame, screens: NSScreen.screens.map(\.frame),
                                      min: frameRect(forContentRect: NSRect(origin: .zero, size: minimum)).size) {
                why = "saved place"
            } else {
                setContentSize(size)
                center()
                why = "default, the saved place did not fit a display"
            }
        } else {
            why = "default, not remembered"
        }
        let content = contentRect(forFrameRect: frame).size
        opening = "at \(Int(content.width))×\(Int(content.height)) (\(why))"
    }

    /// The key AppKit saves a named window's place under.
    static func savedKey(_ name: String) -> String { "NSWindow Frame \(name)" }

    public override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown {
            pointer.reset()
            if handle(key: event) { return }
        }
        super.sendEvent(event)
    }

    /// How many keys reached the end of the window's chain with nothing in it taking them, and were dropped.
    private(set) var quietKeys = 0

    /// A key nothing in the window took ends here with no sound, where AppKit's own end plays the alert sound for it. A
    /// view with the keyboard, as a text field, has had the key before it gets here. Anything else goes on as usual. An app
    /// that gives the window a window controller moves the chain's end to that controller, and the sound comes back.
    public override func noResponder(for eventSelector: Selector) {
        guard eventSelector == #selector(NSResponder.keyDown(with:)) else { return super.noResponder(for: eventSelector) }
        quietKeys += 1
    }

    /// The up and down arrows, to `arrows`, while no control has the keyboard (the window or its content view holds it,
    /// as when a click on a side row leaves it), so a text field, a slider or a list keeps its own arrows, and while no
    /// modifier other than the arrow keys' own is held.
    func handle(key event: NSEvent) -> Bool {
        guard let arrows, firstResponder == nil || firstResponder === self || firstResponder === contentView,
              event.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty else { return false }
        switch event.charactersIgnoringModifiers?.unicodeScalars.first.map({ Int($0.value) }) {
        case NSUpArrowFunctionKey: arrows(-1)
        case NSDownArrowFunctionKey: arrows(1)
        default: return false
        }
        return true
    }
}

/// Whether a frame AppKit restored for a window is one to keep: at least the minimum, and wholly on one connected display,
/// the Dock's strip included, where a person may leave it. AppKit moves a frame saved on a display that left, though not
/// as it documents, so anything else opens at the default.
func keepsSavedFrame(_ frame: CGRect, screens: [CGRect], min: CGSize) -> Bool {
    frame.width >= min.width && frame.height >= min.height && screens.contains { $0.contains(frame) }
}

/// Where the pointer is in a window, for when hover may paint: the same rule as the menu panel's (`PointerIntent`).
@MainActor
@Observable
final class WindowPointer {
    private var intent = PointerIntent()
    var travelled: Bool { intent.reached }

    func moved(to point: CGPoint) { intent.moved(to: point, at: ProcessInfo.processInfo.systemUptime) }
    func reset() { intent.reset() }
}

/// The window's view under the pointer's rule: it feeds the pointer's moves in, starts it again when the window stops
/// being the one in front, and tells every view inside whether the pointer has travelled.
struct WindowRoot<Content: View>: View {
    let pointer: WindowPointer
    let content: Content
    @Environment(\.appearsActive) private var active

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .foregroundStyle(Palette.text.color)
            .background(Palette.bg.color)
            .environment(\.pointerTravelled, pointer.travelled)
            .onContinuousHover { if case .active(let point) = $0 { pointer.moved(to: point) } }
            .onChange(of: active) { if !active { pointer.reset() } }
    }
}

struct PointerTravelled: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Whether the pointer has travelled since it last rested, in an `AppWindow`: until it has, hover paints nothing, and
    /// every key press and the window leaving the front start it again. An app's own rows read it to light on hover as
    /// the kit's do; outside an `AppWindow`, as in a snapshot, it is false.
    public internal(set) var pointerTravelled: Bool {
        get { self[PointerTravelled.self] }
        set { self[PointerTravelled.self] = newValue }
    }
}

/// The side column, 240 points wide, with the page beside it: the column on the raised surface color with a hairline on
/// its right, room at its top for the window's own buttons, and its rows under it; the page takes the rest of the width.
/// Both are as tall as the taller one, so a page in a scroll view fills the window and the column with it. Where the page
/// starts and whether it scrolls are the app's.
public struct SideColumn<Rows: View, Page: View>: View {
    let rows: Rows
    let page: Page

    public init(@ViewBuilder rows: () -> Rows, @ViewBuilder page: () -> Page) {
        self.rows = rows()
        self.page = page()
    }

    static var width: CGFloat { 240 }
    /// Room for the window's close, minimize and zoom buttons over its see-through title bar.
    static var topRoom: CGFloat { 38 }

    public var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) { rows }
                .padding(.top, Self.topRoom)
                .padding(.bottom, 12)
                .frame(width: Self.width, alignment: .topLeading)
            // Room for the hairline, which the background draws as tall as both.
            page.frame(maxWidth: .infinity, alignment: .topLeading).padding(.leading, Metrics.line)
        }
        .background(alignment: .leading) {
            HStack(spacing: 0) {
                Palette.surface.color.frame(width: Self.width)
                Palette.border.color.frame(width: Metrics.line)
            }
        }
    }
}

/// The line under a side column's first row, as under "All", 16 points in from each side.
public struct SideDivider: View {
    public init() {}

    public var body: some View {
        Palette.border.color.frame(height: Metrics.line).padding(.horizontal, 16).padding(.vertical, 8)
    }
}

/// A row of the side column, which one click on any of it chooses: an `icon` in a 28 point column, the thing's `name` in
/// semibold and a line `under` it in secondary, both cut short to one line, and a `dot` on the right when it needs the
/// person. The `selected` row is filled in the highlight and the one under a pointer that has travelled in the raised
/// surface. A `dimmed` row, as a machine that is offline, draws its words a step quieter. VoiceOver reads it as a button
/// with its words and "needs you" for the dot, and says which is selected.
public struct SideRow: View {
    let name: String
    let under: String?
    let icon: RowIcon?
    let dot: Tone?
    let dimmed: Bool
    let selected: Bool
    let action: () -> Void

    public init(_ name: String, under: String? = nil, icon: RowIcon? = nil, dot: Tone? = nil, dimmed: Bool = false,
                selected: Bool, action: @escaping () -> Void) {
        self.name = name
        self.under = under
        self.icon = icon
        self.dot = dot
        self.dimmed = dimmed
        self.selected = selected
        self.action = action
    }

    /// What VoiceOver reads: "m3, Mac mini, needs you".
    static func spoken(name: String, under: String?, dot: Tone?) -> String {
        ([name] + [under, dot == nil ? nil : "needs you"].compactMap { $0 }).filter { !$0.isEmpty }.joined(separator: ", ")
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon { icon.frame(width: 28) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).plain(PlainMetrics.body, weight: .semibold, tone: dimmed ? .secondary : .text).lineLimit(1).truncationMode(.tail)
                    if let under, !under.isEmpty {
                        Text(under).plain(PlainMetrics.small, tone: dimmed ? .muted : .secondary).lineLimit(1).truncationMode(.tail)
                    }
                }
                Spacer(minLength: 0)
                if let dot { RowDot(dot) }
            }
        }
        .buttonStyle(SideRowStyle(selected: selected))
        .accessibilityLabel(Self.spoken(name: name, under: under, dot: dot))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .padding(.horizontal, 8)
    }
}

struct SideRowStyle: ButtonStyle {
    let selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        SideRowBody(label: configuration.label, selected: selected)
    }
}

/// A side row's fill: the highlight when selected, the raised surface under a pointer that has travelled.
struct SideRowBody<Label: View>: View {
    let label: Label
    let selected: Bool
    @State private var over = false
    @Environment(\.pointerTravelled) private var travelled

    var body: some View {
        label
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 6).fill(selected ? Palette.hover.color : over && travelled ? Palette.surfaceHi.color : .clear))
            .contentShape(Rectangle())
            .onHover { over = $0 }
    }
}

/// A row's button, 28 points tall: `filled` in the text color, with the label in the paper's, for the one step the
/// window waits on, else outlined in a line. One that is not `enabled` is outlined with its label in muted and does
/// nothing. It lights under a pointer that has travelled and dims while pressed. VoiceOver and, with the Mac's Keyboard
/// navigation on, Tab reach it as a button.
public struct WindowButton: View {
    let label: String
    let filled: Bool
    let enabled: Bool
    let action: () -> Void

    public init(_ label: String, filled: Bool = false, enabled: Bool = true, action: @escaping () -> Void) {
        self.label = label
        self.filled = filled
        self.enabled = enabled
        self.action = action
    }

    public var body: some View {
        Button(action: action) { Text(label) }
            .buttonStyle(WindowButtonStyle(filled: filled && enabled))
            .disabled(!enabled)
            .fixedSize()
    }
}

struct WindowButtonStyle: ButtonStyle {
    let filled: Bool

    func makeBody(configuration: Configuration) -> some View {
        WindowButtonBody(label: configuration.label, filled: filled, pressed: configuration.isPressed)
    }
}

struct WindowButtonBody<Label: View>: View {
    let label: Label
    let filled: Bool
    let pressed: Bool
    @State private var over = false
    @Environment(\.pointerTravelled) private var travelled
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let lit = over && travelled && enabled
        let shape = RoundedRectangle(cornerRadius: Metrics.cornerInside)
        label
            .plain(PlainMetrics.small, weight: filled ? .bold : .regular)
            .foregroundStyle(filled ? Palette.bg.color : enabled ? Palette.text.color : Palette.muted.color)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(shape.fill(filled ? Palette.text.color.opacity(lit ? 0.85 : 1) : lit ? Palette.hover.color : .clear))
            .overlay(shape.strokeBorder(filled ? .clear : Palette.borderHi.color, lineWidth: Metrics.line))
            .opacity(pressed ? 0.6 : 1)
            .contentShape(Rectangle())
            .onHover { over = $0 }
    }
}
