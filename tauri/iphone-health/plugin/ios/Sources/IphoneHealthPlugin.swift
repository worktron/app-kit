// app-kit's iPhone Health: the sleep stretches the Apple Watch (or any app) writes to Health, and, for an app that asks,
// its heart rate readings, each sent by the app itself to the address the page gives for it, when the app opens, each
// time it comes to the front, and when iOS wakes it in the background for new samples. When to send and what is kept
// is HealthSync.swift's; this file is HealthKit, the network and iOS. Health cannot be read while the phone is locked,
// so a background wake then sends nothing and is kept, and the samples go the next time the app opens.

import UIKit
import WebKit
import HealthKit
import Tauri

private let logPrefix = "[iphone-health]"

private func log(_ line: String) {
    NSLog("%@ %@", logPrefix, line)
}

private let healthStore = HKHealthStore()
private let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
private let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate)!
private let beatsPerMinute = HKUnit.count().unitDivided(by: .minute())

/// Heart rate's log lines, apart from sleep's.
private func heartRateLog(_ line: String) {
    log("heart rate: \(line)")
}

// MARK: - Health's sleep

/// Apple's case name for each sleep value, by its raw value, the same on every iOS (HKCategoryValueSleepAnalysis).
private func sleepValueName(_ raw: Int) -> String {
    switch raw {
    case 0: return "inBed"
    case 1: return "asleepUnspecified"
    case 2: return "awake"
    case 3: return "asleepCore"
    case 4: return "asleepDeep"
    case 5: return "asleepREM"
    default: return "asleepUnspecified"
    }
}

private func milliseconds(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1000).rounded())
}

/// The saved place in Health's history, or none: the start of it.
private func unarchiveAnchor(_ anchorData: Data?, log: (String) -> Void) -> HKQueryAnchor? {
    guard let anchorData = anchorData else { return nil }
    let anchor = try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: anchorData)
    if anchor == nil { log("the saved place in Health's history did not read back, so the history starts over") }
    return anchor
}

private func archiveAnchor(_ anchor: HKQueryAnchor?) -> Data? {
    anchor.flatMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) }
}

/// Whether Health's error says the phone is locked, when Health cannot be read.
private func isLocked(_ error: Error) -> Bool {
    let error = error as NSError
    return error.domain == HKErrorDomain && error.code == HKError.Code.errorDatabaseInaccessible.rawValue
}

private final class HealthSleepStore: HealthStore {
    func read(after anchorData: Data?, limit: Int, done: @escaping (HealthRead<SleepSample>) -> Void) {
        let anchor = unarchiveAnchor(anchorData, log: log)
        let query = HKAnchoredObjectQuery(type: sleepType, predicate: nil, anchor: anchor, limit: limit) { _, samples, deleted, newAnchor, error in
            if let error = error {
                done(isLocked(error) ? .locked : .failed(error.localizedDescription))
                return
            }
            let stretches = (samples ?? []).compactMap { $0 as? HKCategorySample }.map { sample in
                SleepSample(
                    uuid: sample.uuid.uuidString,
                    start: milliseconds(sample.startDate),
                    end: milliseconds(sample.endDate),
                    value: sleepValueName(sample.value),
                    source: sample.sourceRevision.source.bundleIdentifier,
                    device: sample.sourceRevision.productType ?? sample.device?.model)
            }
            let gone = (deleted ?? []).map { $0.uuid.uuidString }
            done(.batch(samples: stretches, deleted: gone, anchor: archiveAnchor(newAnchor),
                        more: filledLimit(samples: samples?.count ?? 0, deleted: gone.count, limit: limit)))
        }
        healthStore.execute(query)
    }
}

// MARK: - Health's heart rate

/// Reads heart rate as `readHeartRate` says: an anchored read, smaller while condensed series make it too many readings,
/// then one series query for every condensed series in it.
private final class HealthHeartRateStore: HealthStore {
    func read(after anchorData: Data?, limit: Int, done: @escaping (HealthRead<HeartRateSample>) -> Void) {
        let anchor = unarchiveAnchor(anchorData, log: heartRateLog)
        readHeartRate(limit: limit, cap: limit, query: { limit, answer in
            let query = HKAnchoredObjectQuery(type: heartRateType, predicate: nil, anchor: anchor, limit: limit) { _, samples, deleted, newAnchor, error in
                if let error = error {
                    answer(isLocked(error) ? .locked : .failed(error.localizedDescription))
                    return
                }
                let objects = (samples ?? []).compactMap { $0 as? HKQuantitySample }.map { sample in
                    HeartRateObject(
                        uuid: sample.uuid.uuidString,
                        count: sample.count,
                        start: milliseconds(sample.startDate),
                        end: milliseconds(sample.endDate),
                        bpm: sample.quantity.doubleValue(for: beatsPerMinute),
                        source: sample.sourceRevision.source.bundleIdentifier,
                        device: sample.sourceRevision.productType ?? sample.device?.model)
                }
                answer(.value(HeartRateRead(objects: objects, deleted: (deleted ?? []).map { $0.uuid.uuidString }, anchor: archiveAnchor(newAnchor))))
            }
            healthStore.execute(query)
        }, series: { uuids, answer in
            readSeries(uuids, answer: answer)
        }, done: done)
    }
}

/// Every reading of the condensed series named, in one query, grouped by series in the order Health gives them. Health
/// calls the handler once per reading and once more with `done`; a call with no reading adds nothing, and an error ends
/// the query.
private func readSeries(_ uuids: [String], answer: @escaping (HealthPart<[String: [SeriesReading]]>) -> Void) {
    let ids = Set(uuids.compactMap { UUID(uuidString: $0) })
    var readings: [String: [SeriesReading]] = [:]
    var answered = false
    let query = HKQuantitySeriesSampleQuery(quantityType: heartRateType, predicate: HKQuery.predicateForObjects(with: ids)) { query, quantity, interval, sample, done, error in
        guard !answered else { return }
        if let error = error {
            answered = true
            healthStore.stop(query)
            answer(isLocked(error) ? .locked : .failed(error.localizedDescription))
            return
        }
        if let quantity = quantity, let interval = interval, let sample = sample {
            readings[sample.uuid.uuidString, default: []].append(SeriesReading(
                start: milliseconds(interval.start), end: milliseconds(interval.end), bpm: quantity.doubleValue(for: beatsPerMinute)))
        }
        if done {
            answered = true
            answer(.value(readings))
        }
    }
    query.includeSample = true
    query.orderByQuantitySampleStartDate = true
    healthStore.execute(query)
}

// MARK: - The network

/// Refuses every redirect, so sleep goes only to the address the page gave. The refused answer comes back as it is,
/// a 3xx, which counts as refused.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        log("refused a redirect from \(task.originalRequest?.url?.absoluteString ?? "the address") to \(request.url?.absoluteString ?? "elsewhere")")
        completionHandler(nil)
    }
}

private final class NetworkSender: HealthSender {
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)

    func post(_ body: Data, to address: String, done: @escaping (SendAnswer) -> Void) {
        guard let url = URL(string: address) else { return done(.failed("the address does not parse")) }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        session.dataTask(with: request) { _, response, error in
            if let status = (response as? HTTPURLResponse)?.statusCode {
                done(.status(status))
            } else {
                done(.failed(error?.localizedDescription ?? "no answer"))
            }
        }.resume()
    }
}

// MARK: - The phone's saved state

/// One kind's address, place in Health's history and kept attempts, under that kind's keys.
private final class SavedState: HealthKeeping {
    private let defaults = UserDefaults.standard
    private let addressKey: String
    private let anchorKey: String
    private let earlierKey: String

    init(address: String, anchor: String, earlier: String) {
        addressKey = address
        anchorKey = anchor
        earlierKey = earlier
    }

    var address: String? {
        get { defaults.string(forKey: addressKey) }
        set {
            if let newValue = newValue { defaults.set(newValue, forKey: addressKey) } else { defaults.removeObject(forKey: addressKey) }
        }
    }

    func anchor(for address: String) -> Data? {
        guard let saved = defaults.dictionary(forKey: anchorKey), saved["address"] as? String == address else { return nil }
        return saved["anchor"] as? Data
    }

    func setAnchor(_ anchor: Data?, for address: String) {
        if let anchor = anchor {
            defaults.set(["address": address, "anchor": anchor], forKey: anchorKey)
        } else {
            defaults.removeObject(forKey: anchorKey)
        }
    }

    var earlier: [HealthAttempt] {
        get { defaults.data(forKey: earlierKey).flatMap { try? JSONDecoder().decode([HealthAttempt].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: earlierKey) }
    }
}

// MARK: - Health's watcher

/// Health calls the watcher when new samples of its type reach the phone, waking the app in the background for them at
/// most as often as `frequency`, and also once at every launch. Each call is answered when its sync ends, failures
/// included. Registered again after its kind's address was cleared, it keeps its one query and turns the wakes back on.
private final class TypeWatcher: HealthWatcher {
    private let type: HKSampleType
    private let frequency: HKUpdateFrequency
    private let words: HealthWords
    private let log: (String) -> Void
    private let wake: (@escaping () -> Void) -> Void
    private var query: HKObserverQuery?

    init(type: HKSampleType, frequency: HKUpdateFrequency, words: HealthWords, log: @escaping (String) -> Void, wake: @escaping (@escaping () -> Void) -> Void) {
        self.type = type
        self.frequency = frequency
        self.words = words
        self.log = log
        self.wake = wake
    }

    func register() {
        let log = self.log
        let words = self.words
        let wake = self.wake
        if query == nil {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completionHandler, error in
                if let error = error {
                    log("Health's watcher failed: \(error.localizedDescription)")
                    completionHandler()
                    return
                }
                wake { completionHandler() }
            }
            self.query = query
            healthStore.execute(query)
        }
        healthStore.enableBackgroundDelivery(for: type, frequency: frequency) { ok, error in
            if ok {
                log("iOS will wake the app for new \(words.kind)")
            } else {
                log("iOS will not wake the app for new \(words.kind): \(error?.localizedDescription ?? "no reason given"); the app sends when it opens")
            }
        }
    }
}

// MARK: - Syncs

private let sender = NetworkSender()

private let sleepSync = HealthSync(
    store: HealthSleepStore(), sender: sender, keeping: SavedState(address: addressKey, anchor: anchorKey, earlier: earlierKey),
    watcher: TypeWatcher(type: sleepType, frequency: .immediate, words: .sleep, log: log) { answered in
        runSleepSync(.backgroundWake) { _ in answered() }
    },
    batch: batchLimit, words: .sleep, now: { milliseconds(Date()) }, log: log)

// The Watch writes heart rate all night while the phone is locked, when Health cannot be read, so iOS wakes the app for
// it at most hourly: each locked wake only adds a failed send.
private let heartRateSync = HealthSync(
    store: HealthHeartRateStore(), sender: sender,
    keeping: SavedState(address: heartRateAddressKey, anchor: heartRateAnchorKey, earlier: heartRateEarlierKey),
    watcher: TypeWatcher(type: heartRateType, frequency: .hourly, words: .heartRate, log: heartRateLog) { answered in
        runHeartRateSync(.backgroundWake) { _ in answered() }
    },
    batch: heartRateBatchLimit, words: .heartRate, now: { milliseconds(Date()) }, log: heartRateLog)

/// A file kept readable from the first unlock after a restart until the next restart, as UserDefaults is, so reading it
/// tells a locked phone that was unlocked since it started from one that was not.
private let unlockMarker: URL = {
    let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return folder.appendingPathComponent("app-kit-iphone-health-unlocked")
}()

private func markUnlocked() {
    guard !FileManager.default.fileExists(atPath: unlockMarker.path) else { return }
    try? FileManager.default.createDirectory(at: unlockMarker.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? Data("unlocked".utf8).write(to: unlockMarker, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
}

/// The app's state and whether the phone has been unlocked since it started, read on the main thread as UIKit requires.
private func appState() -> (state: String, dataAvailable: Bool) {
    let read = { () -> (String, Bool) in
        let app = UIApplication.shared
        let state: String
        switch app.applicationState {
        case .active: state = "in front"
        case .inactive: state = "coming to the front"
        default: state = "in the background"
        }
        if app.isProtectedDataAvailable { markUnlocked() }
        let unlocked = unlockedSinceRestart(protectedDataAvailable: app.isProtectedDataAvailable) {
            FileManager.default.contents(atPath: unlockMarker.path) != nil
        }
        return (state, unlocked)
    }
    return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
}

private func runSleepSync(_ trigger: HealthTrigger, state: String? = nil, completion: @escaping (HealthResult) -> Void) {
    runSync(sleepSync, task: "app-kit.iphone-health.sync", trigger, state: state, completion: completion)
}

private func runHeartRateSync(_ trigger: HealthTrigger, state: String? = nil, completion: @escaping (HealthResult) -> Void) {
    runSync(heartRateSync, task: "app-kit.iphone-health.heart-rate-sync", trigger, state: state, completion: completion)
}

/// Run a sync with time asked of iOS to finish it, which iOS may take back: the sync then ends as `no answer`.
private func runSync<Store>(_ coordinator: HealthSync<Store>, task name: String, _ trigger: HealthTrigger, state: String? = nil, completion: @escaping (HealthResult) -> Void) {
    let (current, dataAvailable) = appState()
    let begin = {
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: name) {
            coordinator.expire()
        }
        coordinator.sync(trigger, state: state ?? current, dataAvailable: dataAvailable) { result in
            completion(result)
            DispatchQueue.main.async {
                if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
            }
        }
    }
    if Thread.isMainThread { begin() } else { DispatchQueue.main.async(execute: begin) }
}

private var observersSetUp = false

/// Heart rate's question checked only once an address is saved for it, so an app that never asks for heart rate never
/// asks iOS about it either. Answers on any thread.
private func heartRateQuestionAnsweredIfAsked(_ answer: @escaping (Bool) -> Void) {
    heartRateSync.hasAddress { known in
        if known { heartRateQuestionAnswered(answer) }
    }
}

/// Sync each time the app comes to the front, and register the watchers at the first unlock after a restart.
private func setUpObservers() {
    guard !observersSetUp else { return }
    observersSetUp = true
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
        healthQuestionAnswered { answered in
            // Starts the watcher if the launch's check could not, as iOS answered it later.
            sleepSync.watchIfReady(dataAvailable: appState().dataAvailable, answered: answered)
            // iOS still calls the app background as this arrives.
            if answered { runSleepSync(.front, state: "coming to the front") { _ in } }
        }
        heartRateQuestionAnsweredIfAsked { answered in
            heartRateSync.watchIfReady(dataAvailable: appState().dataAvailable, answered: answered)
            if answered { runHeartRateSync(.front, state: "coming to the front") { _ in } }
        }
    }
    center.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main) { _ in
        // The first unlock after a restart, for an app iOS started before it: kept, so a wake once the phone locks again
        // still reads Health.
        markUnlocked()
        healthQuestionAnswered { answered in sleepSync.watchIfReady(dataAvailable: true, answered: answered) }
        heartRateQuestionAnsweredIfAsked { answered in heartRateSync.watchIfReady(dataAvailable: true, answered: answered) }
    }
}

// MARK: - Asking for Health

/// Ask for Health's types, with iOS's sheet over the app's window. A Tauri app's window is never made the key window, and
/// HealthKit then makes its sheet and never shows it, so the question waited forever (seen on the iOS 27.2 Simulator);
/// the window is made key first. Blocks until the person answers, and asks one question at a time, since iOS loses the
/// answer to a sheet when another question comes while it is up.
private let questions = OneQuestionAtATime()

private func askForHealth(share: Set<HKSampleType>?, read: Set<HKObjectType>) -> Error? {
    questions.ask({ askNow(share: share, read: read) }, waiting: {
        log("another Health question is up, so this one waits for its answer")
    })
}

private func askNow(share: Set<HKSampleType>?, read: Set<HKObjectType>) -> Error? {
    let makeKey = {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        guard !windows.contains(where: { $0.isKeyWindow }), let window = windows.first(where: { !$0.isHidden }) else { return }
        window.makeKey()
        log("made the app's window the key window, so iOS has somewhere to show Health's sheet")
    }
    if Thread.isMainThread { makeKey() } else { DispatchQueue.main.sync(execute: makeKey) }
    let asked = DispatchSemaphore(value: 0)
    var failure: Error?
    healthStore.requestAuthorization(toShare: share, read: read) { _, error in
        failure = error
        asked.signal()
    }
    asked.wait()
    return failure
}

/// Whether Health's question about sleep has been answered, whatever the person chose, which iOS never says. Only a
/// clear "still to ask" answers false: when iOS cannot say, the watcher and reads go ahead as before, since skipping
/// them on doubt could stop every wake on a locked phone. Answers on any thread.
private func healthQuestionAnswered(_ answer: @escaping (Bool) -> Void) {
    questionAnswered(read: sleepType, log: log, answer)
}

/// The same for heart rate, asked of heart rate alone: an app upgraded from sleep alone has sleep's answer and not
/// heart rate's, and a heart rate watcher started before that answer never wakes.
private func heartRateQuestionAnswered(_ answer: @escaping (Bool) -> Void) {
    questionAnswered(read: heartRateType, log: heartRateLog, answer)
}

private func questionAnswered(read type: HKObjectType, log: @escaping (String) -> Void, _ answer: @escaping (Bool) -> Void) {
    healthStore.getRequestStatusForAuthorization(toShare: [], read: [type]) { status, error in
        answerStatus(status, error, log: log, answer)
    }
}

private func answerStatus(_ status: HKAuthorizationRequestStatus, _ error: Error?, log: (String) -> Void, _ answer: (Bool) -> Void) {
    switch status {
    case .shouldRequest:
        log("Health's question is not answered yet, so nothing is read or watched until the page's start asks it")
        answer(false)
    case .unnecessary:
        answer(true)
    default:
        log("iOS could not say whether Health's question was answered (\(error?.localizedDescription ?? "no reason given")), so the plugin goes ahead")
        answer(true)
    }
}

/// Whether Health's question about `type`, with writing it on the Simulator, is still to ask, waiting for iOS's answer:
/// a question only for what is still to ask leaves an answered sleep out of the sheet. Blocks, so never on the main
/// thread.
private func stillToAsk(_ type: HKSampleType) -> Bool {
    let answered = DispatchSemaphore(value: 0)
    var ask = true
    healthStore.getRequestStatusForAuthorization(toShare: writeOnSimulator([type]) ?? [], read: [type]) { status, _ in
        ask = status != .unnecessary
        answered.signal()
    }
    answered.wait()
    return ask
}

/// On the Simulator, start asks to write what it reads too when the app explains writing, so `simulatorSleep` and
/// `simulatorHeartRate` never show a second sheet: while any Health sheet about sleep is up, every read of it fails with
/// "Authorization not determined" and a watcher started then never wakes (seen on the iOS 27.2 Simulator, with a sheet
/// asking only to write). On a phone, start asks only to read.
private func writeOnSimulator(_ types: [HKSampleType]) -> Set<HKSampleType>? {
    #if targetEnvironment(simulator)
    return explains("NSHealthUpdateUsageDescription") ? Set(types) : nil
    #else
    return nil
    #endif
}

// MARK: - The page's commands

/// Whether the app's Info.plist explains `key`. iOS ends an app that asks for Health without it.
private func explains(_ key: String) -> Bool {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String).map { !$0.isEmpty } ?? false
}

private func json(_ object: [String: Any]) -> UnsafeMutablePointer<CChar> {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    return strdup(String(decoding: data, as: UTF8.self))!
}

private func resultObject(_ result: HealthResult) -> [String: Any] {
    var object: [String: Any] = ["outcome": result.outcome.rawValue, "samples": result.samples, "deleted": result.deleted]
    object["status"] = result.status ?? NSNull()
    return object
}

private func isWebAddress(_ address: String) -> Bool {
    guard let url = URL(string: address), url.scheme == "https" || url.scheme == "http", url.host != nil else { return false }
    return true
}

/// Ask Health for sleep, and for heart rate when `heartRate`. Sleep alone asks as it always has; with heart rate, only
/// what is still to ask goes in the question, so an app already allowed for sleep shows a sheet for heart rate alone.
private func askForTypes(heartRate: Bool) -> Error? {
    guard heartRate else { return askForHealth(share: writeOnSimulator([sleepType]), read: [sleepType]) }
    let types = [sleepType as HKSampleType, heartRateType].filter(stillToAsk)
    guard !types.isEmpty else { return nil }
    return askForHealth(share: writeOnSimulator(types), read: Set(types))
}

/// Stop sending heart rate: forget its address, place and kept attempts, and turn its background wakes off. Waits for
/// iOS to turn them off, so a start that gives the address again right after turns them on after this, not before.
/// Blocks, so never on the main thread.
private func stopHeartRate() {
    let stopped = DispatchSemaphore(value: 0)
    heartRateSync.clearAddress(dataAvailable: appState().dataAvailable) { had in
        guard had else {
            stopped.signal()
            return
        }
        healthStore.disableBackgroundDelivery(for: heartRateType) { _, _ in stopped.signal() }
    }
    stopped.wait()
}

/// Save the address, ask for Health's sleep (iOS shows its sheet once), watch for new sleep and send what is new; with a
/// heart rate address, the same for heart rate, and without one, stop sending heart rate. Blocks until the sends end,
/// so never call it on the main thread. Answers JSON `{ outcome, samples, deleted, status }`, with `heartRate` of the
/// same shape when its address was given, to be freed with `iphone_health_free`.
@_cdecl("iphone_health_start")
func startDirect(_ addressPointer: UnsafePointer<CChar>, _ heartRatePointer: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar> {
    let address = String(cString: addressPointer)
    let heartRateAddress = heartRatePointer.map { String(cString: $0) }
    // A start without heart rate stops it before anything else, so a start that then fails still stops it: stopping
    // needs no answer from Health.
    if heartRateAddress == nil { stopHeartRate() }
    guard HKHealthStore.isHealthDataAvailable() else {
        log("Health is not on this device")
        return json(["outcome": "no health"])
    }
    guard explains("NSHealthShareUsageDescription") else {
        log("the app's Info.plist has no NSHealthShareUsageDescription, which iOS needs before it asks for Health")
        return json(["outcome": "no permission text"])
    }
    for given in [address] + (heartRateAddress.map { [$0] } ?? []) where !isWebAddress(given) {
        log("refused the address \(given): not a web address")
        return json(["outcome": "bad address"])
    }
    // iOS never says whether reading was allowed: a refusal reads as no samples. A question that failed has no answer,
    // and a watcher or read before one fails for good, so nothing is saved or read.
    if let error = askForTypes(heartRate: heartRateAddress != nil) {
        log("asking for Health's \(heartRateAddress == nil ? "sleep" : "sleep and heart rate") failed, so nothing is saved or sent: \(error.localizedDescription)")
        return json(["outcome": "health not asked"])
    }
    let (_, dataAvailable) = appState()
    let saved = DispatchGroup()
    saved.enter()
    sleepSync.setAddress(address, dataAvailable: dataAvailable) { saved.leave() }
    if let heartRateAddress = heartRateAddress {
        saved.enter()
        heartRateSync.setAddress(heartRateAddress, dataAvailable: dataAvailable) { saved.leave() }
    }
    saved.wait()
    let sent = DispatchGroup()
    var result = HealthResult(outcome: .nothingNew)
    var heartRate: HealthResult?
    sent.enter()
    runSleepSync(.open) { r in
        result = r
        sent.leave()
    }
    if heartRateAddress != nil {
        sent.enter()
        runHeartRateSync(.open) { r in
            heartRate = r
            sent.leave()
        }
    }
    sent.wait()
    if result.outcome == .nothingNew {
        log("nothing new in Health's sleep; if there should be, check Settings, Health, Data Access & Devices")
    }
    var object = resultObject(result)
    if let heartRate = heartRate {
        if heartRate.outcome == .nothingNew {
            heartRateLog("nothing new in Health's heart rate; if there should be, check Settings, Health, Data Access & Devices")
        }
        object["heartRate"] = resultObject(heartRate)
    }
    return json(object)
}

@_cdecl("iphone_health_free")
func freeDirect(_ text: UnsafeMutablePointer<CChar>) {
    free(text)
}

#if targetEnvironment(simulator)
// MARK: - The Simulator's made-up nights

/// The newest 4:45 in the morning that has passed.
private func lastWaking() -> Date {
    let calendar = Calendar.current
    let now = Date()
    let today = calendar.date(bySettingHour: 4, minute: 45, second: 0, of: now)!
    return today <= now ? today : calendar.date(byAdding: .day, value: -1, to: today)!
}

/// A night that ends at 4:45: in bed from 22:45, then core, deep, REM, a short wake, and core again until 4:45.
private func madeUpNight() -> [HKCategorySample] {
    let end = lastWaking()
    let at = { (minutesBefore: Double) in end.addingTimeInterval(-minutesBefore * 60) }
    let stretch = { (value: Int, from: Double, to: Double) in
        HKCategorySample(type: sleepType, value: value, start: at(from), end: at(to))
    }
    return [
        stretch(0, 360, 0),
        stretch(3, 345, 255),
        stretch(4, 255, 195),
        stretch(5, 195, 150),
        stretch(2, 150, 140),
        stretch(3, 140, 0),
    ]
}

/// Add a made-up night to the Simulator's Health (`add`), or delete the newest stretch this app wrote (`delete`), since
/// nothing else puts sleep into a Simulator's Health. Blocks; answers JSON `{ added }`, `{ deleted }` or `{ error }`.
@_cdecl("iphone_health_simulator_sleep")
func simulatorSleepDirect(_ actionPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    let action = String(cString: actionPointer)
    guard explains("NSHealthUpdateUsageDescription") else {
        return json(["error": "the app's Info.plist has no NSHealthUpdateUsageDescription, which iOS needs before it lets the app write to Health"])
    }
    if let error = askForHealth(share: [sleepType], read: [sleepType]) {
        return json(["error": "asking to write Health's sleep failed: \(error.localizedDescription)"])
    }
    let done = DispatchSemaphore(value: 0)
    var answer: [String: Any] = [:]
    switch action {
    case "add":
        let night = madeUpNight()
        healthStore.save(night) { ok, error in
            answer = ok ? ["added": night.map { $0.uuid.uuidString }] : ["error": error?.localizedDescription ?? "Health did not save it"]
            done.signal()
        }
    case "delete":
        let mine = HKQuery.predicateForObjects(from: HKSource.default())
        let newest = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: sleepType, predicate: mine, limit: 1, sortDescriptors: [newest]) { _, samples, error in
            guard let sample = samples?.first else {
                answer = ["error": error?.localizedDescription ?? "no stretch of this app's to delete"]
                done.signal()
                return
            }
            healthStore.delete(sample) { ok, error in
                answer = ok ? ["deleted": sample.uuid.uuidString] : ["error": error?.localizedDescription ?? "Health did not delete it"]
                done.signal()
            }
        }
        healthStore.execute(query)
    default:
        answer = ["error": "the action is add or delete, not \(action)"]
        done.signal()
    }
    done.wait()
    log("simulator sleep \(action): \(answer)")
    return json(answer)
}

/// The made-up night's heart rate: a reading every 5 minutes from 22:45 to 4:40, slow and a little uneven, then a
/// series of 60 readings 5 seconds apart from 4:40, rising as the wake at 4:45 comes. Answers the readings and the
/// series' readings by time.
private func madeUpHeartRate() -> (readings: [(Date, Double)], series: [(Date, Double)]) {
    let end = lastWaking()
    var readings: [(Date, Double)] = []
    for n in 0..<72 {
        let minutesBefore = Double(360 - n * 5)
        let bpm = 54.0 + Double((n * 7) % 9)
        readings.append((end.addingTimeInterval(-minutesBefore * 60), bpm))
    }
    let seriesStart = end.addingTimeInterval(-5 * 60)
    var series: [(Date, Double)] = []
    for n in 0..<60 {
        let bpm = 58.0 + Double(n) * 0.6
        series.append((seriesStart.addingTimeInterval(Double(n) * 5), bpm))
    }
    return (readings, series)
}

/// Add the made-up night's heart rate to the Simulator's Health (`add`), the series as one condensed series the way
/// Health condenses a workout's, or delete the newest heart rate sample this app wrote (`delete`). Blocks; answers JSON
/// `{ added, series: [{ uuid, count }] }`, `{ deleted }` or `{ error }`. Health may split one series into several.
@_cdecl("iphone_health_simulator_heart_rate")
func simulatorHeartRateDirect(_ actionPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    let action = String(cString: actionPointer)
    guard explains("NSHealthUpdateUsageDescription") else {
        return json(["error": "the app's Info.plist has no NSHealthUpdateUsageDescription, which iOS needs before it lets the app write to Health"])
    }
    if let error = askForHealth(share: [heartRateType], read: [heartRateType]) {
        return json(["error": "asking to write Health's heart rate failed: \(error.localizedDescription)"])
    }
    let done = DispatchSemaphore(value: 0)
    var answer: [String: Any] = [:]
    switch action {
    case "add":
        let night = madeUpHeartRate()
        let singles = night.readings.map { at, bpm in
            HKQuantitySample(type: heartRateType, quantity: HKQuantity(unit: beatsPerMinute, doubleValue: bpm), start: at, end: at)
        }
        healthStore.save(singles) { ok, error in
            guard ok else {
                answer = ["error": error?.localizedDescription ?? "Health did not save the readings"]
                done.signal()
                return
            }
            let builder = HKQuantitySeriesSampleBuilder(healthStore: healthStore, quantityType: heartRateType, startDate: night.series[0].0, device: nil)
            do {
                for (at, bpm) in night.series {
                    try builder.insert(HKQuantity(unit: beatsPerMinute, doubleValue: bpm), for: DateInterval(start: at, duration: 0))
                }
            } catch {
                answer = ["error": "the series did not take a reading: \(error.localizedDescription)"]
                done.signal()
                return
            }
            builder.finishSeries(metadata: nil, endDate: nil) { samples, error in
                if let samples = samples {
                    answer = ["added": singles.count, "series": samples.map { ["uuid": $0.uuid.uuidString, "count": $0.count] }]
                } else {
                    answer = ["error": error?.localizedDescription ?? "Health did not finish the series"]
                }
                done.signal()
            }
        }
    case "delete":
        let mine = HKQuery.predicateForObjects(from: HKSource.default())
        let newest = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: heartRateType, predicate: mine, limit: 1, sortDescriptors: [newest]) { _, samples, error in
            guard let sample = samples?.first else {
                answer = ["error": error?.localizedDescription ?? "no heart rate of this app's to delete"]
                done.signal()
                return
            }
            healthStore.delete(sample) { ok, error in
                answer = ok ? ["deleted": sample.uuid.uuidString] : ["error": error?.localizedDescription ?? "Health did not delete it"]
                done.signal()
            }
        }
        healthStore.execute(query)
    default:
        answer = ["error": "the action is add or delete, not \(action)"]
        done.signal()
    }
    done.wait()
    log("simulator heart rate \(action): \(answer)")
    return json(answer)
}
#else
@_cdecl("iphone_health_simulator_sleep")
func simulatorSleepDirect(_ actionPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    json(["error": "made-up nights are only on the Simulator"])
}

@_cdecl("iphone_health_simulator_heart_rate")
func simulatorHeartRateDirect(_ actionPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    json(["error": "made-up heart rate is only on the Simulator"])
}
#endif

// MARK: - Plugin class and entry point

@objc(IphoneHealthPlugin)
public class IphoneHealthPlugin: Plugin {
    override public func load(webview: WKWebView) {
        log("plugin loaded (window ready)")
    }
}

/// Runs before launch finishes. Once iOS says Health's question is answered, a moment later, each watcher is registered
/// when an address is saved for it, and a launch into the front sends what is new. A watcher registered after launch
/// still misses nothing: its first callback, at registration, runs a sync, which reads all that is new since the last
/// send. Heart rate goes only by heart rate's own answer.
@_cdecl("init_plugin_iphone_health")
func initPlugin() -> Plugin {
    let start = {
        setUpObservers()
        let (state, dataAvailable) = appState()
        healthQuestionAnswered { answered in
            sleepSync.watchIfReady(dataAvailable: dataAvailable, answered: answered)
            guard answered, state != "in the background" else { return }
            sleepSync.hasAddress { known in
                if known { runSleepSync(.open) { _ in } }
            }
        }
        heartRateQuestionAnsweredIfAsked { answered in
            heartRateSync.watchIfReady(dataAvailable: dataAvailable, answered: answered)
            guard answered, state != "in the background" else { return }
            runHeartRateSync(.open) { _ in }
        }
    }
    if Thread.isMainThread { start() } else { DispatchQueue.main.async(execute: start) }
    return IphoneHealthPlugin()
}
