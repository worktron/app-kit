import AppKit
import SwiftUI

// The plain look's own controls, drawn by the kit rather than macOS, from the Plain Look Studies page's option C: a
// switch, a menu that reads as text, and a text field in a hairline box, with nothing filled but a switch that is on.
// SwiftUI takes a custom style for a toggle, so the switch is one; it takes none for a picker or a text field, so the
// menu and the field are views of their own.

/// A switch 28 by 16: a muted outline and knob when off, filled in the accent with a paper knob when on. A click on it
/// flips it. It draws no label, since the row it sits in says what it sets; the label is what VoiceOver reads.
public struct SwitchStyle: ToggleStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        let on = configuration.isOn
        let inset = (PlainMetrics.switchHeight - PlainMetrics.switchKnob) / 2
        ZStack(alignment: on ? .trailing : .leading) {
            Capsule().fill(on ? Palette.info.color : Color.clear)
            Capsule().strokeBorder(on ? Palette.info.color : Palette.muted.color, lineWidth: PlainMetrics.line)
            Circle().fill(on ? Palette.bg.color : Palette.muted.color)
                .frame(width: PlainMetrics.switchKnob, height: PlainMetrics.switchKnob)
                .padding(.horizontal, inset)
        }
        .frame(width: PlainMetrics.switchWidth, height: PlainMetrics.switchHeight)
        .contentShape(Capsule())
        .onTapGesture { configuration.isOn.toggle() }
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
}

extension ToggleStyle where Self == SwitchStyle {
    /// The plain look's switch.
    public static var lookSwitch: SwitchStyle { SwitchStyle() }
}

/// The plain look's switch for a setting whose name the row says: `label` is for VoiceOver only.
public struct Switch: View {
    let label: String
    @Binding var isOn: Bool

    public init(_ label: String, isOn: Binding<Bool>) {
        self.label = label
        _isOn = isOn
    }

    public var body: some View {
        Toggle(isOn: $isOn) { Text(label) }
            .toggleStyle(.lookSwitch)
    }
}

/// A choice among a few, which reads as text: the chosen one's name and a chevron over a hairline, opening a menu of
/// the others on a click.
public struct TextMenu<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, name: String)]

    public init(selection: Binding<Value>, options: [(value: Value, name: String)]) {
        _selection = selection
        self.options = options
    }

    public var body: some View {
        Menu {
            ForEach(options.indices, id: \.self) { index in
                Button(options[index].name) { selection = options[index].value }
            }
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Text(options.first { $0.value == selection }?.name ?? "").plain(PlainMetrics.body)
                    Text("⌄").plain(PlainMetrics.body, tone: .secondary).offset(y: -2)
                }
                .padding(.vertical, 1)
                Hairline()
            }
            .fixedSize()
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

/// A text field in a hairline box with 4 point corners, its text at 12, the prompt in muted while it is empty.
public struct HairlineField: View {
    let prompt: String
    @Binding var text: String

    public init(_ prompt: String, text: Binding<String>) {
        self.prompt = prompt
        _text = text
    }

    public var body: some View {
        TextField(text: $text) { Text(prompt).foregroundStyle(Palette.muted.color) }
            .textFieldStyle(.plain)
            .font(Typeface.font(size: PlainMetrics.small))
            .foregroundStyle(Palette.text.color)
            .lineLimit(1)
            .padding(.vertical, PlainMetrics.fieldPaddingVertical)
            .padding(.horizontal, PlainMetrics.fieldPaddingHorizontal)
            .overlay(RoundedRectangle(cornerRadius: PlainMetrics.fieldCorner).strokeBorder(Palette.border.color, lineWidth: PlainMetrics.line))
            .padding(.top, PlainMetrics.labelGap)
    }
}
