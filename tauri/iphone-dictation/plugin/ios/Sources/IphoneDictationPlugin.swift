// Dictation with punctuation through Apple's speech recognizer (SFSpeechRecognizer), which the web's SpeechRecognition
// on an iPhone never adds. The Rust commands call the C functions below; the rules for keeping words and for each
// start's token are in DictationRules.swift. All the audio work runs on one serial queue, never the main thread, which
// a Tauri command may hold.
//
// Apple's recognizer does not run on the iPhone Simulator (it fails with kLSRErrorDomain 300), so a Simulator build
// runs a stand-in that hands back made-up punctuated words in stages, a pause that resets the transcript, and an end.
// A phone build never has it.

import AVFoundation
import Speech
import Tauri
import UIKit
import WebKit

private let logPrefix = "[iphone-dictation]"
private let state = DictationState()
private let queue = DispatchQueue(label: "app-kit.iphone-dictation")

private func log(_ line: String) {
    NSLog("%@ %@", logPrefix, line)
}

/// Apple's words for an error, named as the web names it where it has a name.
private func errorName(_ error: Error) -> String? {
    let ns = error as NSError
    return dictationErrorName(domain: ns.domain, code: ns.code, message: ns.localizedDescription)
}

/// A copy of `text` the Rust side reads and then hands to `iphone_dictation_free`.
private func cString(_ text: String) -> UnsafeMutablePointer<CChar> {
    strdup(text)!
}

#if targetEnvironment(simulator)

// MARK: - The Simulator's stand-in

/// What the stand-in hears, in order, one result every 0.6 seconds: a revised partial, a punctuation revision, a pause
/// that resets the transcript, and an end.
private let standInResults: [HeardResult] = [
    HeardResult(text: "how is", final: false, paused: false),
    HeardResult(text: "How is the weather", final: false, paused: false),
    HeardResult(text: "How is the weather today?", final: false, paused: true),
    HeardResult(text: "it looks", final: false, paused: false),
    HeardResult(text: "It looks like rain, so bring a coat.", final: false, paused: false),
    HeardResult(text: "It looks like rain, so bring a coat.", final: true, paused: false),
]

private func standInStart(_ token: Int64) {
    // Stands in for the permission answer, which comes back later, so a cancel before it is held as on a phone.
    queue.asyncAfter(deadline: .now() + 0.3) {
        guard state.mayRun(token), state.running(token) else {
            log("start \(token): stale when the stand-in's permission came back, so it started nothing")
            return
        }
        log("start \(token): the Simulator's stand-in is listening")
        standInStep(token, 0)
    }
}

private func standInStep(_ token: Int64, _ index: Int) {
    queue.asyncAfter(deadline: .now() + 0.6) {
        guard state.live(token) else { return }
        guard index < standInResults.count else { return }
        let result = standInResults[index]
        state.take(result, for: token)
        if result.final {
            state.finish(token, error: nil)
            log("start \(token): the stand-in ended")
            return
        }
        standInStep(token, index + 1)
    }
}

private func standInStop(_ token: Int64) {
    queue.asyncAfter(deadline: .now() + 0.2) {
        state.finish(token, error: nil)
        log("start \(token): the stand-in stopped")
    }
}

#else

// MARK: - Apple's recognizer

/// What one dictation holds while its microphone is on. Touched only on `queue`.
private final class Listening {
    let token: Int64
    let engine = AVAudioEngine()
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var tapped = false
    var heardAnything = false
    /// Whether this is the retry without the dictation hint and on-device recognition.
    var plain = false

    init(token: Int64) {
        self.token = token
    }
}

private var listening: Listening?

/// Turn the microphone off: remove the tap, stop the engine, end the request's audio. The task goes on to its last
/// result. Queue only.
private func stopAudio(_ l: Listening) {
    if l.tapped {
        l.engine.inputNode.removeTap(onBus: 0)
        l.tapped = false
    }
    if l.engine.isRunning { l.engine.stop() }
    l.request?.endAudio()
}

/// The one teardown, on every finish, error, cancel, going to the background and page load. Queue only.
private func tearDown(_ why: String) {
    guard let l = listening else { return }
    listening = nil
    stopAudio(l)
    l.task?.cancel()
    l.task = nil
    l.request = nil
    do {
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    } catch {
        log("start \(l.token): the audio session would not let go: \(error.localizedDescription)")
    }
    log("start \(l.token): microphone off (\(why))")
}

private func fail(_ token: Int64, _ error: String) {
    log("start \(token): failed: \(error)")
    state.finish(token, error: error)
    if listening?.token == token { tearDown("failed") }
}

/// Whether the app's Info.plist explains `key`. iOS ends an app that asks for the microphone or speech without it.
private func explains(_ key: String) -> Bool {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String).map { !$0.isEmpty } ?? false
}

private func askMicrophone(_ answer: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission(completionHandler: answer)
    } else {
        AVAudioSession.sharedInstance().requestRecordPermission(answer)
    }
}

private func appleStart(_ token: Int64, lang: String?) {
    for key in ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"] where !explains(key) {
        queue.async { fail(token, "the app's Info.plist has no \(key), which iOS needs before it asks") }
        return
    }
    SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else {
            queue.async {
                guard state.live(token) else { return }
                fail(token, status == .restricted ? "service-not-allowed" : "not-allowed")
            }
            return
        }
        guard state.mayRun(token) else {
            log("start \(token): speech permission came back after it was stopped, so nothing more is asked")
            return
        }
        askMicrophone { granted in
            queue.async {
                guard state.mayRun(token) else {
                    log("start \(token): permission came back after it was stopped, so the microphone stays off")
                    return
                }
                guard granted else {
                    fail(token, "not-allowed")
                    return
                }
                listen(token, lang: lang, plain: false)
            }
        }
    }
}

/// Turn the microphone on and recognize what it hears. Queue only.
private func listen(_ token: Int64, lang: String?, plain: Bool) {
    tearDown("a new start")
    let recognizer = lang.flatMap { SFSpeechRecognizer(locale: Locale(identifier: $0)) } ?? (lang == nil ? SFSpeechRecognizer() : nil)
    guard let recognizer = recognizer else {
        fail(token, "language-not-supported")
        return
    }
    guard recognizer.isAvailable else {
        fail(token, "service-not-allowed")
        return
    }
    let l = Listening(token: token)
    l.plain = plain
    listening = l
    let session = AVAudioSession.sharedInstance()
    do {
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
        log("start \(token): the audio session refused: \(error.localizedDescription)")
        fail(token, "audio-capture")
        return
    }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(iOS 16.0, *) { request.addsPunctuation = true }
    if !plain {
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    }
    l.request = request
    let input = l.engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
        fail(token, "audio-capture")
        return
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
    }
    l.tapped = true
    l.engine.prepare()
    do {
        try l.engine.start()
    } catch {
        log("start \(token): the microphone would not start: \(error.localizedDescription)")
        fail(token, "audio-capture")
        return
    }
    guard state.running(token) else {
        tearDown("stopped while it started")
        return
    }
    l.task = recognizer.recognitionTask(with: request) { result, error in
        queue.async { recognized(l, lang: lang, result: result, error: error) }
    }
    log("start \(token): listening\(plain ? " without the dictation hint" : ""), \(request.requiresOnDeviceRecognition ? "on the phone" : "through Apple's servers")")
}

/// A result or error from the task. Queue only.
private func recognized(_ l: Listening, lang: String?, result: SFSpeechRecognitionResult?, error: Error?) {
    // A task torn down or replaced, such as the first try before the retry, says nothing more.
    guard listening === l else { return }
    if let result = result {
        var paused = false
        if #available(iOS 18.0, *), !result.isFinal {
            paused = (result.speechRecognitionMetadata?.speechDuration ?? 0) > 0
        }
        let text = result.bestTranscription.formattedString
        if !text.isEmpty { l.heardAnything = true }
        state.take(HeardResult(text: text, final: result.isFinal, paused: paused), for: l.token)
        if result.isFinal {
            state.finish(l.token, error: nil)
            if listening === l { tearDown("the last result came") }
            return
        }
    }
    guard let error = error else { return }
    let ns = error as NSError
    // Keyboard dictation off in Settings refuses the dictation hint: once, try again without it.
    if ns.domain == speechErrorDomain, ns.code == 201, !l.plain, !l.heardAnything, state.mayRun(l.token) {
        log("start \(l.token): refused with dictation off in Settings (201), so it tries again without the dictation hint")
        listen(l.token, lang: lang, plain: true)
        return
    }
    let name = errorName(error)
    log("start \(l.token): ended by \(ns.domain) \(ns.code): \(ns.localizedDescription)")
    state.finish(l.token, error: name)
    if listening === l { tearDown("ended") }
}

#endif

// MARK: - The C functions the Rust commands call

/// Start a dictation, ending any earlier one, and return its token at once. The permission questions and the
/// microphone follow on their own; the page reads how it went with `iphone_dictation_heard`. `lang` is a BCP 47 tag
/// such as `en-US`, or empty for the phone's own language.
@_cdecl("iphone_dictation_start")
func iphoneDictationStart(_ lang: UnsafePointer<CChar>) -> Int64 {
    let tag = String(cString: lang)
    let token = state.start()
    log("start \(token)\(tag.isEmpty ? "" : " in \(tag)")")
    #if targetEnvironment(simulator)
    queue.async { standInStart(token) }
    #else
    queue.async {
        tearDown("a new start")
        appleStart(token, lang: tag.isEmpty ? nil : tag)
    }
    #endif
    return token
}

/// What dictation `token` has heard, as JSON `{ "words", "ended", "error" }`. The caller frees it.
@_cdecl("iphone_dictation_heard")
func iphoneDictationHeard(_ token: Int64) -> UnsafeMutablePointer<CChar> {
    let heard = state.heard(token)
    var answer: [String: Any] = ["words": heard.words, "ended": heard.ended]
    answer["error"] = heard.error ?? NSNull()
    let data = (try? JSONSerialization.data(withJSONObject: answer)) ?? Data("{\"words\":\"\",\"ended\":true,\"error\":null}".utf8)
    return cString(String(decoding: data, as: UTF8.self))
}

@_cdecl("iphone_dictation_free")
func iphoneDictationFree(_ text: UnsafeMutablePointer<CChar>) {
    free(text)
}

/// Stop dictation `token`: the microphone goes off at once, and the task's last result or error ends it.
@_cdecl("iphone_dictation_stop")
func iphoneDictationStop(_ token: Int64) {
    switch state.stop(token) {
    case .nothing:
        return
    case .ended:
        log("start \(token): stopped before permission came back")
    case .endAudio:
        log("start \(token): stopped, waiting for the last words")
        #if targetEnvironment(simulator)
        standInStop(token)
        #else
        queue.async {
            if let l = listening, l.token == token { stopAudio(l) }
        }
        #endif
    }
}

/// End dictation `token` now, keeping no more words, or whichever is in force when `token` is 0 (a page load, the web
/// process ending).
@_cdecl("iphone_dictation_cancel")
func iphoneDictationCancel(_ token: Int64) {
    guard state.cancel(token == 0 ? nil : token) else { return }
    log(token == 0 ? "cancelled whatever was listening" : "start \(token): cancelled")
    #if !targetEnvironment(simulator)
    queue.async { tearDown("cancelled") }
    #endif
}

// MARK: - Plugin class

private var backgroundObserver: NSObjectProtocol?

@objc(IphoneDictationPlugin)
public class IphoneDictationPlugin: Plugin {
    override public func load(webview: WKWebView) {
        log("plugin loaded")
    }
}

@_cdecl("init_plugin_iphone_dictation")
func initPlugin() -> Plugin {
    if backgroundObserver == nil {
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
        ) { _ in
            if state.cancel(nil) {
                log("the app went to the background: microphone off")
                #if !targetEnvironment(simulator)
                queue.async { tearDown("the app went to the background") }
                #endif
            }
        }
    }
    return IphoneDictationPlugin()
}
