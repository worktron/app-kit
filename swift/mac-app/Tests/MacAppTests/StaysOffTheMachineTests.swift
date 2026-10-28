import Foundation
import Testing

/// Nothing a test runs touches the Mac it runs on: not the test runner's own login item, not its Dock icon or the app
/// in front, not Chrome's real host folder, and not macOS's own notification centers. Each piece takes what it
/// touches as an input, and this reads every test file for a call that would use the real one.
@Suite struct StaysOffTheMachineTests {
    static let forbidden = [
        "SMAppService.mainApp", "LaunchAtLogin()", "LaunchAtLogin(log:",
        "setActivationPolicy", "NSApp.activate", "orderFront", "makeKeyAndOrderFront", "showAbout(", "AppWindows.show(", "openSettingsScene(",
        "DockIcon.follow()", "NotificationCenter.default", "NSWorkspace.shared.notificationCenter.post",
        "chromeHostsFolder()", "homeDirectoryForCurrentUser",
    ]

    @Test func noTestUsesTheRealThing() throws {
        let tests = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let files = try FileManager.default.contentsOfDirectory(atPath: tests.path).filter { $0.hasSuffix(".swift") && $0 != "StaysOffTheMachineTests.swift" }
        #expect(files.count >= 7)
        for file in files {
            let text = try String(contentsOf: tests.appendingPathComponent(file), encoding: .utf8)
            for call in Self.forbidden {
                #expect(!text.contains(call), "\(file) uses \(call), which reaches this Mac's own")
            }
        }
    }
}
