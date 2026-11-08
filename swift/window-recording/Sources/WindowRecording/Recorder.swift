// One window recorded to an mp4 with ScreenCaptureKit's single-window filter, which records the window's own pixels
// wherever it is, and SCRecordingOutput, which writes the file (macOS 15).
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

public struct RecordingError: Error, CustomStringConvertible {
    /** `screen-recording` when macOS has not allowed this program to record the screen, else `recording`. */
    public let kind: String
    public let description: String
}

/** The window of `pid` on `display`, waited for until it shows, at most `seconds`. */
public func findWindow(pid: Int32, display: CGRect, seconds: Double = 15) async throws -> SCWindow {
    let until = Date().addingTimeInterval(seconds)
    while true {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        } catch {
            throw RecordingError(kind: "screen-recording", description: "macOS has not allowed this program to record the screen (\(error.localizedDescription)); allow the app the run started from in System Settings, Privacy & Security, Screen & System Audio Recording")
        }
        let candidates = content.windows.map {
            Candidate(id: $0.windowID, pid: $0.owningApplication?.processID ?? 0, frame: $0.frame, layer: $0.windowLayer)
        }
        if let id = chooseWindow(candidates, pid: pid, display: display), let window = content.windows.first(where: { $0.windowID == id }) {
            return window
        }
        if Date() > until {
            // What the screen's list held for the process, so a run that misses its window says why.
            let seen = content.windows.filter { $0.owningApplication?.processID == pid }
                .map { "window \($0.windowID) at \($0.frame) layer \($0.windowLayer)" }
            let unowned = content.windows.filter { $0.owningApplication == nil }.count
            throw RecordingError(kind: "recording", description: "process \(pid) showed no window on the hidden display \(display) within \(Int(seconds)) seconds; its windows listed: \(seen.isEmpty ? "none" : seen.joined(separator: ", ")); windows with no owner: \(unowned)")
        }
        try await Task.sleep(nanoseconds: 200_000_000)
    }
}

// ScreenCaptureKit calls the delegate on queues of its own, so the waits it ends are taken under a lock.
public final class WindowRecorder: NSObject, SCRecordingOutputDelegate, SCStreamDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var stream: SCStream?
    private var started: CheckedContinuation<Void, Error>?
    private var finished: CheckedContinuation<Void, Error>?
    /** When the file's first frame was taken, in milliseconds since 1970: the recording's clock zero. */
    public private(set) var startedAt: Double = 0

    public var recording: Bool { stream != nil }

    /** Starts recording `window` to `out` at `scale` pixels per point, returning once the file has its first frame. */
    public func start(window: SCWindow, scale: Int, out: URL) async throws {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(window.frame.width) * scale
        configuration.height = Int(window.frame.height) * scale
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.shouldBeOpaque = true
        let output = SCRecordingOutputConfiguration()
        output.outputURL = out
        output.outputFileType = .mp4
        output.videoCodecType = .h264
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addRecordingOutput(SCRecordingOutput(configuration: output, delegate: self))
        self.stream = stream
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            lock.withLock { started = continuation }
            stream.startCapture { error in
                if let error { self.resumeStarted(with: error) }
            }
        }
    }

    /** Finishes the file, returning once it is closed. */
    public func stop() async throws {
        guard let stream else { return }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            lock.withLock { finished = continuation }
            stream.stopCapture { error in
                if let error { self.resumeFinished(with: error) }
            }
        }
        self.stream = nil
    }

    public func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        startedAt = Date().timeIntervalSince1970 * 1000
        take(\.started)?.resume()
    }

    public func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        resumeStarted(with: error)
        resumeFinished(with: error)
    }

    public func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        take(\.finished)?.resume()
    }

    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        resumeStarted(with: error)
        resumeFinished(with: error)
    }

    /** The wait at `key`, cleared, so each is ended once. */
    private func take(_ key: ReferenceWritableKeyPath<WindowRecorder, CheckedContinuation<Void, Error>?>) -> CheckedContinuation<Void, Error>? {
        lock.withLock {
            let wait = self[keyPath: key]
            self[keyPath: key] = nil
            return wait
        }
    }

    private func resumeStarted(with error: Error) {
        take(\.started)?.resume(throwing: RecordingError(kind: "recording", description: error.localizedDescription))
    }

    private func resumeFinished(with error: Error) {
        take(\.finished)?.resume(throwing: RecordingError(kind: "recording", description: error.localizedDescription))
    }
}
