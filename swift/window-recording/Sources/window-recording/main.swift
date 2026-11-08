// window-recording: makes the hidden display, says where a window goes on it, and records the window a process opens
// there, driven by lines on standard input and answering with lines on standard output:
//   out  display <id> <left> <top>    the display is up; a window opened with its top left there is on it
//   in   record <pid>                 find that process's window on the display and start recording it
//   out  recording <ms>               the file has its first frame, at that time in milliseconds since 1970
//   in   stop                         finish the file
//   out  stopped                      the file is closed and complete
//   out  error <kind>: <message>      then the program ends: usage (2), screen-recording (4), display (5), recording (6)
// Standard input closing, or SIGTERM or SIGINT, finishes any recording first, then removes the display and ends.
import CoreGraphics
import Foundation
import WindowRecording

setvbuf(stdout, nil, _IOLBF, 0)

func say(_ line: String) {
    print(line)
    fflush(stdout)
}

func fail(_ kind: String, _ message: String) -> Never {
    say("error \(kind): \(message)")
    let codes = ["usage": Int32(2), "screen-recording": 4, "display": 5]
    exit(codes[kind] ?? 6)
}

let options: Options
do {
    options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
} catch {
    fail("usage", "\(error)")
}

let display: HiddenDisplay
do {
    display = try HiddenDisplay(window: CGSize(width: options.width, height: options.height), scale: options.scale)
} catch {
    fail("display", "\(error)")
}
let place = windowPlace(display: display.bounds)
say("display \(display.id) \(Int(place.x)) \(Int(place.y))")

let recorder = WindowRecorder()
let out = URL(fileURLWithPath: options.out)

/** Finishes any recording, then ends the program, which removes the display. */
func finish() async -> Never {
    if recorder.recording {
        do {
            try await recorder.stop()
            say("stopped")
        } catch {
            fail("recording", "\(error)")
        }
    }
    exit(0)
}

var signals: [DispatchSourceSignal] = []
for number in [SIGTERM, SIGINT] {
    signal(number, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { Task { await finish() } }
    source.resume()
    signals.append(source)
}

Task {
    do {
        for try await line in FileHandle.standardInput.bytes.lines {
            switch parseCommand(line) {
            case let .record(pid):
                if recorder.recording { fail("usage", "already recording") }
                do {
                    let window = try await findWindow(pid: pid, display: display.bounds)
                    try await recorder.start(window: window, scale: options.scale, out: out)
                    say("recording \(Int(recorder.startedAt))")
                } catch let error as RecordingError {
                    fail(error.kind, error.description)
                }
            case .stop:
                do {
                    try await recorder.stop()
                    say("stopped")
                } catch {
                    fail("recording", "\(error)")
                }
            case nil:
                fail("usage", "unknown line \(line); the lines are record <pid> and stop")
            }
        }
    } catch {
        fail("usage", "standard input failed: \(error)")
    }
    await finish()
}

dispatchMain()
