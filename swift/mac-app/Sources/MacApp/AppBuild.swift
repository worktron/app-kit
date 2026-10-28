import AppKit

/// Which build is running: its version and the commit it was built from, which the app's installer stamps into
/// Info.plist under a key the app names (Beeline's is BeelineCommit), as `abc1234` or `abc1234 with uncommitted
/// changes`. About shows both.
public struct AppBuild: Equatable, Sendable {
    public var version: String
    /// Nil for a build nothing stamped, such as one from Xcode, whose Info.plist still holds `$(…)`.
    public var commit: String?

    public init(version: String, commit: String?) {
        self.version = version
        self.commit = commit
    }

    public init(info: [String: Any] = Bundle.main.infoDictionary ?? [:], commitKey: String) {
        version = info["CFBundleShortVersionString"] as? String ?? "unknown"
        let stamped = (info[commitKey] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        commit = stamped.isEmpty || stamped.hasPrefix("$(") ? nil : stamped
    }

    /// The commit, or "development build" when nothing stamped one.
    public var commitWords: String { commit ?? "development build" }

    /// "1.0.0, 683f92e", or "1.0.0, development build".
    public var description: String { "\(version), \(commitWords)" }

    /// The standard About panel, with the version and the commit.
    @MainActor
    public func showAbout() {
        NSApp.activate()
        NSApp.orderFrontStandardAboutPanel(options: [.applicationVersion: version, .version: commitWords])
    }
}
