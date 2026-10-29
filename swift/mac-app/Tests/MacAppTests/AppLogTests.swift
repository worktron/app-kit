import Foundation
import Testing
@testable import MacApp

@Suite struct AppLogTests {
    let folder = TestFolder.make()
    var file: URL { folder.appendingPathComponent("logs/app.log") }

    func lines() throws -> [String] {
        try String(contentsOf: file, encoding: .utf8).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    @Test func writesTheTimeThenTheFieldsTabSeparated() throws {
        let log = AppLog(file: file)
        log.note("opened", "a\tb", "two\nlines", now: Date(timeIntervalSince1970: 1_800_000_000.25))
        #expect(try lines() == ["2027-01-15T08:00:00.250Z\topened\ta b\ttwo lines", ""])
        #expect(AppLog.date("2027-01-15T08:00:00.250Z") == Date(timeIntervalSince1970: 1_800_000_000.25))
    }

    @Test func onlyItsOwnerReadsIt() throws {
        AppLog(file: file).note("x")
        let mode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
        #expect(mode?.intValue == 0o600)
    }

    @Test func pastItsLimitKeepsTheNewestHalfFromALineStart() throws {
        let log = AppLog(file: file, limit: 400)
        for n in 0..<40 { log.note("line \(n)") }
        let kept = try lines().dropLast()
        let size = try Data(contentsOf: file).count
        #expect(size <= 400)
        #expect(kept.last?.hasSuffix("\tline 39") == true)
        #expect(kept.allSatisfy { AppLog.date(String($0.prefix(24))) != nil })
        let mode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
        #expect(mode?.intValue == 0o600)
    }

    /// The other writer trims the file between this one's open and its lock, renaming a new file over the one it
    /// opened: its line still lands in the file the path names.
    @Test func aLineWrittenAsAnotherProcessTrimsIsKept() throws {
        // Just under the limit, so the other writer's one line takes it over.
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("logs"), withIntermediateDirectories: true)
        try Data(String(repeating: "filler line\n", count: 24).utf8).write(to: file)
        let other = AppLog(file: file, limit: 300)
        var writer = AppLog(file: file, limit: 300)
        let before = try FileManager.default.attributesOfItem(atPath: file.path)[.systemFileNumber] as? NSNumber
        writer.afterOpen = { attempt in if attempt == 0 { other.note("the trimming line") } }
        writer.note("the line that must not be lost")
        let after = try FileManager.default.attributesOfItem(atPath: file.path)[.systemFileNumber] as? NSNumber
        #expect(before != after, "the other writer did not trim, so this proves nothing")
        let kept = try lines()
        #expect(kept.contains { $0.hasSuffix("\tthe trimming line") })
        #expect(kept.contains { $0.hasSuffix("\tthe line that must not be lost") })
    }

    /// When the newest half starts on a line's first byte, that line is whole and stays.
    @Test func aCutOnALineStartKeepsThatLine() throws {
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("logs"), withIntermediateDirectories: true)
        // Nine lines of ten bytes; the 27 byte line below takes the file to 117 bytes, past 94, and its newest 47
        // start at byte 70, the first of "line 7...".
        try Data((0..<9).map { "line \($0)...\n" }.joined().utf8).write(to: file)
        let log = AppLog(file: file, limit: 94)
        #expect(log.note("x"))
        let kept = try lines().dropLast()
        #expect(kept.first == "line 7...")
        #expect(kept.count == 3)
    }

    @Test func aLineLongerThanHalfTheLimitIsKeptWhole() throws {
        let log = AppLog(file: file, limit: 40)
        #expect(log.note("x"))
        let long = String(repeating: "y", count: 30)
        #expect(log.note(long))
        #expect(try lines().dropLast().map { $0.split(separator: "\t").last.map(String.init) } == [long])
    }

    @Test func aLineThatCannotBeWrittenSaysSo() throws {
        let locked = folder.appendingPathComponent("locked")
        try FileManager.default.createDirectory(at: locked, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o500])
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: locked.path) }
        #expect(!AppLog(file: locked.appendingPathComponent("app.log")).note("x"))
        #expect(AppLog(file: file).note("x"))
    }

    @Test func tailIsTheNewestLinesOldestFirst() {
        let log = AppLog(file: file)
        #expect(log.tail(3) == [])
        for n in 0..<5 { log.note("line \(n)") }
        #expect(log.tail(2).map { $0.split(separator: "\t").last.map(String.init) } == ["line 3", "line 4"])
    }

    @Test func aLinkLosesWhatCarriesTokens() {
        let url = URL(string: "https://me:secret@example.com/reset/abc?token=1#part")
        #expect(AppLog.link(url) == "https://example.com/reset/abc")
        #expect(AppLog.link(url, keepPath: false) == "https://example.com")
        #expect(AppLog.link(nil) == "-")
    }

    @Test func theApplicationSupportFolderIsUnderTheHomeGiven() {
        #expect(AppLog.applicationSupport("Beeline", home: URL(fileURLWithPath: "/Volumes/Example")).path
            == "/Volumes/Example/Library/Application Support/Beeline")
    }
}
