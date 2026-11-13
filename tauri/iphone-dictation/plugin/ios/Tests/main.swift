import Foundation

// Dictation's rules (Sources/DictationRules.swift), run on the Mac by scripts/gates.sh with bare swiftc, since the
// plugin's own package builds only for iOS against Tauri.

var failures = 0
func check<T: Equatable>(_ name: String, _ got: T, _ want: T) {
    if got == want {
        print("ok: \(name)")
    } else {
        failures += 1
        print("FAIL: \(name): got \(got), want \(want)")
    }
}

func partial(_ text: String) -> HeardResult { HeardResult(text: text, final: false, paused: false) }
func paused(_ text: String) -> HeardResult { HeardResult(text: text, final: false, paused: true) }
func final(_ text: String) -> HeardResult { HeardResult(text: text, final: true, paused: false) }

func hear(_ results: [HeardResult]) -> String {
    var words = HeardWords()
    for result in results { words.take(result) }
    return words.words
}

// Word settling.

check("a revised partial replaces the word it corrected, never adds it",
      hear([partial("I want for"), partial("I want four apples")]), "I want four apples")
check("a punctuation revision replaces the comma with the question mark",
      hear([partial("Is it raining,"), partial("Is it raining?")]), "Is it raining?")
check("a reset after a pause keeps what came before it",
      hear([partial("Hello there"), paused("Hello there."), partial("how"), partial("How are you?")]),
      "Hello there. How are you?")
check("partials after a pause revise only the new words",
      hear([paused("First thing."), partial("second"), partial("Second thing,"), partial("Second thing.")]),
      "First thing. Second thing.")
check("a final settles the words", hear([partial("Done"), final("Done.")]), "Done.")
check("an empty final after a pause erases nothing",
      hear([paused("Last words."), final("")]), "Last words.")
check("an empty final keeps the hypothesis it has", hear([partial("Still here"), final("")]), "Still here")
check("a new sentence that starts with the settled words keeps them",
      hear([paused("Okay."), partial("Okay, let's go.")]), "Okay. Okay, let's go.")
check("a new word that starts with the settled word keeps every letter",
      hear([paused("I."), partial("It works.")]), "I. It works.")
check("two pauses in a row keep both in order",
      hear([paused("One."), paused("Two."), partial("three")]), "One. Two. three")

// The start token.

do {
    let state = DictationState()
    let token = state.start()
    // The permission answer is delayed; the person cancels first.
    check("a cancel before the permission answer reports one was in force", state.cancel(token), true)
    check("a permission answer after a cancel may not turn the microphone on", state.mayRun(token), false)
    check("nor mark it running", state.running(token), false)
    check("the cancelled start reads as ended", state.heard(token), Heard(words: "", ended: true, error: nil))
}

do {
    let state = DictationState()
    let first = state.start()
    let second = state.start()
    check("a newer start makes the older token stale", state.mayRun(first), false)
    check("the newer one may run", state.mayRun(second), true)
    state.take(partial("new words"), for: second)
    state.take(partial("old words"), for: first)
    check("a stale token's result is dropped", state.heard(second).words, "new words")
    check("a stale reader reads nothing, ended", state.heard(first), Heard(words: "", ended: true, error: nil))
    check("a stale stop does nothing", state.stop(first), StopAction.nothing)
    check("a stale cancel does nothing", state.cancel(first), false)
    check("and the newer one goes on", state.mayRun(second), true)
}

do {
    let state = DictationState()
    let token = state.start()
    check("a stop before the permission answer ends it at once", state.stop(token), StopAction.ended)
    check("and the answer turns nothing on", state.mayRun(token), false)
}

do {
    let state = DictationState()
    let token = state.start()
    _ = state.running(token)
    state.take(partial("half a sentence"), for: token)
    check("a stop with the microphone on ends the audio", state.stop(token), StopAction.endAudio)
    check("a second stop does nothing", state.stop(token), StopAction.nothing)
    check("results still count after the stop, until the last", state.live(token), true)
    state.take(final("Half a sentence."), for: token)
    state.finish(token, error: nil)
    check("the last words are read after the stop", state.heard(token), Heard(words: "Half a sentence.", ended: true, error: nil))
    check("a cancel after the end has nothing to turn off", state.cancel(token), false)
}

do {
    let state = DictationState()
    let token = state.start()
    _ = state.running(token)
    state.take(partial("going"), for: token)
    check("going to the background cancels whatever is in force", state.cancel(nil), true)
    check("and keeps the words heard", state.heard(token), Heard(words: "going", ended: true, error: nil))
    check("an error after the cancel changes nothing", { state.finish(token, error: "audio-capture"); return state.heard(token).error }(), nil as String?)
}

do {
    let state = DictationState()
    let token = state.start()
    _ = state.running(token)
    state.finish(token, error: "not-allowed")
    check("an error is read with the end", state.heard(token), Heard(words: "", ended: true, error: "not-allowed"))
}

// Errors, as the web names them.

check("dictation off in Settings", dictationErrorName(domain: speechErrorDomain, code: 201, message: "x"), "service-not-allowed")
check("a cancelled request is no failure", dictationErrorName(domain: speechErrorDomain, code: 301, message: "x"), nil as String?)
check("not authorized", dictationErrorName(domain: assistantErrorDomain, code: 1700, message: "x"), "not-allowed")
check("no speech", dictationErrorName(domain: assistantErrorDomain, code: 1110, message: "x"), "no-speech")
check("anything else in the system's own words",
      dictationErrorName(domain: "NSOSStatusErrorDomain", code: -50, message: "The operation couldn't be completed."),
      "The operation couldn't be completed.")

exit(failures == 0 ? 0 : 1)
