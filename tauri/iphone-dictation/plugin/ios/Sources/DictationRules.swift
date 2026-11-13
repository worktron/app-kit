import Foundation

// The rules dictation keeps words and starts by, apart from iOS so `Tests/main.swift` runs them on the Mac with bare
// swiftc. IphoneDictationPlugin.swift feeds them Apple's results and does what they decide.

/// What one result from Apple's recognizer says, as the rules read it.
struct HeardResult {
    /// The result's best transcription, with the punctuation Apple added.
    let text: String
    /// Apple's last result of the task.
    let final: Bool
    /// iOS 18's pause marker: a result with speech metadata whose speech duration is above zero. After it the next
    /// results start a fresh transcript, so what it carries has to be kept now (forum threads 762952, 764809, 770278).
    let paused: Bool
}

private func joined(_ parts: String...) -> String {
    parts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " ")
}

/// The words heard so far: the settled text, which never changes, and the current hypothesis, which each partial result
/// replaces whole, since Apple revises earlier words ("for" to "four", a comma to a period) as it hears more.
struct HeardWords {
    private(set) var settled = ""
    private(set) var hypothesis = ""

    var words: String { joined(settled, hypothesis) }

    /// After a pause marker iOS starts a fresh transcript, so a later result never repeats settled words, and none are
    /// cut from it: a cut of words matching the settled ones dropped real speech ("Okay." then "Okay, let's go.").
    mutating func take(_ result: HeardResult) {
        let text = result.text
        if result.final || result.paused {
            // An empty final after a pause, which iOS 18 sends, keeps what was heard: it never erases words.
            let keeping = text.isEmpty ? hypothesis : text
            if !keeping.isEmpty { settled = joined(settled, keeping) }
            hypothesis = ""
        } else {
            hypothesis = text
        }
    }
}

/// What the page reads with `dictation_heard`.
struct Heard: Equatable {
    let words: String
    let ended: Bool
    let error: String?
}

/// What the plugin does after a stop.
enum StopAction: Equatable {
    /// Nothing to stop: a stale token, or a dictation already ended.
    case nothing
    /// The microphone is on: turn it off and end the audio, then wait for the task's last result.
    case endAudio
    /// The permission answer has not come: the dictation ends now, and the answer, when it comes, starts nothing.
    case ended
}

/// One dictation at a time, each start with its token. Stop, cancel, the app going to the background, a page load and
/// a newer start each make the token stale, and a stale token turns nothing on: a permission answer that comes back
/// after the person left starts no microphone. Every method takes the lock, so any thread may call it.
final class DictationState {
    private let lock = NSLock()
    private var token: Int64 = 0
    private var heard = HeardWords()
    private var stopped = true
    private var running = false
    private var ended = true
    private var error: String?

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    /// A new dictation, which makes every earlier token stale. Returns its token.
    func start() -> Int64 {
        locked {
            token += 1
            heard = HeardWords()
            stopped = false
            running = false
            ended = false
            error = nil
            return token
        }
    }

    /// Whether the dictation `token` may turn the microphone on: the newest, not stopped and not ended.
    func mayRun(_ token: Int64) -> Bool {
        locked { token == self.token && !stopped && !ended }
    }

    /// The microphone is on for `token`. False when it went stale in between, and the caller turns it off again.
    func running(_ token: Int64) -> Bool {
        locked {
            guard token == self.token, !stopped, !ended else { return false }
            running = true
            return true
        }
    }

    /// Whether `token` is the newest dictation and has not ended: its results still count.
    func live(_ token: Int64) -> Bool {
        locked { token == self.token && !ended }
    }

    func stop(_ token: Int64) -> StopAction {
        locked {
            guard token == self.token, !ended, !stopped else { return .nothing }
            stopped = true
            if running { return .endAudio }
            ended = true
            return .ended
        }
    }

    /// End the dictation `token`, or whichever is in force when `token` is nil (the app going to the background, a page
    /// load). Returns whether one was in force, and so needs its microphone turned off.
    func cancel(_ token: Int64?) -> Bool {
        locked {
            guard token == nil || token == self.token, !ended || running else { return false }
            stopped = true
            ended = true
            running = false
            return true
        }
    }

    func take(_ result: HeardResult, for token: Int64) {
        locked {
            guard token == self.token, !ended else { return }
            heard.take(result)
        }
    }

    /// The dictation `token` ended, with `error` in the web's words or the system's, or none.
    func finish(_ token: Int64, error: String?) {
        locked {
            guard token == self.token, !ended || running else { return }
            if !ended { self.error = error }
            ended = true
            running = false
            stopped = true
        }
    }

    /// What the page reads. A stale token reads as ended with no words, so an old reader never takes a newer one's.
    func heard(_ token: Int64) -> Heard {
        locked {
            guard token == self.token else { return Heard(words: "", ended: true, error: nil) }
            return Heard(words: heard.words, ended: ended, error: error)
        }
    }
}

/// Apple's error domain for the speech recognizer's own failures.
let speechErrorDomain = "kLSRErrorDomain"
/// The assistant's error domain, which carries the rest.
let assistantErrorDomain = "kAFAssistantErrorDomain"

/// Apple's error as the web names it, following expo-speech-recognition's table (ios/ExpoSpeechRecognitionModule.swift),
/// or the system's own words for anything else. Nil for a cancel, which is no failure.
func dictationErrorName(domain: String, code: Int, message: String) -> String? {
    if domain == speechErrorDomain {
        switch code {
        case 102, 201: return "service-not-allowed"
        case 301: return nil
        default: break
        }
    }
    if domain == assistantErrorDomain {
        switch code {
        case 203: return "audio-capture"
        case 1100: return "busy"
        case 1101, 1107: return "network"
        case 1110: return "no-speech"
        case 1700: return "not-allowed"
        default: break
        }
    }
    return message
}
