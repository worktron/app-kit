import Foundation
import Testing
@testable import MacApp

/// A run started on another thread, so the test can move its clock while it waits.
final class BackgroundRun: @unchecked Sendable {
    private let done = DispatchSemaphore(value: 0)
    private var result: Result<Program.Outcome, Error>?

    init(_ executable: String, _ arguments: [String], later: HandLater) {
        DispatchQueue.global().async {
            self.result = Result { try Program.run(executable, arguments: arguments, limit: 30, grace: 1, later: later) }
            self.done.signal()
        }
    }

    /// Its outcome, once it has ended; nil if it has not within `seconds`, a bound on a failure, not a guess at time.
    func outcome(within seconds: TimeInterval = 60) throws -> Program.Outcome? {
        guard done.wait(timeout: .now() + seconds) == .success else { return nil }
        return try result?.get()
    }
}

/// Waits for a file the program renames into place.
func waitForFile(_ file: URL, within seconds: TimeInterval = 60) -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while !FileManager.default.fileExists(atPath: file.path) {
        if Date() > end { return false }
        usleep(10_000)
    }
    return true
}

/// Whether `pid` is a process that has not ended; one that has ended and waits to be reaped has.
func isRunning(_ pid: pid_t) -> Bool {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&name, 4, &info, &size, nil, 0) == 0, size > 0 else { return false }
    return info.kp_proc.p_stat != SZOMB
}

@Suite struct ProgramTests {
    let folder = TestFolder.make()

    @Test func givesBackItsOutputErrorsAndExitCode() throws {
        let later = HandLater()
        let outcome = try Program.run("/bin/sh", arguments: ["-c", "echo out; echo err >&2; exit 3"], limit: 30, later: later)
        #expect(outcome == Program.Outcome(exitCode: 3, signal: nil, output: Data("out\n".utf8), errorOutput: Data("err\n".utf8), timedOut: false))
        #expect(later.delays == [30])
        later.runNext()
        #expect(later.delays == [], "the limit acted on a run that had ended")
    }

    /// Both outputs past a pipe's buffer: read one after the other, the program would stall writing the second.
    @Test func aFullPipeNeverStallsIt() throws {
        let outcome = try Program.run("/bin/sh", arguments: ["-c", "head -c 300000 /dev/zero >&2; head -c 300000 /dev/zero"], limit: 30, later: HandLater())
        #expect(outcome.output.count == 300_000)
        #expect(outcome.errorOutput.count == 300_000)
        #expect(outcome.exitCode == 0)
    }

    /// At the limit the program and the child it started both end, and the app stops waiting for the output the
    /// child held open.
    @Test func theLimitEndsItAndEverythingItStarted() throws {
        let child = folder.appendingPathComponent("child")
        let later = HandLater()
        let run = BackgroundRun("/bin/sh", ["-c", "sleep 600 & echo $! > '\(child.path).part' && mv '\(child.path).part' '\(child.path)'; wait"], later: later)
        #expect(later.waitForNext())
        #expect(waitForFile(child))
        let pid = try #require(pid_t(String(contentsOf: child, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)))
        later.runNext()
        let outcome = try #require(try run.outcome())
        #expect(outcome.timedOut)
        #expect(outcome.signal == SIGTERM)
        #expect(!isRunning(pid))
        #expect(later.delays == [1])
        later.runNext()
    }

    @Test func oneThatIgnoresTheRequestIsMadeToStop() throws {
        let ready = folder.appendingPathComponent("ready")
        let later = HandLater()
        let run = BackgroundRun("/bin/sh", ["-c", "trap '' TERM; sleep 600 & touch '\(ready.path).part' && mv '\(ready.path).part' '\(ready.path)'; wait"], later: later)
        #expect(later.waitForNext())
        #expect(waitForFile(ready))
        later.runNext()
        #expect(later.waitForNext())
        later.runNext()
        let outcome = try #require(try run.outcome())
        #expect(outcome.timedOut)
        #expect(outcome.signal == SIGKILL)
    }

    /// A pipe of the app's that is not marked close-on-exec is not passed on: another run's output held open by
    /// this program would keep that run waiting.
    @Test func itInheritsOnlyItsThreeDescriptors() throws {
        var fds: [Int32] = [-1, -1]
        #expect(pipe(&fds) == 0)
        defer { fds.forEach { close($0) } }
        let outcome = try Program.run("/bin/ls", arguments: ["/dev/fd"], limit: 30, later: HandLater())
        let listed = outcome.outputText.split(separator: "\n").map(String.init)
        #expect(listed.contains("2"))
        #expect(!listed.contains(String(fds[0])) && !listed.contains(String(fds[1])))
    }

    @Test func runsInTheFolderGiven() throws {
        let outcome = try Program.run("/bin/pwd", directory: folder, limit: 30, later: HandLater())
        // pwd names the folder past /tmp's link, which Foundation's resolving leaves out again.
        #expect(outcome.outputText == "/private" + folder.path + "\n")
    }

    @Test func aProgramThatIsNotThereSaysSo() {
        #expect(throws: Program.Problem.couldNotStart("/nonexistent/tool", "No such file or directory")) {
            try Program.run("/nonexistent/tool", limit: 30, later: HandLater())
        }
    }

    @Test func theSearchPathPutsTheToolFoldersFirstOnce() {
        #expect(Program.searchPath(adding: Program.toolFolders(home: "/Volumes/Example"), to: "/usr/bin:/bin:/usr/local/bin")
            == "/Volumes/Example/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    }
}
