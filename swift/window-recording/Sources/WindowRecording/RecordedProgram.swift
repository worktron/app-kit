import Darwin
import Foundation

/// The program whose window is recorded, known by its process and the program file it runs, so a later process that
/// took the same number is never mistaken for it. When the recording program ends while the recorded program still
/// runs (its caller went without closing it, as when a terminal's Ctrl-C ends the caller), the recorded program's
/// window is still on the hidden display, and macOS moves a window left on a display that goes onto the owner's
/// screen: so the recorded program is ended first, and the display waits for it.
public struct RecordedProgram: Equatable, Sendable {
    public let pid: pid_t
    public let path: String

    /// The program `pid` runs now, or nil when no such process runs.
    public init?(pid: pid_t) {
        guard let path = programPath(pid) else { return nil }
        self.pid = pid
        self.path = path
    }

    /// Whether this program still runs: its process is there and runs the same program file.
    public var running: Bool { programPath(pid) == path }

    /// Ends the program when it still runs: asked to quit, then, if it has not within `seconds`, stopped outright.
    /// Gives whether it had to be ended, so the caller can say so.
    @discardableResult
    public func end(within seconds: Double = 5) -> Bool {
        guard running else { return false }
        kill(pid, SIGTERM)
        if gone(within: seconds) { return true }
        kill(pid, SIGKILL)
        _ = gone(within: 2)
        return true
    }

    private func gone(within seconds: Double) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if !running { return true }
            usleep(20_000)
        }
        return !running
    }
}

/// The program file process `pid` runs, or nil when there is no such process (an ended one included).
func programPath(_ pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(cString: buffer)
}
