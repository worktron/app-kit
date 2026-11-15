import Foundation

// The keep list's removal rules (Sources/HandledNotifications.swift) and its record (Sources/KeepRecord.swift), run on the Mac by scripts/gates.sh with bare swiftc,
// since the plugin's own package builds only for iOS against Tauri.

var failures = 0
func check(_ name: String, _ got: KeepDecision, _ want: KeepDecision) {
    if got == want {
        print("ok: \(name)")
    } else {
        failures += 1
        print("FAIL: \(name): got \(got), want \(want)")
    }
}

let list: Set<String> = ["thread-c", "thread-d"]
let before = 1_000.0
func push(_ id: String, sent: Double? = 500, covers: [String]? = nil) -> DeliveredNotification {
    DeliveredNotification(id: id, fromPush: true, sent: sent, covers: covers)
}

check("an alert whose tag is not on the list goes", keepDecision(for: push("thread-a"), kept: list, before: before), .remove)
check("an alert whose tag is on the list stays", keepDecision(for: push("thread-d"), kept: list, before: before), .keepOnList("thread-d"))
check("a summary stays while any tag it covers is on the list",
      keepDecision(for: push("summary", covers: ["thread-b", "thread-c"]), kept: list, before: before), .keepOnList("thread-c"))
check("a summary goes once none of its tags is on the list",
      keepDecision(for: push("summary", covers: ["thread-a", "thread-b"]), kept: list, before: before), .remove)
check("a summary goes by what it covers, not by its own tag",
      keepDecision(for: push("thread-c", covers: ["thread-a"]), kept: list, before: before), .remove)
check("an alert sent after the list stays", keepDecision(for: push("thread-a", sent: 1_500), kept: list, before: before), .keepSentAfter)
check("an alert sent at the list's own time stays", keepDecision(for: push("thread-a", sent: 1_000), kept: list, before: before), .keepSentAfter)
check("an alert with no send time counts as older", keepDecision(for: push("thread-a", sent: nil), kept: list, before: before), .remove)
check("an untagged alert, its identifier made by iOS, goes",
      keepDecision(for: push("D8341678-62B3-48B2-A0CB-72E7094907EE"), kept: list, before: before), .remove)
check("a notification the app made on the phone stays",
      keepDecision(for: DeliveredNotification(id: "7", fromPush: false, sent: nil, covers: nil), kept: [], before: before), .keepNotFromPush)

let long = String(repeating: "é", count: 40)
check("a tag longer than 64 bytes matches the identifier iOS cut from it",
      keepDecision(for: push(identifierOf(long)), kept: [identifierOf(long)], before: before), .keepOnList(identifierOf(long)))
if identifierOf(long).utf8.count != 64 {
    failures += 1
    print("FAIL: a tag is cut to 64 bytes: got \(identifierOf(long).utf8.count)")
}

// The record of each keep list.
func expect(_ name: String, _ ok: Bool) {
    if ok {
        print("ok: \(name)")
    } else {
        failures += 1
        print("FAIL: \(name)")
    }
}

var outcome = KeepOutcome(delivered: 5)
outcome.count(.remove, id: "thread-a")
outcome.count(.keepOnList("thread-c"), id: "thread-c")
outcome.count(.keepOnList("thread-d"), id: "summary")
outcome.count(.keepSentAfter, id: "thread-e")
outcome.count(.keepNotFromPush, id: "7")
expect("an outcome names what it removed and counts what it kept by reason",
       outcome.removed == ["thread-a"] && outcome.kept == KeptCounts(onList: 2, sentAfter: 1, notFromPush: 1) && outcome.delivered == 5)

func record(at: Double) -> KeepRecord {
    KeepRecord(at: at, source: "keep list", state: "in the background", sent: at - 3, keep: 2, outcome: outcome)
}

let one = record(at: 1_700_000_000_000)
let json = String(decoding: encodeKeepRecords([one]), as: UTF8.self)
expect("a record reads as the page's KeepRecord: \(json)",
       json == #"[{"at":1700000000000,"delivered":5,"keep":2,"kept":{"notFromPush":1,"onList":2,"sentAfter":1},"left":0,"removed":["thread-a"],"sent":1699999999997,"source":"keep list","state":"in the background"}]"#)
expect("a record goes in and comes out the same", decodeKeepRecords(encodeKeepRecords([one])) == [one])

let skipped = KeepRecord(at: 5, source: "keep list", state: "in front", sent: nil, keep: nil, skipped: "no keep list")
let skippedJson = String(decoding: encodeKeepRecords([skipped]), as: UTF8.self)
expect("a push with no list is recorded with why, and no send time or count: \(skippedJson)",
       skippedJson == #"[{"at":5,"delivered":0,"kept":{"notFromPush":0,"onList":0,"sentAfter":0},"left":0,"removed":[],"skipped":"no keep list","source":"keep list","state":"in front"}]"#)

expect("no saved records read as none", decodeKeepRecords(nil).isEmpty)
expect("saved data that does not parse reads as none, so new records still go in", decodeKeepRecords(Data("{".utf8)).isEmpty)

var many: [KeepRecord] = []
for at in 1...60 { many = appendingKeepRecord(many, record(at: 0), now: Double(at)) }
expect("the phone keeps the newest 50, newest last", many.count == 50 && many.first?.at == 11 && many.last?.at == 60)

let read = appendingKeepRecord([], record(at: 0), now: 1_500)
let late = appendingKeepRecord(read, record(at: 0), now: 1_000)
expect("a record saved after another, its removal begun earlier, is stamped after it, so clearing what was read leaves it",
       late.map(\.at) == [1_500, 1_501] && clearingKeepRecords(late, through: read.last!.at).map(\.at) == [1_501])
expect("clearing through a time removes those at or before it", clearingKeepRecords(many, through: 30).map(\.at) == (31...60).map(Double.init))
expect("clearing through 0 removes none", clearingKeepRecords(many, through: 0).count == 50)
expect("clearing through the newest removes all", clearingKeepRecords(many, through: 60).isEmpty)

let full = encodeKeepRecords(many)
expect("records that fit come back whole, with a closing zero byte",
       copyKeepRecords(full, capacity: full.count + 1) == .fits([UInt8](full) + [0]))
expect("records one byte too big say the size they need", copyKeepRecords(full, capacity: full.count) == .needs(full.count + 1))
var wide = KeepOutcome(delivered: 64)
for i in 0..<64 { wide.count(.remove, id: String(repeating: "x", count: 60) + String(format: "%04d", i)) }
var largest: [KeepRecord] = []
for at in 1...50 { largest = appendingKeepRecord(largest, KeepRecord(source: "page", state: "in front", sent: 1, keep: 0, outcome: wide), now: Double(at)) }
let largestSize = encodeKeepRecords(largest).count
expect("fifty records of 64 long removed ids each fit in a megabyte (\(largestSize) bytes)", largestSize < 1_048_576)

exit(failures == 0 ? 0 : 1)
