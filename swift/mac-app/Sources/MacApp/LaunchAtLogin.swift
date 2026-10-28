import ServiceManagement
import SwiftUI

/// What launch at login reads and changes: macOS's own login item for the app, which System Settings lists under
/// General, Login Items, where the person can turn it off too. Tests pass a stand-in.
public protocol LoginItem {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() throws
}

extension SMAppService: LoginItem {}

/// The app opening at login, read from macOS each time rather than kept in a setting of the app's, so the switch
/// never disagrees with System Settings.
@MainActor
public struct LaunchAtLogin {
    public let item: any LoginItem
    public let log: AppLog?

    public init(item: any LoginItem = SMAppService.mainApp, log: AppLog? = nil) {
        self.item = item
        self.log = log
    }

    public var isEnabled: Bool { item.status == .enabled }

    /// Turns it on or off and answers whether it is on afterwards, as macOS has it: a refusal leaves the switch where
    /// macOS left it, and the reason goes to the log.
    @discardableResult
    public func set(_ on: Bool) -> Bool {
        do {
            if on { try item.register() } else { try item.unregister() }
            log?.note("launch-at-login", on ? "turned on" : "turned off", "now \(statusWords)")
        } catch {
            log?.note("launch-at-login", "could not turn it \(on ? "on" : "off"): \(error.localizedDescription)", "now \(statusWords)")
        }
        return isEnabled
    }

    /// The status in words, for the log and for an installer to read.
    public var statusWords: String {
        switch item.status {
        case .enabled: "enabled"
        case .requiresApproval: "requires approval in System Settings, General, Login Items"
        case .notRegistered: "not registered"
        case .notFound: "not found"
        @unknown default: "unknown"
        }
    }

    /// An installer starts the installed copy with `--start-at-login` to turn it on: this registers the app and
    /// prints `start at login: <status>`, the line the installer waits for. Answers whether the argument was there.
    @discardableResult
    public func startIfAsked(arguments: [String] = CommandLine.arguments, say: (String) -> Void = { print($0); fflush(stdout) }) -> Bool {
        guard arguments.contains("--start-at-login") else { return false }
        set(true)
        say("start at login: \(statusWords)")
        return true
    }
}

/// The switch for Settings: it shows what macOS has when it appears, and after each change what macOS then has.
public struct LaunchAtLoginToggle: View {
    let title: String
    let launch: LaunchAtLogin
    @State private var on = false

    public init(_ title: String = "Open at login", launch: LaunchAtLogin) {
        self.title = title
        self.launch = launch
    }

    public var body: some View {
        Toggle(title, isOn: Binding(get: { on }, set: { on = launch.set($0) }))
            .onAppear { on = launch.isEnabled }
    }
}
