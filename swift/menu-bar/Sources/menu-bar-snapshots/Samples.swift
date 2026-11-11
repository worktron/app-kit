import AppKit
import MenuBarTheme
import SwiftUI

/// The five screens of the Fleet Menu Studies page (rev 3) that the theme is checked against, with the page's text,
/// except that the Macs, commands and key are stand-ins: the repository is public. e2e/mockups.html holds the same text.
/// After them, screens with no mockup, drawn for a look only.
struct Sample {
    let name: String
    let width: CGFloat
    /// The selected line's id, painted as hovered, and the text shown as copied.
    var selected: AnyHashable?
    var copied: String?
    /// The row whose side page is drawn beside the panel.
    var sidePage: AnyHashable?
    /// The look its mockup draws it in, so the comparison holds it to that mockup: console for e2e/mockups.html, the Fleet
    /// Menu Studies page's, and plain for e2e/beeline-mockups.html, the Beeline Menu Studies page's; nil for none.
    var mockup: Look? = .console
    /// A window's page rather than a panel, drawn by windowSnapshot.
    var window = false
    /// The side page's width, the panel's unless given.
    var sideWidth: CGFloat?
    /// The look it is always drawn in, whatever look a render asks for: an app's own colors; nil for the render's.
    var look: Look?
    /// A side page's content drawn as a page of its own, without the room a list keeps at its top and bottom.
    var sidePageAlone = false
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

/// The Plain Panel Studies page's Slate: a cool grey paper and highlight, light and dark, as an app might set them.
let slate = Background(paper: LightDark(light: 0xf7f8fa, dark: 0x1b1d21), highlight: LightDark(light: 0xe1e5ec, dark: 0x2f3540))

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
    // A list of links with one link's choices open beside it, as a menu's submenu.
    Sample(name: "side", width: 480, selected: ["once", "home"], sidePage: "docs", mockup: nil) {
        AnyView(VStack(spacing: 0) {
            Header("links", note: "links it opened")
            Row(Words("github.com/example/widgets/pull/12"), trailing: "work@example.com", id: "pull", page: { linkPage("you opened it in work") })
            Row(Words("docs.example.com/document/d/1AbCdEf/edit"), trailing: "work@example.com", id: "docs",
                page: { linkPage("a rule sends docs.example.com to work") })
            Row(Words("news.example.org/today"), trailing: "home@example.com", id: "news", page: { linkPage("you opened it in home") })
            footer
        })
    },
    // The Beeline Menu Studies page's D, its list in sections, and E, a link's side page, in the plain look, with the page's
    // text; e2e/beeline-mockups.html draws them with the page's own markup.
    Sample(name: "beeline-d", width: 480, mockup: .plain()) { beelineList() },
    Sample(name: "beeline-e", width: 480, mockup: .plain(), sidePageAlone: true) { beelinePage() },
    // Beeline's menu with a link's side page open, the page 380 points wide beside the 480 point list, as the Plain Panel
    // Studies page's A draws it: in the render's look, and in the page's Slate, a paper and highlight an app might set.
    Sample(name: "beeline-d-selected", width: 480, selected: ["link", "k3Ra9vTq2LmXw8Hd"], sidePage: ["link", "k3Ra9vTq2LmXw8Hd"],
           mockup: nil, sideWidth: 380) { beelineList() },
    Sample(name: "beeline-slate", width: 480, selected: ["link", "k3Ra9vTq2LmXw8Hd"], sidePage: ["link", "k3Ra9vTq2LmXw8Hd"],
           mockup: nil, sideWidth: 380, look: .plain(background: slate)) { beelineList() },
    // The Fleet Window Studies page's F with L's marks: a row per machine, its icon (muted when offline), its name, and a
    // red dot when it needs the person, then the app's own rows with their keys and the footer, as Fleet's menu draws
    // them, its first row in the room the panel keeps at its top. The machines are stand-ins.
    Sample(name: "machines-icons", width: 300, selected: ["machine", "alpha"], mockup: nil) { machinesWithIcons() },
]

@MainActor
private func machinesWithIcons() -> AnyView {
    AnyView(VStack(spacing: 0) {
        CompactList {
            CompactRow("alpha", icon: RowIcon(Image(systemName: "macstudio")), dot: .error, opens: false, id: ["machine", "alpha"]) {}
            CompactRow("bravo", icon: RowIcon(Image(systemName: "macmini")), dot: .error, opens: false, id: ["machine", "bravo"]) {}
            CompactRow(Words("charlie-2", .muted), icon: RowIcon(Image(systemName: "laptopcomputer"), tone: .muted), trailing: "offline",
                       dot: .error, opens: false, id: ["machine", "charlie-2"]) {}
            CompactRow("delta", icon: RowIcon(Image(systemName: "laptopcomputer")), opens: false, id: ["machine", "delta"]) {}
        }
        CompactList(closing: true) {
            CompactRow("Open the window", key: "o", opens: false, id: "open") {}
            CompactRow("Open the dashboard", opens: false, id: "dashboard") {}
        }
        Footer([FooterItem("Settings…", key: ",") {}, FooterItem("About") {}], trailing: [FooterItem("Quit", key: "q") {}], lineAbove: true)
    })
}

@MainActor
private func beelineList() -> AnyView {
    let links: [(path: String, count: String, time: String, profile: String)] = [
        ("share.example.com/k3Ra9vTq2LmXw8Hd", "×2", "1:32 PM", "Work"),
        ("budget.example.com", "", "1:11 PM", "Personal"),
        ("share.example.com/p7Qm2ZxL4FisZwQf", "", "12:58 PM", "Work"),
        ("share.example.com/d6Tn4Wc1YpQuMRa9", "", "12:22 PM", "Work"),
        ("github.com/acme/web-app/pull/104", "", "11:47 AM", "Personal"),
        ("github.com/acme/web-app/pull/122", "", "11:30 AM", "Personal"),
        ("github.com/acme/team-notes/pull/28", "", "10:05 AM", "Personal"),
    ]
    return AnyView(VStack(spacing: 0) {
        Header("Beeline")
        PanelSectionLabel("Needs you", first: true)
        ProblemRow("Profile 6 is open without Beeline", detail: "Links there are unknown to Beeline.", fix: "Set it up…") {}
        PanelSectionLabel("Opened recently")
        CompactList {
            ForEach(links, id: \.path) { link in
                CompactRow(Words(link.path), count: link.count, time: link.time, trailing: link.profile,
                           id: ["link", String(link.path.split(separator: "/").last ?? "")], page: { beelinePage() })
            }
        }
        Footer([FooterItem("Settings…", key: ",") {}, FooterItem("About") {}], trailing: [FooterItem("Quit", key: "q") {}], lineAbove: true)
    })
}

/// E: why the link opened where it did and its address as one block of text, then the moves under section labels, with
/// only the setting that exists saying "In effect".
@MainActor
private func beelinePage() -> AnyView {
    AnyView(VStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 4) {
            Text("Opened in Work at 1:32 PM. You set share.example.com to always open there.")
                .console(Metrics.small, tone: .secondary, lineHeight: Look.app.lineHeight)
            Text(verbatim: "https://share.example.com/k3Ra9vTq2LmXw8Hd").console(Metrics.small, tone: .muted, lineHeight: Look.app.lineHeight)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Metrics.inset).padding(.top, 12).padding(.bottom, 8)
        CompactList { CompactRow(Words("Copy the whole link", .info), opens: false, id: "copy") {} }
        PanelSectionLabel("Open once in")
        CompactList { CompactRow("Personal", opens: false, id: ["once", "Personal"]) {} }
        PanelSectionLabel("Always open this page in")
        CompactList {
            CompactRow("Work", opens: false, id: ["page", "Work"]) {}
            CompactRow("Personal", opens: false, id: ["page", "Personal"]) {}
        }
        PanelSectionLabel("Always open share.example.com in")
        CompactList {
            CompactRow("Work", trailing: "In effect", opens: false, id: ["site", "Work"]) {}
            CompactRow("Personal", opens: false, id: ["site", "Personal"]) {}
        }
        CompactList(closing: true) { CompactRow(Words("Change it in Settings…", .info), opens: false, id: "settings") {} }
    })
}

/// A window's pages, from the Plain Look Studies page's option C: Beeline's setup window and two Settings tabs, with
/// the people and their addresses replaced by stand-ins.
@MainActor
let windowSamples: [Sample] = [
    Sample(name: "window-setup", width: 460, mockup: nil, window: true) {
        AnyView(WindowPage {
            PageTitle("Set up Beeline", subtitle: "Open each link in the right Chrome profile")
            SectionLabel("Profiles")
            Lines {
                WindowRow("Personal", detail: "pat@example.com", strong: true) { StatusWord("Set up", .ok) }
                WindowRow("Work", detail: "work@example.com", strong: true) { StatusWord("Set up", .ok) }
                WindowRow("Waiting for the next profile…") { ActionWord("Open the Web Store page") {} }
            }
            FootNote("Switch to each Chrome profile and add Beeline there too. Each one shows up here.")
            ActionBar { StatusWord("2 profiles set up", .secondary) } trailing: { ActionWord("Done", main: true) {} }
        })
    },
    Sample(name: "window-profiles", width: 460, mockup: nil, window: true) {
        AnyView(WindowPage {
            SectionLabel("Default profile", first: true)
            Lines {
                WindowRow("When no rule matches, open links in") { StaticMenu(chosen: "Personal") }
            }
            SectionLabel("Chrome profiles")
            Lines {
                WindowRow("Personal", detail: "pat@example.com · default", strong: true) { StatusWord("Connected", .ok) }
                WindowRow("Work", detail: "work@example.com · signed in to work.example.com, git.example.com", strong: true) {
                    StatusWord("Connected", .ok)
                }
                WindowRow("Client", detail: "client@example.com · not heard from since 10:42", strong: true) { StatusWord("Quiet", .warn) }
            }
            FootNote("Each profile lists the sites Beeline saw it signed in to. Forget a site a profile should not own.")
            ActionBar { EmptyView() } trailing: { ActionWord("Add Beeline to another profile", main: true) {} }
        })
    },
    Sample(name: "window-general", width: 460, mockup: nil, window: true) {
        AnyView(WindowPage {
            SectionLabel("Starting", first: true)
            Lines {
                WindowRow("Open Beeline when you log in", detail: "Starts at login. Turn off to start it yourself.") {
                    Switch("Open Beeline when you log in", isOn: .constant(true))
                }
                WindowRow("Make Beeline the default browser", detail: "Beta. Links from other apps go through Beeline first.") {
                    Switch("Make Beeline the default browser", isOn: .constant(false))
                }
            }
            SectionLabel("Links nothing settles")
            Lines {
                WindowRow("Open them in") { StaticMenu(chosen: "Personal") }
                WindowRow("Test a link") {
                    HairlineField("A link", text: .constant("https://work.example.com/browse/"))
                } trailing: { ActionWord("Test") {} }
            }
            SectionLabel("Remembered")
            Lines {
                WindowRow("Link memory", detail: "Learned from where links opened and where you moved them.") {
                    ActionWord("Forget all", removes: true) {}
                }
            }
            BuildLine("Beeline 1.0.0, 873623f")
        })
    },
    Sample(name: "window-side-column", width: 760, mockup: nil, window: true) { sideColumnWindow() },
    // Rows that open, from the Fleet Window Studies page's U with Y: each issue opens its page, and the one under the
    // pointer is lit in the highlight out to the page's edges, its outlined button on the fill as the page drew it.
    Sample(name: "window-rows-open", width: 520, mockup: nil, window: true) {
        AnyView(WindowPage {
            SectionLabel("Issues 2", first: true, tone: .error)
            Lines {
                WindowRow("The disk is nearly full", detail: "41 GB free of 994 GB. Downloads holds 120 GB.", tone: .error, open: {}) {
                    WindowButton("Show Downloads", filled: true) {}
                }
                WindowRow("Backups have not run for 3 days", detail: "The backup disk was last seen on Friday.", tone: .error,
                          lit: true, open: {}) {
                    WindowButton("Open settings") {}
                }
            }
            SectionLabel("Checked")
            Lines {
                WindowRow("Memory", detail: "12 of 16 GB in use.", open: {}) { StatusWord("Fine", .ok) }
                WindowRow("Network", detail: "Every address answers.") { StatusWord("Fine", .ok) }
            }
        })
    },
]

/// One window with a side column, from the Fleet Window Studies page's A and the Buddy System Window Studies page's D: the
/// chosen thing filled, one that needs the person with its dot, one that is away dimmed, and its page beside it.
@MainActor
private func sideColumnWindow() -> AnyView {
    AnyView(SideColumn {
        SideRow("Everything", selected: false) {}
        SideDivider()
        SideRow("Disk", under: "41 GB free", icon: RowIcon(Image(systemName: "internaldrive")), dot: .error, selected: true) {}
        SideRow("Memory", under: "12 of 16 GB in use", icon: RowIcon(Image(systemName: "memorychip")), selected: false) {}
        SideRow("Network", under: "Away since 9:40am", icon: RowIcon(Image(systemName: "network"), tone: .muted), dimmed: true,
                selected: false) {}
    } page: {
        WindowPage {
            PageTitle("Disk", subtitle: "Checked 2m ago")
            SectionLabel("Issues 2", tone: .error)
            Lines {
                WindowRow("The disk is nearly full", detail: "41 GB free of 994 GB. Downloads holds 120 GB.", tone: .error) {
                    WindowButton("Show Downloads", filled: true) {}
                }
                WindowRow("Backups have not run for 3 days", detail: "The backup disk was last seen on Friday.", tone: .error) {
                    WindowButton("Open settings") {}
                }
            }
            SectionLabel("Clean up")
            Lines {
                WindowRow("Caches", detail: "Nothing to clean up just now.") { WindowButton("Clean up", enabled: false) {} }
            }
        }
        .padding(.top, 18)
    })
}

/// A menu with its choice fixed, for a picture.
private struct StaticMenu: View {
    let chosen: String
    var body: some View {
        TextMenu(selection: .constant(chosen), options: ["Personal", "Work", "Client"].map { (value: $0, name: $0) })
    }
}

@MainActor
private func linkPage(_ why: String) -> AnyView {
    AnyView(VStack(spacing: 0) {
        SubLine("Opened 2m ago. \(why).")
        Row(Words("copy the whole link"), opens: false, id: "copy") {}
        GroupLine("open once in", age: "")
        Row(Words("home"), opens: false, id: ["once", "home"]) {}
        Row(Words("school"), opens: false, id: ["once", "school"]) {}
        GroupLine("always open this page in", age: "")
        Row(Words("home"), opens: false, id: ["always", "home"]) {}
        Row(Words("work"), trailing: "opened here", opens: false, id: ["always", "work"]) {}
    })
}

/// A sample drawn as the panel would draw it, on a pasteboard of its own so a copied line never reaches the person's.
@MainActor
func render(_ sample: Sample, appearance: NSAppearance = NSAppearance(named: .darkAqua)!) throws -> Data {
    let pasteboard = NSPasteboard.withUniqueName()
    defer { pasteboard.releaseGlobally() }
    let state = PanelState(pasteboard: pasteboard)
    state.selected = sample.selected
    if let copied = sample.copied { state.copy(copied) }
    if let sidePage = sample.sidePage { state.openSide(sidePage) }
    let look = sample.look ?? Look.app
    if sample.window { return try windowSnapshot(width: sample.width, appearance: appearance, look: look) { sample.content() } }
    return try snapshot(width: sample.width, sideWidth: sample.sideWidth, appearance: appearance, look: look, state: state,
                        edgeRoom: !sample.sidePageAlone) { sample.content() }
}
