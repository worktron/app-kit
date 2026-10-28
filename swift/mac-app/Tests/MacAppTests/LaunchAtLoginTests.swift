import Foundation
import ServiceManagement
import Testing
@testable import MacApp

/// A login item that is only a value: the tests never touch the test runner's own.
final class StandInLoginItem: LoginItem {
    var status: SMAppService.Status
    var refuses: Bool
    init(_ status: SMAppService.Status, refuses: Bool = false) {
        self.status = status
        self.refuses = refuses
    }

    struct Refused: LocalizedError {
        var errorDescription: String? { "Operation not permitted" }
    }

    func register() throws {
        if refuses { throw Refused() }
        status = .enabled
    }

    func unregister() throws {
        if refuses { throw Refused() }
        status = .notRegistered
    }
}

@MainActor
@Suite struct LaunchAtLoginTests {
    let log = AppLog(file: TestFolder.make().appendingPathComponent("app.log"))

    @Test func theSwitchReadsAndChangesMacOSsItem() {
        let item = StandInLoginItem(.notRegistered)
        let launch = LaunchAtLogin(item: item, log: log)
        #expect(!launch.isEnabled)
        #expect(launch.set(true))
        #expect(item.status == .enabled)
        #expect(!launch.set(false))
        #expect(item.status == .notRegistered)
        #expect(log.tail(1).first?.hasSuffix("\tlaunch-at-login\tturned off\tnow not registered") == true)
    }

    @Test func aRefusalLeavesTheSwitchWhereMacOSHasIt() {
        let launch = LaunchAtLogin(item: StandInLoginItem(.requiresApproval, refuses: true), log: log)
        #expect(!launch.set(true))
        #expect(log.tail(1).first?.hasSuffix(
            "\tlaunch-at-login\tcould not turn it on: Operation not permitted\tnow requires approval in System Settings, General, Login Items") == true)
    }

    @Test func theInstallersArgumentTurnsItOnAndSaysTheStatus() {
        let item = StandInLoginItem(.notRegistered)
        var said: [String] = []
        #expect(!LaunchAtLogin(item: item).startIfAsked(arguments: ["/Applications/My.app/Contents/MacOS/My"]) { said.append($0) })
        #expect(said.isEmpty && item.status == .notRegistered)
        #expect(LaunchAtLogin(item: item).startIfAsked(arguments: ["My", "--start-at-login"]) { said.append($0) })
        #expect(said == ["start at login: enabled"])
    }
}
