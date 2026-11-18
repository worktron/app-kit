import Foundation

// The send rules (Sources/SleepSync.swift), run on the Mac by scripts/gates.sh with bare swiftc, since the plugin's own
// package builds only for iOS against Tauri. Health, the network and the phone's saved state are fakes here.

var failures = 0
func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") {
    if ok {
        print("ok: \(name)")
    } else {
        failures += 1
        print("FAIL: \(name) \(detail())")
    }
}

func sample(_ n: Int) -> SleepSample {
    SleepSample(uuid: "u\(n)", start: Int64(n) * 1000, end: Int64(n) * 1000 + 500, value: "asleepCore", source: "com.apple.health.x", device: "Watch7,1")
}

/// Health as a list of changes, each stretch added or deleted, read after an anchor that is the index of the next one.
final class FakeStore: SleepStore {
    enum Change { case add(SleepSample), delete(String) }
    var changes: [Change] = []
    var locked = false
    var reads = 0
    func read(after anchor: Data?, limit: Int, done: @escaping (SleepRead) -> Void) {
        reads += 1
        if locked { return done(.locked) }
        let from = anchor.map { Int(String(decoding: $0, as: UTF8.self))! } ?? 0
        let slice = changes[min(from, changes.count)..<min(from + limit, changes.count)]
        var samples: [SleepSample] = []
        var deleted: [String] = []
        for change in slice {
            switch change {
            case .add(let s): samples.append(s)
            case .delete(let id): deleted.append(id)
            }
        }
        done(.batch(samples: samples, deleted: deleted, anchor: Data(String(from + slice.count).utf8)))
    }
}

/// The server: answers each request with the next of `answers` (200 when they run out), or holds it until let go.
final class FakeSender: SleepSender {
    var answers: [SendAnswer] = []
    var hold = false
    var held: [() -> Void] = []
    var bodies: [SleepPayload] = []
    /// Signalled once per request, after it is recorded.
    let posted = DispatchSemaphore(value: 0)
    let lock = NSLock()
    func post(_ body: Data, to address: String, done: @escaping (SendAnswer) -> Void) {
        lock.lock()
        bodies.append(try! JSONDecoder().decode(SleepPayload.self, from: body))
        posted.signal()
        let answer = answers.isEmpty ? .status(200) : answers.removeFirst()
        if hold {
            held.append { done(answer) }
            lock.unlock()
        } else {
            lock.unlock()
            done(answer)
        }
    }
    func letGo() {
        lock.lock()
        let waiting = held
        held = []
        lock.unlock()
        for go in waiting { go() }
    }
}

/// The sync's deadline, fired by the test rather than by time.
final class FakeDeadlines {
    var waiting: [() -> Void] = []
    let lock = NSLock()
    func schedule(_ after: Double, _ work: @escaping () -> Void) {
        lock.lock()
        waiting.append(work)
        lock.unlock()
    }
    func fire() {
        lock.lock()
        let due = waiting
        waiting = []
        lock.unlock()
        for work in due { work() }
    }
}

final class FakeKeeping: SleepKeeping {
    var address: String?
    var anchors: (address: String, anchor: Data?)?
    var earlier: [SleepAttempt] = []
    func anchor(for address: String) -> Data? { anchors?.address == address ? anchors?.anchor : nil }
    func setAnchor(_ anchor: Data?, for address: String) { anchors = (address, anchor) }
}

final class FakeWatcher: SleepWatcher {
    var registered = 0
    func register() { registered += 1 }
}

struct Rig {
    let store = FakeStore()
    let sender = FakeSender()
    let keeping = FakeKeeping()
    let watcher = FakeWatcher()
    let deadlines = FakeDeadlines()
    let sync: SleepSync
    init(address: String? = "https://hub.example.com/sleep") {
        keeping.address = address
        var clock: Int64 = 0
        let deadlines = self.deadlines
        sync = SleepSync(store: store, sender: sender, keeping: keeping, watcher: watcher,
                         schedule: { after, work in deadlines.schedule(after, work) },
                         now: { clock += 1; return clock }, log: { _ in })
    }

    /// Run one sync and wait for its answer.
    func run(_ trigger: SleepTrigger = .front, state: String = "coming to the front", dataAvailable: Bool = true) -> SleepResult {
        let done = DispatchSemaphore(value: 0)
        var result: SleepResult?
        sync.sync(trigger, state: state, dataAvailable: dataAvailable) { r in
            result = r
            done.signal()
        }
        if done.wait(timeout: .now() + 10) == .timedOut { return SleepResult(outcome: .nothingNew, samples: -1) }
        return result!
    }

    /// Wait until the coordinator's queue has done what was asked before.
    func settle() {
        let done = DispatchSemaphore(value: 0)
        sync.hasAddress { _ in done.signal() }
        _ = done.wait(timeout: .now() + 10)
    }
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1)), .add(sample(2))]
    rig.sender.answers = [.status(500)]
    let first = rig.run()
    check("a 500 keeps the place in Health's history", first.outcome == .serverRefused && first.status == 500 && rig.keeping.anchor(for: rig.keeping.address!) == nil)
    check("a 500 is kept as an earlier attempt", rig.keeping.earlier.map(\.outcome) == ["server refused"] && rig.keeping.earlier[0].status == 500)
    let second = rig.run()
    check("the same stretches go again after a 500", rig.sender.bodies.count == 2 && rig.sender.bodies[1].samples.map(\.uuid) == ["u1", "u2"])
    check("the next send carries the 500 as earlier", rig.sender.bodies[1].earlier.map(\.outcome) == ["server refused"])
    check("a 200 is sent and clears what was kept", second.outcome == .sent && second.samples == 2 && rig.keeping.earlier.isEmpty)
    let third = rig.run()
    check("after a 200 the next sync posts nothing", third.outcome == .nothingNew && rig.sender.bodies.count == 2)
    let fourth = rig.run()
    check("a further front posts nothing either", fourth.outcome == .nothingNew && rig.sender.bodies.count == 2)
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    rig.sender.answers = [.failed("offline")]
    let first = rig.run()
    check("a network error keeps the place and is kept", first.outcome == .noAnswer && rig.keeping.anchor(for: rig.keeping.address!) == nil && rig.keeping.earlier.map(\.outcome) == ["no answer"])
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    rig.sender.hold = true
    let done = DispatchSemaphore(value: 0)
    var result = SleepResult(outcome: .sent)
    rig.sync.sync(.front, state: "coming to the front", dataAvailable: true) { r in
        result = r
        done.signal()
    }
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    rig.deadlines.fire()
    _ = done.wait(timeout: .now() + 10)
    check("a send with no answer by the deadline ends as no answer", result.outcome == .noAnswer && rig.keeping.earlier.map(\.outcome) == ["no answer"])
    rig.sender.letGo()
    rig.settle()
    check("a 200 that comes after the deadline saves nothing", rig.keeping.anchor(for: rig.keeping.address!) == nil)
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1)), .delete("u0")]
    _ = rig.run()
    check("deleted ids are sent", rig.sender.bodies.first?.deleted == ["u0"] && rig.sender.bodies.first?.samples.map(\.uuid) == ["u1"])
}

do {
    let rig = Rig()
    rig.store.changes = (0..<(batchLimit - 1)).map { .add(sample($0)) } + [.delete("gone")] + (0..<5).map { .add(sample(5000 + $0)) }
    rig.sender.answers = [.status(200), .status(503)]
    let result = rig.run()
    check("a full batch, its deletions counted, is followed by the next", rig.sender.bodies.count == 2 && rig.sender.bodies[0].samples.count + rig.sender.bodies[0].deleted.count == batchLimit)
    check("each batch's place is saved only after its own 200", rig.keeping.anchor(for: rig.keeping.address!) == Data(String(batchLimit).utf8))
    check("the sync says how it ended and what it sent before", result.outcome == .serverRefused && result.samples == batchLimit - 1 && result.deleted == 1)
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    rig.store.locked = true
    let locked = rig.run(.backgroundWake, state: "in the background")
    check("a locked phone posts nothing and keeps one locked attempt", locked.outcome == .locked && rig.sender.bodies.isEmpty && rig.keeping.earlier.map(\.outcome) == ["locked"])
    check("the kept attempt says it was a background wake in the background",
          rig.keeping.earlier.first.map { $0.trigger == "background wake" && $0.state == "in the background" } == true)
    rig.store.locked = false
    let open = rig.run(.open, state: "in front")
    check("the next success carries it as earlier and clears it",
          open.outcome == .sent && rig.sender.bodies.first?.earlier.map(\.outcome) == ["locked"] && rig.keeping.earlier.isEmpty)
    check("each request says its own trigger and state", rig.sender.bodies.first.map { $0.trigger == "open" && $0.state == "in front" } == true)
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    rig.sender.hold = true
    let calls = DispatchSemaphore(value: 0)
    var counts = [0, 0, 0, 0]
    let lock = NSLock()
    for i in 0..<4 {
        rig.sync.sync(.backgroundWake, state: "in the background", dataAvailable: true) { _ in
            lock.lock()
            counts[i] += 1
            lock.unlock()
            calls.signal()
        }
    }
    // The first sync's request is held; its deadline answers the first trigger, and the three that came during it run
    // as one more sync, whose request is held in turn until its own deadline.
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    rig.deadlines.fire()
    _ = calls.wait(timeout: .now() + 10)
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    rig.deadlines.fire()
    for _ in 0..<3 { _ = calls.wait(timeout: .now() + 10) }
    // The held answers come late and are dropped; the queue's next turn comes after them.
    rig.sender.letGo()
    rig.settle()
    rig.deadlines.fire()
    rig.settle()
    check("each of several triggers during a sync, deadlines included, is answered exactly once", counts == [1, 1, 1, 1], "\(counts)")
    check("triggers during a sync run one more sync after it, not one each", rig.sender.bodies.count == 2, "\(rig.sender.bodies.count)")
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    rig.sender.hold = true
    let done = DispatchSemaphore(value: 0)
    rig.sync.sync(.open, state: "in front", dataAvailable: true) { _ in done.signal() }
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    rig.sync.setAddress("https://other.example.com/sleep", dataAvailable: true)
    rig.settle()
    rig.sender.letGo()
    _ = done.wait(timeout: .now() + 5)
    rig.settle()
    check("a send to the old address saves no place for the new one", rig.keeping.address == "https://other.example.com/sleep" && rig.keeping.anchor(for: "https://other.example.com/sleep") == nil)
}

do {
    let rig = Rig()
    rig.store.locked = true
    for _ in 0..<(keptLimit + 5) { _ = rig.run() }
    check("kept attempts stop at \(keptLimit), the oldest dropped", rig.keeping.earlier.count == keptLimit && rig.keeping.earlier.first?.at == 6)
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    _ = rig.run()
    rig.keeping.earlier = [SleepAttempt(at: 1, trigger: "front", state: "coming to the front", outcome: "locked", status: nil)]
    rig.sync.setAddress("https://other.example.com/sleep", dataAvailable: true)
    rig.settle()
    check("a new address starts the history over and drops what was kept", rig.keeping.anchor(for: "https://other.example.com/sleep") == nil && rig.keeping.earlier.isEmpty)
    _ = rig.run()
    check("the new address gets everything", rig.sender.bodies.last?.samples.map(\.uuid) == ["u1"] && rig.sender.bodies.count == 2)
    rig.sync.setAddress("https://other.example.com/sleep", dataAvailable: true)
    rig.settle()
    check("the same address again keeps its place", rig.keeping.anchor(for: "https://other.example.com/sleep") != nil)
}

do {
    let rig = Rig(address: nil)
    rig.sync.watchIfReady(dataAvailable: true)
    rig.settle()
    check("with no address nothing is watched", rig.watcher.registered == 0)
    check("with no address a sync ends at once", rig.run().outcome == .noAddress)
    rig.sync.setAddress("https://hub.example.com/sleep", dataAvailable: true)
    rig.settle()
    check("the page's start with no earlier address registers the watcher", rig.watcher.registered == 1)
    rig.sync.watchIfReady(dataAvailable: true)
    rig.settle()
    check("the watcher is registered once per process", rig.watcher.registered == 1)
}

do {
    let rig = Rig()
    rig.sync.watchIfReady(dataAvailable: false)
    rig.settle()
    check("before the first unlock nothing is watched", rig.watcher.registered == 0)
    rig.store.locked = true
    let result = rig.run(dataAvailable: false)
    check("before the first unlock a sync reads nothing and keeps nothing", result.outcome == .notUnlocked && rig.store.reads == 0 && rig.keeping.earlier.isEmpty)
    rig.sync.setAddress("https://other.example.com/sleep", dataAvailable: false)
    rig.settle()
    check("before the first unlock the address is not replaced", rig.keeping.address == "https://hub.example.com/sleep")
    rig.sync.watchIfReady(dataAvailable: true)
    rig.settle()
    check("the first unlock registers the watcher", rig.watcher.registered == 1)
}

do {
    let body = try! JSONEncoder().encode(SleepPayload(trigger: "open", state: "in front",
        samples: [SleepSample(uuid: "a", start: 1_763_430_000_000, end: 1_763_431_800_000, value: "awake", source: "com.example", device: nil)],
        deleted: [], earlier: [SleepAttempt(at: 5, trigger: "front", state: "in front", outcome: "no answer", status: nil)]))
    let json = String(decoding: body, as: UTF8.self)
    check("a stretch with no device sends null, not nothing", json.contains("\"device\":null"), json)
    check("an attempt with no status sends null", json.contains("\"status\":null"), json)
    check("times are whole milliseconds", json.contains("\"start\":1763430000000"), json)
}

if failures > 0 {
    print("\(failures) failed")
    exit(1)
}
print("all passed")
