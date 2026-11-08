// window-recording: makes the hidden display, says where a window goes on it, and records the window a process opens
// there, driven by lines on standard input and answering with lines on standard output:
//   out  display <id> <left> <top>    the display is up; a window opened with its top left there is on it
//   in   record <pid>                 find that process's window on the display and start recording it
//   out  recording <ms>               the file has its first frame, at that time in milliseconds since 1970
//   in   stop                         finish the file
//   out  stopped                      the file is closed and complete
//   out  error <kind>: <message>      a line it could not do; the display stays until standard input closes
// An error before the display is up ends the program: usage (2), display (5). Standard input closing, or SIGTERM or
// SIGINT, finishes any recording, removes the display and ends; the caller closes the recorded program first, since a
// window left on a display that goes is moved to the owner's screen.
import AppKit
import CoreGraphics
import Foundation
import WindowRecording

// An app with no Dock icon and no windows of its own: ScreenCaptureKit puts macOS's recording mark in the menu bar
// from this process, which takes an application to hold it.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

setvbuf(stdout, nil, _IOLBF, 0)

func say(_ line: String) {
    print(line)
    fflush(stdout)
}

func fail(_ kind: String, _ message: String) -> Never {
    say("error \(kind): \(message)")
    exit(kind == "usage" ? 2 : 5)
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

/** Says what went wrong with a line, and keeps the display, so a window on it never lands on the owner's screen. */
func refuse(_ kind: String, _ message: String) {
    say("error \(kind): \(message)")
}

/** Finishes any recording, removes the display, and ends the program. */
func finish() async -> Never {
    var code: Int32 = 0
    if recorder.recording {
        do {
            try await recorder.stop()
            say("stopped")
        } catch {
            refuse("recording", "\(error)")
            code = 6
        }
    }
    display.remove()
    exit(code)
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
                if recorder.recording {
                    refuse("usage", "already recording")
                    continue
                }
                do {
                    let window = try await findWindow(pid: pid, display: display.bounds)
                    try await recorder.start(window: window, scale: options.scale, out: out)
                    say("recording \(Int(recorder.startedAt))")
                } catch let error as RecordingError {
                    refuse(error.kind, error.description)
                } catch {
                    refuse("recording", "\(error)")
                }
            case .stop:
                do {
                    try await recorder.stop()
                    say("stopped")
                } catch {
                    refuse("recording", "\(error)")
                }
            case nil:
                refuse("usage", "unknown line \(line); the lines are record <pid> and stop")
            }
        }
    } catch {
        refuse("usage", "standard input failed: \(error)")
    }
    await finish()
}

app.run()
