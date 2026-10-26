// The bare swiftc route, as Fleet and perf-buddy build: the theme compiled as a module of its own and an app that
// imports it, with a Row of its own, as Fleet has. swiftc-build.sh builds and runs it; it draws one screen with the
// fonts copied beside it, and fails when they do not load.
import AppKit
import MenuBarTheme
import SwiftUI

struct Row: Equatable {
    let title: String
}

MainActor.assumeIsolated {
    _ = NSApplication.shared
    let mine = Row(title: "an app's own row")
    do {
        let png = try snapshot(width: 400) {
            Header("fleet", status: Words("all 1 fine", .ok), note: "read just now")
            MenuBarTheme.Row("alpha", status: Words("fine", .ok), age: "4m") {}
            Footer([FooterItem("settings", key: ",") {}], trailing: [FooterItem("quit", key: "q") {}])
        }
        try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        print("drew \(png.count) bytes beside \(mine.title)")
    } catch {
        FileHandle.standardError.write(Data("swiftc-app: \(error)\n".utf8))
        exit(1)
    }
}
