import Foundation

/// Running another program from the app (a status command, a script) with a time limit, off the main thread. The
/// program runs in a process group of its own, and at the limit the whole group is asked to stop and, a moment later,
/// made to, so a script's own children end with it rather than keep its output open and the app waiting. It inherits
/// nothing of the app's but the three it is given: input from /dev/null, its output and its error output, which are
/// read at once so a full pipe never stalls it.
public enum Program {
    public struct Outcome: Equatable, Sendable {
        /// Its exit status, or nil when a signal ended it.
        public var exitCode: Int32?
        /// The signal that ended it, or nil when it exited.
        public var signal: Int32?
        public var output: Data
        public var errorOutput: Data
        /// Whether it was still running at the limit and was stopped.
        public var timedOut: Bool

        public var outputText: String { String(decoding: output, as: UTF8.self) }
        public var errorText: String { String(decoding: errorOutput, as: UTF8.self) }
    }

    public enum Problem: Error, Equatable {
        /// macOS refused to start it, with the reason in words (no such file, not executable).
        case couldNotStart(String, String)
    }

    /// Runs `executable`, an absolute path, and waits for it, at most `limit` seconds before stopping it: SIGTERM to
    /// its group, then SIGKILL `grace` seconds later. `environment` replaces the app's own when given; an app started
    /// from Finder has launchd's short PATH, which `searchPath(adding:)` lengthens. Call it off the main thread.
    public static func run(_ executable: String, arguments: [String] = [], directory: URL? = nil, environment: [String: String]? = nil,
                           limit: TimeInterval, grace: TimeInterval = 1, later: any Later = QueueLater(.global())) throws -> Outcome {
        var output: [Int32] = [-1, -1]
        var errors: [Int32] = [-1, -1]
        guard pipe(&output) == 0 else { throw Problem.couldNotStart(executable, String(cString: strerror(errno))) }
        guard pipe(&errors) == 0 else {
            output.forEach { close($0) }
            throw Problem.couldNotStart(executable, String(cString: strerror(errno)))
        }
        // Marked so no program the app starts some other way inherits them.
        for fd in output + errors { _ = fcntl(fd, F_SETFD, FD_CLOEXEC) }

        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_adddup2(&actions, output[1], 1)
        posix_spawn_file_actions_adddup2(&actions, errors[1], 2)
        if let directory {
            if #available(macOS 26, *) {
                posix_spawn_file_actions_addchdir(&actions, directory.path)
            } else {
                posix_spawn_file_actions_addchdir_np(&actions, directory.path)
            }
        }

        var attributes: posix_spawnattr_t?
        posix_spawnattr_init(&attributes)
        defer { posix_spawnattr_destroy(&attributes) }
        // Its own group, which the limit stops whole; only the three descriptors above, so it never holds another
        // run's pipe open; and every signal at its default, whatever the app ignores.
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK))
        posix_spawnattr_setpgroup(&attributes, 0)
        var all = sigset_t()
        sigfillset(&all)
        posix_spawnattr_setsigdefault(&attributes, &all)
        var none = sigset_t()
        sigemptyset(&none)
        posix_spawnattr_setsigmask(&attributes, &none)

        let argv = ([executable] + arguments).map { strdup($0) } + [nil]
        let envp = (environment ?? ProcessInfo.processInfo.environment).map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { (argv + envp).forEach { free($0) } }

        var pid: pid_t = 0
        let started = posix_spawn(&pid, executable, &actions, &attributes, argv, envp)
        close(output[1])
        close(errors[1])
        guard started == 0 else {
            close(output[0])
            close(errors[0])
            throw Problem.couldNotStart(executable, String(cString: strerror(started)))
        }

        let run = Running()
        let group = pid
        later.after(limit) {
            guard run.expire() else { return }
            kill(-group, SIGTERM)
            later.after(grace) { if run.isRunning { kill(-group, SIGKILL) } }
        }

        let reads = DispatchGroup()
        let read = (output: Box(), errors: Box())
        for (fd, box) in [(output[0], read.output), (errors[0], read.errors)] {
            DispatchQueue.global().async(group: reads) {
                box.data = readAll(fd)
                close(fd)
            }
        }
        reads.wait()
        var status: Int32 = 0
        while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
        let timedOut = run.finish()
        let exited = status & 0x7f == 0
        return Outcome(exitCode: exited ? (status >> 8) & 0xff : nil, signal: exited ? nil : status & 0x7f,
                       output: read.output.data, errorOutput: read.errors.data, timedOut: timedOut)
    }

    /// The same, awaited: it runs on a global queue.
    public static func run(_ executable: String, arguments: [String] = [], directory: URL? = nil, environment: [String: String]? = nil,
                           limit: TimeInterval, grace: TimeInterval = 1, later: any Later = QueueLater(.global())) async throws -> Outcome {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(with: Result {
                    try run(executable, arguments: arguments, directory: directory, environment: environment, limit: limit, grace: grace, later: later)
                })
            }
        }
    }

    /// `path` with `folders` in front, each once: for a program the app finds by name, such as bun.
    public static func searchPath(adding folders: [String], to path: String? = ProcessInfo.processInfo.environment["PATH"]) -> String {
        var seen = Set<String>()
        return (folders + (path ?? "").split(separator: ":").map(String.init))
            .filter { !$0.isEmpty && seen.insert($0).inserted }
            .joined(separator: ":")
    }

    /// Where the owner's tools live that launchd's PATH lacks: bun's folder, then Homebrew's on Apple silicon and Intel.
    public static func toolFolders(home: String = NSHomeDirectory()) -> [String] {
        [home + "/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    }

    private static func readAll(_ fd: Int32) -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 65536)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count > 0 {
                data.append(contentsOf: buffer[0..<count])
            } else if count == 0 || errno != EINTR {
                return data
            }
        }
    }

    /// Whether the run has ended, and whether the limit ended it, shared with the timer.
    private final class Running: @unchecked Sendable {
        private let lock = NSLock()
        private var finished = false
        private var expired = false

        /// Marks the limit reached; false when the run had already ended.
        func expire() -> Bool {
            lock.withLock {
                if !finished { expired = true }
                return !finished
            }
        }

        var isRunning: Bool { lock.withLock { !finished } }

        /// Marks the run ended; answers whether the limit was reached first.
        func finish() -> Bool {
            lock.withLock {
                finished = true
                return expired
            }
        }
    }

    private final class Box: @unchecked Sendable {
        var data = Data()
    }
}
