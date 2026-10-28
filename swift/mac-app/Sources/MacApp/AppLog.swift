import Foundation

/// An app's own record of what it decided and why, one line per step, in a file it names in its AGENTS.md, so the owner
/// and an agent read it from a terminal without opening the app. Each line is the time in UTC to the millisecond, then
/// the app's fields, tab-separated. Two processes may write the same file (an app and its native host): each line goes
/// in whole under a lock, and once the file passes `limit` bytes it is cut to its newest half, at a line start, and
/// renamed into place, so a reader never sees half of it.
public struct AppLog: Sendable {
    public let file: URL
    public let limit: Int
    /// Runs after each open and before the lock, with the attempt's number: only the tests set it, to trim the file
    /// under a writer at that moment.
    var afterOpen: (@Sendable (Int) -> Void)?

    public init(file: URL, limit: Int = 1024 * 1024) {
        self.file = file
        self.limit = limit
    }

    /// The folder in Application Support named `name`, where an app keeps its log beside what else it saves.
    public static func applicationSupport(_ name: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent("Library/Application Support", isDirectory: true).appendingPathComponent(name, isDirectory: true)
    }

    /// Appends one line: the time, then `fields`, each with its tabs and line breaks turned into spaces. Answers whether
    /// the whole line went in; it does not when the folder cannot be written or the disk is full.
    @discardableResult
    public func note(_ fields: String..., now: Date = Date()) -> Bool {
        note(fields, now: now)
    }

    @discardableResult
    public func note(_ fields: [String], now: Date = Date()) -> Bool {
        let line = ([Self.time(now)] + fields.map(Self.field)).joined(separator: "\t") + "\n"
        let data = Data(line.utf8)
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        // A trim in another process may rename a new file over the one this opened while it waited for the lock; the
        // line would then go into a file with no name, so it opens the file again until the lock is on the named one.
        for attempt in 0..<8 {
            let fd = open(file.path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0o600)
            guard fd >= 0 else { return false }
            afterOpen?(attempt)
            flock(fd, LOCK_EX)
            var opened = stat()
            var named = stat()
            guard fstat(fd, &opened) == 0, stat(file.path, &named) == 0, opened.st_ino == named.st_ino, opened.st_dev == named.st_dev else {
                close(fd)
                continue
            }
            let wrote = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
            if lseek(fd, 0, SEEK_END) > limit { trim() }
            close(fd)
            return wrote == data.count
        }
        return false
    }

    /// Keeps the newest half of the file, from the first line that starts in it. Called with the lock held.
    private func trim() {
        guard let all = try? Data(contentsOf: file) else { return }
        let half = all.suffix(limit / 2)
        // A half that starts on a line's first byte keeps that line; otherwise the part line is dropped.
        let whole = half.startIndex == all.startIndex || all[half.index(before: half.startIndex)] == UInt8(ascii: "\n")
        let start = whole ? half.startIndex : half.firstIndex(of: UInt8(ascii: "\n")).map { half.index(after: $0) } ?? half.startIndex
        try? half[start...].write(to: file, options: .atomic)
    }

    /// The newest `count` lines, oldest first; none when the file does not exist.
    public func tail(_ count: Int) -> [String] {
        guard count > 0, let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").suffix(count).map(String.init)
    }

    /// A line's time: ISO 8601 in UTC with milliseconds.
    public static func time(_ date: Date) -> String {
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return dates.string(from: date)
    }

    /// The time at the start of a line, as `time` wrote it.
    public static func date(_ text: String) -> Date? {
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return dates.date(from: text)
    }

    /// A link as a log keeps it: without its query, fragment or credentials, where tokens travel, and without its path
    /// too when `keepPath` is false, for a path that carries one (a reset or invite link).
    public static func link(_ url: URL?, keepPath: Bool = true) -> String {
        guard let url, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "-" }
        components.query = nil
        components.fragment = nil
        components.user = nil
        components.password = nil
        if !keepPath { components.path = "" }
        return components.string ?? "-"
    }

    static func field(_ text: String) -> String {
        String(text.map { $0 == "\t" || $0.isNewline ? " " : $0 })
    }
}
