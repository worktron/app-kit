// app-kit's iPhone Health: the sleep stretches the Apple Watch (or any app) writes to Health, sent by the app itself to
// the address the page gives, when the app opens, each time it comes to the front, and when iOS wakes it in the
// background for new sleep. When to send and what is kept is SleepSync.swift's; this file is HealthKit, the network
// and iOS. Health cannot be read while the phone is locked, so a background wake then sends nothing and is kept, and
// the stretches go the next time the app opens.

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

private final class HealthSleepStore: SleepStore {
    func read(after anchorData: Data?, limit: Int, done: @escaping (SleepRead) -> Void) {
        var anchor: HKQueryAnchor?
        if let anchorData = anchorData {
            anchor = try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: anchorData)
            if anchor == nil { log("the saved place in Health's history did not read back, so the history starts over") }
        }
        let query = HKAnchoredObjectQuery(type: sleepType, predicate: nil, anchor: anchor, limit: limit) { _, samples, deleted, newAnchor, error in
            if let error = error as NSError? {
                if error.domain == HKErrorDomain && error.code == HKError.Code.errorDatabaseInaccessible.rawValue {
                    done(.locked)
                } else {
                    done(.failed(error.localizedDescription))
                }
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
            let archived = newAnchor.flatMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) }
            done(.batch(samples: stretches, deleted: (deleted ?? []).map { $0.uuid.uuidString }, anchor: archived))
        }
        healthStore.execute(query)
    }
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

private final class NetworkSender: SleepSender {
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

private final class SavedState: SleepKeeping {
    private let defaults = UserDefaults.standard

    var address: String? {
        get { defaults.string(forKey: addressKey) }
        set { defaults.set(newValue, forKey: addressKey) }
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

    var earlier: [SleepAttempt] {
        get { defaults.data(forKey: earlierKey).flatMap { try? JSONDecoder().decode([SleepAttempt].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: earlierKey) }
    }
}

// MARK: - Health's watcher

/// Health calls the watcher when new sleep reaches the phone, waking the app in the background for it, and also once at
/// every launch. Each call is answered when its sync ends, failures included.
private final class HealthWatcher: SleepWatcher {
    func register() {
        let query = HKObserverQuery(sampleType: sleepType, predicate: nil) { _, completionHandler, error in
            if let error = error {
                log("Health's watcher failed: \(error.localizedDescription)")
                completionHandler()
                return
            }
            runSync(.backgroundWake, completion: { _ in completionHandler() })
        }
        healthStore.execute(query)
        healthStore.enableBackgroundDelivery(for: sleepType, frequency: .immediate) { ok, error in
            if ok {
                log("iOS will wake the app for new sleep")
            } else {
                log("iOS will not wake the app for new sleep: \(error?.localizedDescription ?? "no reason given"); the app sends when it opens")
            }
        }
    }
}

// MARK: - Syncs

private let coordinator = SleepSync(
    store: HealthSleepStore(), sender: NetworkSender(), keeping: SavedState(), watcher: HealthWatcher(),
    now: { milliseconds(Date()) }, log: log)

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
        return (state, app.isProtectedDataAvailable)
    }
    return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
}

/// Run a sync with time asked of iOS to finish it, which iOS may take back: the sync then ends as `no answer`.
private func runSync(_ trigger: SleepTrigger, state: String? = nil, completion: @escaping (SleepResult) -> Void) {
    let (current, dataAvailable) = appState()
    let begin = {
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "app-kit.iphone-health.sync") {
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

/// Sync each time the app comes to the front, and register the watcher at the first unlock after a restart.
private func setUpObservers() {
    guard !observersSetUp else { return }
    observersSetUp = true
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
        // iOS still calls the app background as this arrives.
        runSync(.front, state: "coming to the front") { _ in }
    }
    center.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main) { _ in
        coordinator.watchIfReady(dataAvailable: true)
    }
}

// MARK: - Asking for Health

/// Ask for Health's types, with iOS's sheet over the app's window. A Tauri app's window is never made the key window, and
/// HealthKit then makes its sheet and never shows it, so the question waited forever (seen on the iOS 27.2 Simulator);
/// the window is made key first. Blocks until the person answers.
private func askForHealth(share: Set<HKSampleType>?, read: Set<HKObjectType>) -> Error? {
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

// MARK: - The page's commands

/// Whether the app's Info.plist explains `key`. iOS ends an app that asks for Health without it.
private func explains(_ key: String) -> Bool {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String).map { !$0.isEmpty } ?? false
}

private func json(_ object: [String: Any]) -> UnsafeMutablePointer<CChar> {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    return strdup(String(decoding: data, as: UTF8.self))!
}

private func resultJSON(_ result: SleepResult) -> UnsafeMutablePointer<CChar> {
    var object: [String: Any] = ["outcome": result.outcome.rawValue, "samples": result.samples, "deleted": result.deleted]
    object["status"] = result.status ?? NSNull()
    return json(object)
}

/// Save the address, ask for Health's sleep (iOS shows its sheet once), watch for new sleep and send what is new. Blocks
/// until the send ends, so never call it on the main thread. Answers JSON `{ outcome, samples, deleted, status }`, to be
/// freed with `iphone_health_free`.
@_cdecl("iphone_health_start")
func startDirect(_ addressPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    let address = String(cString: addressPointer)
    guard HKHealthStore.isHealthDataAvailable() else {
        log("Health is not on this device")
        return json(["outcome": "no health"])
    }
    guard explains("NSHealthShareUsageDescription") else {
        log("the app's Info.plist has no NSHealthShareUsageDescription, which iOS needs before it asks for Health")
        return json(["outcome": "no permission text"])
    }
    guard let url = URL(string: address), url.scheme == "https" || url.scheme == "http", url.host != nil else {
        log("refused the address \(address): not a web address")
        return json(["outcome": "bad address"])
    }
    // iOS never says whether reading was allowed: a refusal reads as no sleep.
    if let error = askForHealth(share: nil, read: [sleepType]) {
        log("asking for Health's sleep failed: \(error.localizedDescription)")
    }
    let (_, dataAvailable) = appState()
    let saved = DispatchSemaphore(value: 0)
    coordinator.setAddress(address, dataAvailable: dataAvailable) { saved.signal() }
    saved.wait()
    let sent = DispatchSemaphore(value: 0)
    var result = SleepResult(outcome: .nothingNew)
    runSync(.open) { r in
        result = r
        sent.signal()
    }
    sent.wait()
    if result.outcome == .nothingNew {
        log("nothing new in Health's sleep; if there should be, check Settings, Health, Data Access & Devices")
    }
    return resultJSON(result)
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
#else
@_cdecl("iphone_health_simulator_sleep")
func simulatorSleepDirect(_ actionPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    json(["error": "made-up nights are only on the Simulator"])
}
#endif

// MARK: - Plugin class and entry point

@objc(IphoneHealthPlugin)
public class IphoneHealthPlugin: Plugin {
    override public func load(webview: WKWebView) {
        log("plugin loaded (window ready)")
    }
}

/// Runs before launch finishes, which Apple asks of Health's watcher: with an address saved, the watcher is registered
/// now, and a launch into the front sends what is new.
@_cdecl("init_plugin_iphone_health")
func initPlugin() -> Plugin {
    let start = {
        setUpObservers()
        let (state, dataAvailable) = appState()
        coordinator.watchIfReady(dataAvailable: dataAvailable)
        if state != "in the background" {
            coordinator.hasAddress { known in
                if known { runSync(.open) { _ in } }
            }
        }
    }
    if Thread.isMainThread { start() } else { DispatchQueue.main.async(execute: start) }
    return IphoneHealthPlugin()
}
