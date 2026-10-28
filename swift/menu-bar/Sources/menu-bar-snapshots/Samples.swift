import AppKit
import MenuBarTheme
import SwiftUI

/// The five screens of the Fleet Menu Studies page (rev 3) that the theme is checked against, with the page's text,
/// except that the Macs, commands and key are stand-ins: the repository is public. e2e/mockups.html holds the same text.
struct Sample {
    let name: String
    let width: CGFloat
    /// The selected line's id, painted as hovered, and the text shown as copied.
    var selected: AnyHashable?
    var copied: String?
    let content: () -> AnyView
}

@MainActor private let footer = Footer([FooterItem("settings", key: ",") {}, FooterItem("about") {}], trailing: [FooterItem("quit", key: "q") {}])
private let key = "ssh_key: \"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyExampleKeyExampleKeyExampleKeyEx fleet:bravo\""

@MainActor
private func machines(_ header: Header, fine: Bool = false) -> AnyView {
    AnyView(VStack(spacing: 0) {
        header
        Row("alpha", status: fine ? Words("fine", .ok) : Words("has never reported", .error).then("+1", .muted), age: fine ? "4m" : "never") {}
        Row("bravo", status: fine ? Words("fine", .ok) : Words("nudged, sent no new report", .error).then("+2", .muted), age: fine ? "9m" : "2h") {}
        Row("charlie-2", status: fine ? Words("fine", .ok) : Words("apply stopped: model", .error), age: "2m") {}
        Row("delta", status: Words("fine", .ok), age: "16m") {}
        footer
    })
}

@MainActor
let samples: [Sample] = [
    Sample(name: "f-list", width: 400, selected: "bravo") {
        machines(Header("fleet", status: Words("3 of 4 need you", .error), note: "read just now"))
    },
    Sample(name: "f-page", width: 400, copied: key) {
        AnyView(VStack(spacing: 0) {
            Header("bravo", status: Words("3 problems", .error), note: "2h ago") {}
            SubLine("MacBook Air · reachable from charlie-2, delta")
            ProblemBlock("nudged, but sent no new report", hint: "on bravo, read its sync log", copy: "bun bin/sync.ts log")
            ProblemBlock("its fleet key isn't in machines.yaml", hint: "land this under bravo", copy: key)
            ProblemBlock("apply stopped on share-page", hint: "on bravo, see why", copy: "bun bin/apply.ts")
            footer
        })
    },
    Sample(name: "g", width: 420) {
        AnyView(VStack(spacing: 0) {
            Header("fleet", status: Words("3 of 4 need you", .error), note: "read just now")
            ItemGroup("alpha", age: "never reported") {
                ItemLine("has never reported", copy: "bun bin/sync.ts install")
                ItemLine("online, but won't let the other Macs in", copy: nil)
            }
            ItemGroup("bravo", age: "2h ago") {
                ItemLine("nudged, sent no new report", copy: "bun bin/sync.ts log")
                ItemLine("fleet key isn't in machines.yaml", copy: key)
                ItemLine("apply stopped on share-page", copy: "bun bin/apply.ts")
            }
            ItemGroup("charlie-2", age: "2m ago") {
                ItemLine("apply stopped on the settings key model", copy: "bun bin/apply.ts")
            }
            GroupLine("delta", status: Words("fine", .ok), age: "16m ago")
            footer
        })
    },
    Sample(name: "fine", width: 400) {
        machines(Header("fleet", status: Words("all 4 fine", .ok), note: "read just now"), fine: true)
    },
    Sample(name: "unreadable", width: 400) {
        machines(Header("fleet", status: Words("couldn't read status", .warn), note: "as of 12m ago"))
    },
]

/// A sample drawn as the panel would draw it, on a pasteboard of its own so a copied line never reaches the person's.
@MainActor
func render(_ sample: Sample, appearance: NSAppearance = NSAppearance(named: .darkAqua)!) throws -> Data {
    let pasteboard = NSPasteboard.withUniqueName()
    defer { pasteboard.releaseGlobally() }
    let state = PanelState(pasteboard: pasteboard)
    state.selected = sample.selected
    if let copied = sample.copied { state.copy(copied) }
    return try snapshot(width: sample.width, appearance: appearance, state: state) { sample.content() }
}
