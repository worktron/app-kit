import Foundation
@testable import MacApp

/// A folder for one test, inside one folder per test process, /tmp/app-kit-tests/<pid>, which no one else can write
/// to; the folders of test processes that have ended are removed the first time a test asks for one, since a test
/// process killed part way leaves its own.
enum TestFolder {
    static let root = URL(fileURLWithPath: "/tmp/app-kit-tests", isDirectory: true)

    private static let process: URL = {
        let files = FileManager.default
        try? files.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard let attributes = try? files.attributesOfItem(atPath: root.path),
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700 else {
            fatalError("\(root.path) is not a folder this user owns that no one else can write to")
        }
        for name in (try? files.contentsOfDirectory(atPath: root.path)) ?? [] {
            if let pid = Int32(name), pid != getpid(), kill(pid, 0) != 0, errno == ESRCH {
                try? files.removeItem(at: root.appendingPathComponent(name))
            }
        }
        let mine = root.appendingPathComponent("\(getpid())", isDirectory: true)
        try? files.createDirectory(at: mine, withIntermediateDirectories: true)
        return mine
    }()

    /// A new, empty folder.
    static func make() -> URL {
        let folder = process.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}

/// `Later` moved by hand: each delay waits until the test runs it, and `waitForNext` blocks until the code has asked
/// for one, so a test decides the order instead of guessing at time.
final class HandLater: Later, @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [(seconds: TimeInterval, work: @Sendable () -> Void)] = []
    private let asked = DispatchSemaphore(value: 0)

    func after(_ seconds: TimeInterval, _ work: @escaping @Sendable () -> Void) {
        lock.withLock { pending.append((seconds, work)) }
        asked.signal()
    }

    /// The delays asked for and not yet run.
    var delays: [TimeInterval] { lock.withLock { pending.map(\.seconds) } }

    /// Blocks until the code asks for another delay, at most `seconds`; false if it never did.
    func waitForNext(seconds: TimeInterval = 60) -> Bool {
        asked.wait(timeout: .now() + seconds) == .success
    }

    /// Runs the oldest delay's work, as if its time had come.
    func runNext() {
        let next = lock.withLock { pending.isEmpty ? nil : pending.removeFirst() }
        next?.work()
    }
}
