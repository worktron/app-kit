import Foundation

// When and what the plugin sends to the app's server, apart from HealthKit and UIKit so `Tests/main.swift` runs it on
// the Mac with bare swiftc. IphoneHealthPlugin.swift gives it Health's sleep through `SleepStore`, the network through
// `SleepSender`, the phone's saved state through `SleepKeeping`, and the Health watcher through `SleepWatcher`.

/// The UserDefaults keys the plugin saves under (`KEYS` in tauri/iphone-health/names.ts).
let addressKey = "app-kit.iphone-health.address"
let anchorKey = "app-kit.iphone-health.anchor"
let earlierKey = "app-kit.iphone-health.earlier"

/// How many attempts that delivered nothing the phone keeps for the next send. The oldest goes first.
let keptLimit = 50

/// How many stretches and deletions one request carries at most.
let batchLimit = 1000

/// How long a sync may take before it ends as `no answer`, in seconds, unless iOS ends it sooner.
let syncDeadline = 25.0

/// Whether the phone has been unlocked since it started, before which the saved state reads as empty and must not be
/// written. iOS's `isProtectedDataAvailable` is false whenever the phone is locked, so it alone would call every locked
/// night "not unlocked"; after the first unlock a file kept until then still reads, which `markerReads` asks.
func unlockedSinceRestart(protectedDataAvailable: Bool, markerReads: () -> Bool) -> Bool {
    protectedDataAvailable || markerReads()
}

/// What started a sync (`TRIGGERS` in names.ts).
enum SleepTrigger: String, Codable {
    case open = "open"
    case front = "front"
    case backgroundWake = "background wake"
}

/// One sleep stretch as the server gets it.
struct SleepSample: Codable, Equatable {
    let uuid: String
    /// Milliseconds since 1970.
    let start: Int64
    let end: Int64
    /// Apple's case name: inBed, asleepUnspecified, asleepCore, asleepDeep, asleepREM or awake.
    let value: String
    /// The bundle id of the app that wrote it; the Watch's own sleep is `com.apple.health.<uuid>`.
    let source: String
    /// The device that wrote it, such as `Watch7,1`, or null when Health does not say.
    let device: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(uuid, forKey: .uuid)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(value, forKey: .value)
        try c.encode(source, forKey: .source)
        try c.encode(device, forKey: .device)
    }
}

/// A sync that delivered nothing, kept until a send succeeds and carried as `earlier`.
struct SleepAttempt: Codable, Equatable {
    /// When it ended, in milliseconds since 1970 on the phone's clock.
    let at: Int64
    let trigger: String
    let state: String
    /// `locked`, `server refused`, `no answer` or `read failed` (`KEPT_OUTCOMES` in names.ts).
    let outcome: String
    /// The server's answer, for `server refused`.
    let status: Int?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(at, forKey: .at)
        try c.encode(trigger, forKey: .trigger)
        try c.encode(state, forKey: .state)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(status, forKey: .status)
    }
}

/// What one request carries.
struct SleepPayload: Codable, Equatable {
    let trigger: String
    let state: String
    let samples: [SleepSample]
    let deleted: [String]
    let earlier: [SleepAttempt]
}

/// What one read of Health gave.
enum SleepRead {
    /// Stretches and deletions after the anchor, with the anchor that follows them, archived.
    case batch(samples: [SleepSample], deleted: [String], anchor: Data?)
    /// Health cannot be read while the phone is locked.
    case locked
    case failed(String)
}

/// How a sync ended (`OUTCOMES` in names.ts).
enum SleepOutcome: String {
    case sent = "sent"
    case nothingNew = "nothing new"
    case locked = "locked"
    case serverRefused = "server refused"
    case noAnswer = "no answer"
    case readFailed = "read failed"
    case noAddress = "no address"
    case notUnlocked = "not unlocked since restart"

    /// Whether the attempt is kept for the next send: it delivered nothing the server should hear about.
    var kept: Bool {
        switch self {
        case .locked, .serverRefused, .noAnswer, .readFailed: return true
        default: return false
        }
    }
}

/// What a caller hears when its sync ends.
struct SleepResult: Equatable {
    var outcome: SleepOutcome
    var samples = 0
    var deleted = 0
    var status: Int?
}

enum SendAnswer {
    case status(Int)
    case failed(String)
}

protocol SleepStore {
    /// Read up to `limit` stretches after `anchor` (none: from the start), calling `done` once, on any thread.
    func read(after anchor: Data?, limit: Int, done: @escaping (SleepRead) -> Void)
}

protocol SleepSender {
    /// POST `body` as JSON to `address`, calling `done` once, on any thread.
    func post(_ body: Data, to address: String, done: @escaping (SendAnswer) -> Void)
}

/// The phone's saved state. Called only on the coordinator's queue.
protocol SleepKeeping: AnyObject {
    var address: String? { get set }
    /// The anchor saved for `address`, or none when the saved one belongs to another address.
    func anchor(for address: String) -> Data?
    func setAnchor(_ anchor: Data?, for address: String)
    var earlier: [SleepAttempt] { get set }
}

protocol SleepWatcher {
    /// Register Health's watcher and ask iOS to wake the app for new sleep. Called at most once per process.
    func register()
}

/// Runs one sync at a time. A trigger that comes during a sync runs one more after it, and every caller's completion is
/// called exactly once, whatever happens: iOS stops waking an app whose wakes go unanswered three times.
final class SleepSync {
    private let store: SleepStore
    private let sender: SleepSender
    private let keeping: SleepKeeping
    private let watcher: SleepWatcher
    private let now: () -> Int64
    private let log: (String) -> Void
    private let deadline: Double
    private let schedule: (Double, @escaping () -> Void) -> Void
    private let queue = DispatchQueue(label: "app-kit.iphone-health.sync")

    private var running = false
    /// Each sync's number, so an answer that comes after its sync ended is dropped.
    private var generation = 0
    /// A caller waiting for its answer, with a number so its own deadline can find it.
    private struct Waiting {
        let id: Int
        let answer: (SleepResult) -> Void
    }
    private var callers = 0
    private var current: (trigger: SleepTrigger, state: String, waiting: [Waiting])?
    private var progress = SleepResult(outcome: .nothingNew)
    /// The address the running sync reads for, so a failure is kept only while that address is still the saved one.
    private var runAddress: String?
    private var next: (trigger: SleepTrigger, state: String, dataAvailable: Bool, waiting: [Waiting])?
    private var watching = false

    init(store: SleepStore, sender: SleepSender, keeping: SleepKeeping, watcher: SleepWatcher,
         deadline: Double = syncDeadline,
         schedule: @escaping (Double, @escaping () -> Void) -> Void = { after, work in DispatchQueue.global().asyncAfter(deadline: .now() + after, execute: work) },
         now: @escaping () -> Int64, log: @escaping (String) -> Void) {
        self.store = store
        self.sender = sender
        self.keeping = keeping
        self.watcher = watcher
        self.deadline = deadline
        self.schedule = schedule
        self.now = now
        self.log = log
    }

    /// Save the address the page gives. A new address starts the history over and drops what was kept for the old one,
    /// and a sync still sending to the old one saves nothing. Then the watcher is registered, if it is not yet.
    func setAddress(_ address: String, dataAvailable: Bool, done: @escaping () -> Void = {}) {
        queue.async {
            guard dataAvailable else {
                self.log("the address was not saved: the phone has not been unlocked since it started")
                done()
                return
            }
            if self.keeping.address != address {
                self.log(self.keeping.address == nil ? "sending to \(address)" : "sending to \(address) from now on, from the start of Health's history")
                self.keeping.address = address
                self.keeping.setAnchor(nil, for: address)
                self.keeping.earlier = []
            }
            // Only the page's start saves an address, once its Health question is answered.
            self.watchOnQueue(dataAvailable: true, answered: true)
            done()
        }
    }

    /// Register the watcher once an address is saved, the saved state can be read and Health's question has been answered:
    /// at plugin start, after the page's start, at the first unlock after a restart and as the app comes to the front.
    /// A watcher registered before the answer fails and never runs again in that process, so `answered` false waits.
    func watchIfReady(dataAvailable: Bool, answered: Bool) {
        queue.async { self.watchOnQueue(dataAvailable: dataAvailable, answered: answered) }
    }

    private func watchOnQueue(dataAvailable: Bool, answered: Bool) {
        guard !watching, dataAvailable, answered, keeping.address != nil else { return }
        watching = true
        log("watching Health for new sleep")
        watcher.register()
    }

    /// Whether an address is saved. Answers on the coordinator's queue.
    func hasAddress(_ answer: @escaping (Bool) -> Void) {
        queue.async { answer(self.keeping.address != nil) }
    }

    /// Send what is new. `state` is the app's state when the trigger came; `dataAvailable` whether the phone has been
    /// unlocked since it started, before which the saved state reads as empty and must not be written.
    /// Each caller is answered within the deadline from its own arrival, even one that waits for a sync to end before
    /// its own runs, since iOS gives a wake only so long.
    func sync(_ trigger: SleepTrigger, state: String, dataAvailable: Bool, completion: @escaping (SleepResult) -> Void) {
        queue.async {
            self.callers += 1
            let caller = Waiting(id: self.callers, answer: completion)
            if self.running {
                // A caller that starts a sync is answered by that sync's deadline; one that waits gets its own.
                self.schedule(self.deadline) { self.queue.async { self.answerLate(caller.id, trigger) } }
                if self.next == nil {
                    self.next = (trigger, state, dataAvailable, [caller])
                } else {
                    self.next!.waiting.append(caller)
                }
                self.log("\(trigger.rawValue): a sync is running, so this one runs after it")
                return
            }
            self.start(trigger, state: state, dataAvailable: dataAvailable, waiting: [caller])
        }
    }

    /// Answer a caller whose deadline came while it still waited, as `no answer`. The sync it waited on goes on, and
    /// one still to run still runs.
    private func answerLate(_ id: Int, _ trigger: SleepTrigger) {
        if let at = current?.waiting.firstIndex(where: { $0.id == id }) {
            let caller = current!.waiting.remove(at: at)
            log("\(trigger.rawValue): answered at its deadline while the sync goes on")
            caller.answer(SleepResult(outcome: .noAnswer))
        } else if let at = next?.waiting.firstIndex(where: { $0.id == id }) {
            let caller = next!.waiting.remove(at: at)
            log("\(trigger.rawValue): answered at its deadline while it waited for the sync before it")
            caller.answer(SleepResult(outcome: .noAnswer))
        }
    }

    /// End the running sync now, as iOS takes the app's time away: it ends as `no answer` and is kept.
    func expire() {
        queue.async {
            guard self.running else { return }
            self.log("iOS ended the app's time before the sync finished")
            self.end(.noAnswer, status: nil)
        }
    }

    private func start(_ trigger: SleepTrigger, state: String, dataAvailable: Bool, waiting: [Waiting]) {
        running = true
        generation += 1
        current = (trigger, state, waiting)
        progress = SleepResult(outcome: .nothingNew)
        runAddress = nil
        guard dataAvailable else {
            end(.notUnlocked, status: nil)
            return
        }
        guard let address = keeping.address else {
            end(.noAddress, status: nil)
            return
        }
        runAddress = address
        let run = generation
        schedule(deadline) {
            self.queue.async {
                guard self.running, self.generation == run else { return }
                self.log("\(trigger.rawValue): no answer in \(Int(self.deadline)) seconds")
                self.end(.noAnswer, status: nil)
            }
        }
        readBatch(run, address: address)
    }

    private func readBatch(_ run: Int, address: String) {
        store.read(after: keeping.anchor(for: address), limit: batchLimit) { read in
            self.queue.async {
                guard self.running, self.generation == run, let current = self.current else { return }
                switch read {
                case .locked:
                    self.end(.locked, status: nil)
                case .failed(let reason):
                    self.log("\(current.trigger.rawValue): Health's sleep could not be read: \(reason)")
                    self.end(.readFailed, status: nil)
                case let .batch(samples, deleted, anchor):
                    let earlier = self.keeping.earlier
                    if samples.isEmpty && deleted.isEmpty && earlier.isEmpty {
                        self.end(self.progress.samples + self.progress.deleted > 0 ? .sent : .nothingNew, status: nil)
                        return
                    }
                    let payload = SleepPayload(trigger: current.trigger.rawValue, state: current.state, samples: samples, deleted: deleted, earlier: earlier)
                    guard let body = try? JSONEncoder().encode(payload) else {
                        self.end(.readFailed, status: nil)
                        return
                    }
                    self.send(run, body: body, to: address, samples: samples.count, deleted: deleted.count, earlier: earlier.count, anchor: anchor)
                }
            }
        }
    }

    private func send(_ run: Int, body: Data, to address: String, samples: Int, deleted: Int, earlier: Int, anchor: Data?) {
        sender.post(body, to: address) { answer in
            self.queue.async {
                guard self.running, self.generation == run, let current = self.current else { return }
                switch answer {
                case .status(let status) where (200..<300).contains(status):
                    guard self.keeping.address == address else {
                        self.log("\(current.trigger.rawValue): the address changed during the send, so its place in Health's history is not kept")
                        self.end(.sent, status: status)
                        return
                    }
                    self.keeping.setAnchor(anchor, for: address)
                    self.keeping.earlier = Array(self.keeping.earlier.dropFirst(earlier))
                    self.progress.samples += samples
                    self.progress.deleted += deleted
                    self.progress.status = status
                    self.log("\(current.trigger.rawValue): sent \(samples) stretches, \(deleted) deletions and \(earlier) earlier attempts")
                    if samples + deleted >= batchLimit {
                        self.readBatch(run, address: address)
                    } else {
                        self.end(.sent, status: status)
                    }
                case .status(let status):
                    self.log("\(current.trigger.rawValue): the server answered \(status), so the same stretches go again next time")
                    self.end(.serverRefused, status: status)
                case .failed(let reason):
                    self.log("\(current.trigger.rawValue): no answer from the server: \(reason)")
                    self.end(.noAnswer, status: nil)
                }
            }
        }
    }

    /// End the running sync: keep it when it delivered nothing and its address is still the saved one, answer every
    /// caller, then run what came meanwhile.
    private func end(_ outcome: SleepOutcome, status: Int?) {
        guard running, let current = current else { return }
        running = false
        self.current = nil
        var result = progress
        // A sync that sent some batches before one failed still says how it ended, with what it sent.
        result.outcome = outcome
        if status != nil { result.status = status }
        if outcome.kept, runAddress != keeping.address {
            log("\(current.trigger.rawValue): the address changed during the sync, so its \(outcome.rawValue) is not kept for the new one")
        } else if outcome.kept {
            var earlier = keeping.earlier
            earlier.append(SleepAttempt(at: now(), trigger: current.trigger.rawValue, state: current.state, outcome: outcome.rawValue, status: status))
            keeping.earlier = Array(earlier.suffix(keptLimit))
        }
        log("\(current.trigger.rawValue) (\(current.state)): \(outcome.rawValue)")
        for caller in current.waiting { caller.answer(result) }
        if let next = next {
            self.next = nil
            start(next.trigger, state: next.state, dataAvailable: next.dataAvailable, waiting: next.waiting)
        }
    }
}

/// Health's questions, one at a time. iOS loses the person's answer to a sheet when a second question comes while it is
/// up, so a second caller waits until the first has its answer. Blocks, so never call it on the main thread.
final class OneQuestionAtATime {
    private let turn = DispatchSemaphore(value: 1)

    /// Run `question` once no other question is up; `waiting` is called first when one is.
    func ask<T>(_ question: () -> T, waiting: () -> Void) -> T {
        if turn.wait(timeout: .now()) == .timedOut {
            waiting()
            turn.wait()
        }
        defer { turn.signal() }
        return question()
    }
}
