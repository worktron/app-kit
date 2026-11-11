import Foundation

// The keep list's removal rules (Sources/HandledNotifications.swift), run on the Mac by scripts/gates.sh with bare swiftc,
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

exit(failures == 0 ? 0 : 1)
