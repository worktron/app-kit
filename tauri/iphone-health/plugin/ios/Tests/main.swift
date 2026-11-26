import Foundation

// The send rules (Sources/HealthSync.swift), run on the Mac by scripts/gates.sh with bare swiftc, since the plugin's own
// package builds only for iOS against Tauri. Health, the network and the phone's saved state are fakes here. The sleep
// checks come first, then heart rate's.

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

/// Health's sleep as a list of changes, each stretch added or deleted, read after an anchor that is the index of the
/// next one.
final class FakeStore: HealthStore {
    enum Change { case add(SleepSample), delete(String) }
    var changes: [Change] = []
    var locked = false
    var reads = 0
    func read(after anchor: Data?, limit: Int, done: @escaping (HealthRead<SleepSample>) -> Void) {
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
        done(.batch(samples: samples, deleted: deleted, anchor: Data(String(from + slice.count).utf8),
                    more: filledLimit(samples: samples.count, deleted: deleted.count, limit: limit)))
    }
}

/// Health's heart rate as a list of changes, each a sample added (one reading, or a condensed series with its readings)
/// or deleted, read through the plugin's own `readHeartRate`, as the phone's store reads Health.
final class FakeHeartRateStore: HealthStore {
    enum Change { case add(HeartRateObject, [SeriesReading]), delete(String) }
    var changes: [Change] = []
    var locked = false
    var seriesFails = false
    var reads = 0
    /// The limits Health was asked with, in order, the smaller reads included.
    var limits: [Int] = []
    func read(after anchor: Data?, limit: Int, done: @escaping (HealthRead<HeartRateSample>) -> Void) {
        reads += 1
        let from = anchor.map { Int(String(decoding: $0, as: UTF8.self))! } ?? 0
        let changes = self.changes
        readHeartRate(limit: limit, cap: limit, query: { limit, answer in
            self.limits.append(limit)
            if self.locked { return answer(.locked) }
            let slice = changes[min(from, changes.count)..<min(from + limit, changes.count)]
            var objects: [HeartRateObject] = []
            var deleted: [String] = []
            for change in slice {
                switch change {
                case .add(let object, _): objects.append(object)
                case .delete(let id): deleted.append(id)
                }
            }
            answer(.value(HeartRateRead(objects: objects, deleted: deleted, anchor: Data(String(from + slice.count).utf8))))
        }, series: { uuids, answer in
            if self.seriesFails { return answer(.failed("the series could not be read")) }
            var readings: [String: [SeriesReading]] = [:]
            for case let .add(object, values) in changes where uuids.contains(object.uuid) { readings[object.uuid] = values }
            answer(.value(readings))
        }, done: done)
    }
}

func reading(_ n: Int) -> HeartRateObject {
    HeartRateObject(uuid: "r\(n)", count: 1, start: Int64(n) * 1000, end: Int64(n) * 1000, bpm: 50 + Double(n), source: "com.apple.health.x", device: "Watch7,1")
}

/// A condensed series of `count` readings, one second apart from `from`, as Health makes it: the iPhone as its device.
func series(_ uuid: String, from: Int, count: Int) -> (HeartRateObject, [SeriesReading]) {
    let values = (0..<count).map { SeriesReading(start: Int64(from + $0) * 1000, end: Int64(from + $0) * 1000 + 1000, bpm: 50 + Double(from + $0)) }
    return (HeartRateObject(uuid: uuid, count: count, start: values.first!.start, end: values.last!.end, bpm: 60, source: "com.apple.health.x", device: "iPhone12,1"), values)
}

/// The server: answers each request with the next of `answers` (200 when they run out), or holds it until let go.
final class FakeSender<Sample: Codable & Equatable>: HealthSender {
    var answers: [SendAnswer] = []
    var hold = false
    var held: [() -> Void] = []
    var bodies: [HealthPayload<Sample>] = []
    /// Signalled once per request, after it is recorded.
    let posted = DispatchSemaphore(value: 0)
    let lock = NSLock()
    func post(_ body: Data, to address: String, done: @escaping (SendAnswer) -> Void) {
        lock.lock()
        bodies.append(try! JSONDecoder().decode(HealthPayload<Sample>.self, from: body))
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

final class FakeKeeping: HealthKeeping {
    var address: String?
    var anchors: (address: String, anchor: Data?)?
    var earlier: [HealthAttempt] = []
    func anchor(for address: String) -> Data? { anchors?.address == address ? anchors?.anchor : nil }
    func setAnchor(_ anchor: Data?, for address: String) { anchors = (address, anchor) }
}

final class FakeWatcher: HealthWatcher {
    var registered = 0
    func register() { registered += 1 }
}

struct Rig<Store: HealthStore> {
    let store: Store
    let sender = FakeSender<Store.Sample>()
    let keeping = FakeKeeping()
    let watcher = FakeWatcher()
    let deadlines = FakeDeadlines()
    let sync: HealthSync<Store>
    init(store: Store, address: String?, batch: Int, words: HealthWords) {
        self.store = store
        keeping.address = address
        var clock: Int64 = 0
        let deadlines = self.deadlines
        sync = HealthSync(store: store, sender: sender, keeping: keeping, watcher: watcher, batch: batch, words: words,
                          schedule: { after, work in deadlines.schedule(after, work) },
                          now: { clock += 1; return clock }, log: { _ in })
    }

    /// Run one sync and wait for its answer.
    func run(_ trigger: HealthTrigger = .front, state: String = "coming to the front", dataAvailable: Bool = true) -> HealthResult {
        let done = DispatchSemaphore(value: 0)
        var result: HealthResult?
        sync.sync(trigger, state: state, dataAvailable: dataAvailable) { r in
            result = r
            done.signal()
        }
        if done.wait(timeout: .now() + 10) == .timedOut { return HealthResult(outcome: .nothingNew, samples: -1) }
        return result!
    }

    /// Wait until the coordinator's queue has done what was asked before.
    func settle() {
        let done = DispatchSemaphore(value: 0)
        sync.hasAddress { _ in done.signal() }
        _ = done.wait(timeout: .now() + 10)
    }
}

extension Rig where Store == FakeStore {
    init(address: String? = "https://hub.example.com/sleep") {
        self.init(store: FakeStore(), address: address, batch: batchLimit, words: .sleep)
    }
}

extension Rig where Store == FakeHeartRateStore {
    init(heartRate address: String? = "https://hub.example.com/heart-rate", batch: Int = heartRateBatchLimit) {
        self.init(store: FakeHeartRateStore(), address: address, batch: batch, words: .heartRate)
    }
}

/// The README's keeping rule, as a server holds it: each reading by its uuid and index, and a deleted uuid removes
/// every reading under it.
final class HeldReadings {
    var held: [String: HeartRateSample] = [:]
    func take(_ body: HealthPayload<HeartRateSample>) {
        let gone = Set(body.deleted)
        held = held.filter { !gone.contains($0.value.uuid) }
        for sample in body.samples { held["\(sample.uuid)#\(sample.index)"] = sample }
    }
    var beats: [Int64] { held.values.map(\.start).sorted() }
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
    var result = HealthResult(outcome: .sent)
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
    rig.store.changes = [.add(sample(1))]
    rig.sender.answers = [.status(500)]
    rig.sender.hold = true
    let done = DispatchSemaphore(value: 0)
    rig.sync.sync(.open, state: "in front", dataAvailable: true) { _ in done.signal() }
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    rig.sync.setAddress("https://other.example.com/sleep", dataAvailable: true)
    rig.settle()
    rig.sender.letGo()
    _ = done.wait(timeout: .now() + 5)
    rig.settle()
    check("a send the old address refused is not kept for the new one", rig.keeping.earlier.isEmpty, "\(rig.keeping.earlier.map(\.outcome))")
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
    rig.keeping.earlier = [HealthAttempt(at: 1, trigger: "front", state: "coming to the front", outcome: "locked", status: nil)]
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
    rig.sync.watchIfReady(dataAvailable: true, answered: true)
    rig.settle()
    check("with no address nothing is watched", rig.watcher.registered == 0)
    check("with no address a sync ends at once", rig.run().outcome == .noAddress)
    rig.sync.setAddress("https://hub.example.com/sleep", dataAvailable: true)
    rig.settle()
    check("the page's start with no earlier address registers the watcher", rig.watcher.registered == 1)
    rig.sync.watchIfReady(dataAvailable: true, answered: true)
    rig.settle()
    check("the watcher is registered once per process", rig.watcher.registered == 1)
}

do {
    let rig = Rig()
    rig.sync.watchIfReady(dataAvailable: false, answered: true)
    rig.settle()
    check("before the first unlock nothing is watched", rig.watcher.registered == 0)
    rig.store.locked = true
    let result = rig.run(dataAvailable: false)
    check("before the first unlock a sync reads nothing and keeps nothing", result.outcome == .notUnlocked && rig.store.reads == 0 && rig.keeping.earlier.isEmpty)
    rig.sync.setAddress("https://other.example.com/sleep", dataAvailable: false)
    rig.settle()
    check("before the first unlock the address is not replaced", rig.keeping.address == "https://hub.example.com/sleep")
    rig.sync.watchIfReady(dataAvailable: true, answered: true)
    rig.settle()
    check("the first unlock registers the watcher", rig.watcher.registered == 1)
}

do {
    let rig = Rig()
    rig.sync.watchIfReady(dataAvailable: true, answered: false)
    rig.settle()
    check("before Health's question is answered nothing is watched", rig.watcher.registered == 0)
    rig.sync.setAddress("https://hub.example.com/sleep", dataAvailable: true)
    rig.settle()
    check("the page's start after the answer registers the watcher", rig.watcher.registered == 1)
}

do {
    let questions = OneQuestionAtATime()
    let firstUp = DispatchSemaphore(value: 0)
    let answerFirst = DispatchSemaphore(value: 0)
    let secondDone = DispatchSemaphore(value: 0)
    let secondWaiting = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var order: [String] = []
    var waited = false
    func note(_ line: String) { lock.lock(); order.append(line); lock.unlock() }
    DispatchQueue.global().async {
        questions.ask({ note("first asked"); firstUp.signal(); answerFirst.wait(); note("first answered") }, waiting: {})
    }
    firstUp.wait()
    DispatchQueue.global().async {
        questions.ask({ note("second asked") }, waiting: { lock.lock(); waited = true; lock.unlock(); secondWaiting.signal() })
        secondDone.signal()
    }
    // The second question has said it waits, the fact that comes before it could be asked; only then is its order read.
    let reachedWait = secondWaiting.wait(timeout: .now() + 5)
    lock.lock(); let beforeAnswer = order; lock.unlock()
    check("a second Health question waits for the first's answer", reachedWait == .success && beforeAnswer == ["first asked"])
    answerFirst.signal()
    _ = secondDone.wait(timeout: .now() + 5)
    check("the second question is asked once the first is answered, and says it waited", order == ["first asked", "first answered", "second asked"] && waited)
}

do {
    let body = try! JSONEncoder().encode(HealthPayload<SleepSample>(trigger: "open", state: "in front",
        samples: [SleepSample(uuid: "a", start: 1_763_430_000_000, end: 1_763_431_800_000, value: "awake", source: "com.example", device: nil)],
        deleted: [], earlier: [HealthAttempt(at: 5, trigger: "front", state: "in front", outcome: "no answer", status: nil)]))
    let json = String(decoding: body, as: UTF8.self)
    check("a stretch with no device sends null, not nothing", json.contains("\"device\":null"), json)
    check("an attempt with no status sends null", json.contains("\"status\":null"), json)
    check("times are whole milliseconds", json.contains("\"start\":1763430000000"), json)
}

do {
    check("an unlocked phone has been unlocked since it started", unlockedSinceRestart(protectedDataAvailable: true) { false })
    check("a locked phone whose kept file still reads was unlocked since it started, so its wake reads Health and is kept as locked",
          unlockedSinceRestart(protectedDataAvailable: false) { true })
    check("a locked phone whose kept file does not read has not been unlocked since it started",
          !unlockedSinceRestart(protectedDataAvailable: false) { false })
}

do {
    let rig = Rig()
    rig.store.changes = [.add(sample(1))]
    rig.sender.hold = true
    let first = DispatchSemaphore(value: 0)
    let second = DispatchSemaphore(value: 0)
    var secondResult: HealthResult?
    rig.sync.sync(.backgroundWake, state: "in the background", dataAvailable: true) { _ in first.signal() }
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    rig.sync.sync(.backgroundWake, state: "in the background", dataAvailable: true) { r in
        secondResult = r
        second.signal()
    }
    rig.settle()
    // Both callers' deadlines and the running sync's come due together: the waiting wake is answered then, not after
    // the sync it waits for has had a deadline of its own.
    rig.deadlines.fire()
    _ = first.wait(timeout: .now() + 10)
    let answered = second.wait(timeout: .now() + 10) == .success
    check("a wake waiting on a stalled send is answered within its own deadline", answered && secondResult?.outcome == .noAnswer)
    _ = rig.sender.posted.wait(timeout: .now() + 10)
    check("the sync it waited for still runs after", rig.sender.bodies.count == 2)
    rig.sender.letGo()
    rig.deadlines.fire()
    rig.settle()
}

// MARK: - Heart rate

do {
    // An app upgraded from sleep alone: sleep's question was answered long ago, heart rate's is still to ask.
    let sleep = Rig()
    let heart = Rig(heartRate: nil)
    sleep.sync.watchIfReady(dataAvailable: true, answered: true)
    heart.sync.watchIfReady(dataAvailable: true, answered: false)
    sleep.settle()
    heart.settle()
    check("sleep answered, heart rate not yet asked: sleep's watcher registers", sleep.watcher.registered == 1)
    check("sleep answered, heart rate not yet asked: heart rate's does not", heart.watcher.registered == 0)
    let result = heart.run(.open, state: "in front")
    check("sleep answered, heart rate not yet asked: heart rate reads nothing and keeps nothing",
          result.outcome == .noAddress && heart.store.reads == 0 && heart.keeping.earlier.isEmpty)
    // The page's start asks heart rate's question, then saves its address.
    heart.sync.setAddress("https://hub.example.com/heart-rate", dataAvailable: true)
    heart.settle()
    check("sleep answered, heart rate not yet asked: the start's answer registers heart rate's watcher", heart.watcher.registered == 1)
    check("sleep answered, heart rate not yet asked: sleep's watcher is not registered twice", sleep.watcher.registered == 1)
}

do {
    // A heart-rate address kept from before, with heart rate's question still to ask, as after Health's permissions
    // were reset: nothing is watched until it is answered, whatever sleep's answer.
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    heart.sync.watchIfReady(dataAvailable: true, answered: false)
    heart.settle()
    check("a kept heart-rate address with its question unanswered watches nothing", heart.watcher.registered == 0)
    heart.sync.watchIfReady(dataAvailable: true, answered: true)
    heart.settle()
    check("once heart rate's question is answered its watcher registers", heart.watcher.registered == 1)
}

do {
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    let server = HeldReadings()
    heart.store.changes = (1...3).map { .add(reading($0), []) }
    _ = heart.run()
    heart.sender.bodies.forEach(server.take)
    check("single readings are sent as themselves", heart.sender.bodies.first?.samples.map { "\($0.uuid)#\($0.index)#\($0.series)" } == ["r1#0#false", "r2#0#false", "r3#0#false"])
    // Months later Health condenses the three into one series and deletes them.
    let (condensed, values) = series("s1", from: 1, count: 3)
    heart.store.changes += [.delete("r1"), .delete("r2"), .delete("r3"), .add(condensed, values)]
    _ = heart.run()
    let second = heart.sender.bodies.last!
    server.take(second)
    check("a condensed series replacing its originals deletes the originals", second.deleted == ["r1", "r2", "r3"])
    check("a condensed series replacing its originals sends its readings under new keys",
          second.samples.map { "\($0.uuid)#\($0.index)#\($0.series)" } == ["s1#0#true", "s1#1#true", "s1#2#true"])
    check("a condensed series replacing its originals keeps every reading once", server.beats == [1000, 2000, 3000] && server.held.count == 3, "\(server.held.keys.sorted())")
    // Health may condense more than once: the first series goes and a new one takes its place.
    let (again, againValues) = series("s2", from: 1, count: 3)
    heart.store.changes += [.delete("s1"), .add(again, againValues)]
    _ = heart.run()
    server.take(heart.sender.bodies.last!)
    check("a second condensation replaces the first series and keeps every reading once",
          server.beats == [1000, 2000, 3000] && Set(server.held.values.map(\.uuid)) == ["s2"])
}

do {
    // Reads of at most 8 readings: a read whose series hold more is read again with half the limit, down to one.
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate", batch: 8)
    let counts = [1, 1, 1, 5, 5, 1, 1, 1]
    heart.store.changes = counts.enumerated().map { n, count in
        count == 1 ? .add(reading(n * 100), []) : { let (o, v) = series("s\(n)", from: n * 100, count: count); return .add(o, v) }()
    }
    let result = heart.run()
    check("a read past its readings is halved until it fits", heart.store.limits == [8, 4, 8], "\(heart.store.limits)")
    check("each request carries at most the batch of readings", heart.sender.bodies.map(\.samples.count) == [8, 8], "\(heart.sender.bodies.map(\.samples.count))")
    check("a read that fills its limit is followed by the next, one that does not ends", result.outcome == .sent && result.samples == 16 && heart.sender.bodies.count == 2)
}

do {
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate", batch: 8)
    let (long, values) = series("long", from: 0, count: 20)
    heart.store.changes = [.add(long, values), .add(reading(50), [])]
    _ = heart.run()
    check("one series longer than a request goes whole, alone", heart.store.limits == [8, 4, 2, 1, 8] && heart.sender.bodies.map(\.samples.count) == [20, 1], "\(heart.store.limits) \(heart.sender.bodies.map(\.samples.count))")
}

do {
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    let (condensed, values) = series("s1", from: 1, count: 3)
    heart.store.changes = [.add(condensed, values)]
    heart.store.seriesFails = true
    let failed = heart.run()
    check("a series query that fails fails the read, keeps the place and is kept",
          failed.outcome == .readFailed && heart.sender.bodies.isEmpty && heart.keeping.anchor(for: heart.keeping.address!) == nil && heart.keeping.earlier.map(\.outcome) == ["read failed"])
    heart.store.seriesFails = false
    let sent = heart.run()
    check("the next read sends the series and carries the failure", sent.outcome == .sent && sent.samples == 3 && heart.sender.bodies.first?.earlier.map(\.outcome) == ["read failed"])
}

do {
    let (condensed, _) = series("empty", from: 1, count: 4)
    let samples = heartRateSamples([condensed, reading(9)], series: [:])
    check("a series the query gave no readings for makes no readings of its own", samples.map(\.uuid) == ["r9"])
}

do {
    // Health says the series holds 4 readings but its query gives 2, as when Health deletes it between the two queries.
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    let (condensed, values) = series("s1", from: 1, count: 4)
    heart.store.changes = [.add(reading(0), []), .add(condensed, Array(values.prefix(2)))]
    let short = heart.run()
    check("a series that gives fewer readings than its count fails the read and keeps its place",
          short.outcome == .readFailed && heart.sender.bodies.isEmpty && heart.keeping.anchor(for: heart.keeping.address!) == nil && heart.keeping.earlier.map(\.outcome) == ["read failed"])
    // Read again once Health has deleted it: its deletion comes in place of the short series, and nothing is skipped.
    heart.store.changes = [.add(reading(0), []), .delete("s1")]
    let again = heart.run()
    check("the next read sends what it holds and the series' deletion",
          again.outcome == .sent && heart.sender.bodies.first?.samples.map(\.uuid) == ["r0"] && heart.sender.bodies.first?.deleted == ["s1"])
}

do {
    let sleep = Rig()
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    sleep.store.changes = [.add(sample(1))]
    heart.store.changes = [.add(reading(1), [])]
    heart.store.locked = true
    let sleepResult = sleep.run(.backgroundWake, state: "in the background")
    let heartResult = heart.run(.backgroundWake, state: "in the background")
    check("a heart-rate failure is kept in heart rate's list and not sleep's",
          heartResult.outcome == .locked && heart.keeping.earlier.map(\.outcome) == ["locked"] && sleepResult.outcome == .sent && sleep.keeping.earlier.isEmpty)
}

do {
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    heart.sync.watchIfReady(dataAvailable: true, answered: true)
    heart.store.changes = [.add(reading(1), [])]
    _ = heart.run()
    heart.keeping.earlier = [HealthAttempt(at: 1, trigger: "background wake", state: "in the background", outcome: "locked", status: nil)]
    let cleared = DispatchSemaphore(value: 0)
    var had = false
    heart.sync.clearAddress(dataAvailable: true) { h in had = h; cleared.signal() }
    _ = cleared.wait(timeout: .now() + 10)
    heart.store.changes.append(.add(reading(2), []))
    let result = heart.run()
    check("a start without a heart-rate address stops heart rate's sends",
          had && result.outcome == .noAddress && heart.sender.bodies.count == 1 && heart.keeping.address == nil && heart.keeping.earlier.isEmpty)
    check("the watcher was registered once before", heart.watcher.registered == 1)
    heart.sync.setAddress("https://hub.example.com/heart-rate", dataAvailable: true)
    heart.settle()
    _ = heart.run()
    check("given again, the address starts heart rate's history over", heart.sender.bodies.last?.samples.map(\.uuid) == ["r1", "r2"])
    check("given again, the address registers the watcher again, which turns iOS's wakes back on",
          heart.watcher.registered == 2, "\(heart.watcher.registered)")
    heart.sync.watchIfReady(dataAvailable: true, answered: true)
    heart.settle()
    check("and only once", heart.watcher.registered == 2)
}

do {
    let heart = Rig(heartRate: "https://hub.example.com/heart-rate")
    heart.store.changes = [.add(reading(1), [])]
    let cleared = DispatchSemaphore(value: 0)
    var had = true
    heart.sync.clearAddress(dataAvailable: false) { h in had = h; cleared.signal() }
    _ = cleared.wait(timeout: .now() + 10)
    check("before the first unlock the heart-rate address is not cleared", !had && heart.keeping.address == "https://hub.example.com/heart-rate")
}

do {
    let body = try! JSONEncoder().encode(HealthPayload(trigger: "open", state: "in front",
        samples: [HeartRateSample(uuid: "a", index: 0, start: 1_763_430_000_000, end: 1_763_430_000_000, bpm: 58, series: false, source: "com.example", device: nil)],
        deleted: [], earlier: []))
    let json = String(decoding: body, as: UTF8.self)
    check("a reading with no device sends null, not nothing", json.contains("\"device\":null"), json)
    check("a reading says whether it came from a series", json.contains("\"series\":false"), json)
    check("beats per minute is a number", json.contains("\"bpm\":58"), json)
}

do {
    check("a read that fits needs no smaller one", nextLimit(limit: 5000, total: 5000, cap: 5000) == nil)
    check("a read past its cap is halved", nextLimit(limit: 5000, total: 5001, cap: 5000) == 2500)
    check("a read of one object is never made smaller", nextLimit(limit: 1, total: 9000, cap: 5000) == nil)
}

if failures > 0 {
    print("\(failures) failed")
    exit(1)
}
print("all passed")
