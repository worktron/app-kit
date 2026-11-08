// What the window recording decides without touching the screen: its arguments, the lines it takes on its standard
// input, where the hidden display goes, where the window sits on it, and which window is the one to record.
import CoreGraphics
import Foundation

/** The program's arguments: the window's size in points, the mp4 to write, and the pixels per point. */
public struct Options: Equatable {
    public var width: Int
    public var height: Int
    public var out: String
    public var scale: Int
}

public struct UsageError: Error, CustomStringConvertible {
    public let description: String
}

public let usage = "window-recording --width <points> --height <points> --out <file.mp4> [--scale 1|2]"

/** Reads `--width`, `--height`, `--out` and `--scale` (2 when not given). */
public func parseOptions(_ arguments: [String]) throws -> Options {
    var values: [String: String] = [:]
    var at = 0
    while at < arguments.count {
        let name = arguments[at]
        guard ["--width", "--height", "--out", "--scale"].contains(name), at + 1 < arguments.count else {
            throw UsageError(description: "unknown or incomplete argument \(name); usage: \(usage)")
        }
        values[name] = arguments[at + 1]
        at += 2
    }
    guard let width = Int(values["--width"] ?? ""), let height = Int(values["--height"] ?? ""), width >= 200, height >= 200,
          width <= 3840, height <= 2160
    else { throw UsageError(description: "the window's --width and --height are points from 200 by 200 to 3840 by 2160; usage: \(usage)") }
    guard let out = values["--out"], out.hasSuffix(".mp4") else { throw UsageError(description: "--out names the .mp4 to write; usage: \(usage)") }
    let scale = Int(values["--scale"] ?? "2") ?? 0
    guard scale == 1 || scale == 2 else { throw UsageError(description: "--scale is 1 or 2; usage: \(usage)") }
    return Options(width: width, height: height, out: out, scale: scale)
}

/** A line on the program's standard input. */
public enum Command: Equatable {
    /** Find the window of the process `pid` on the hidden display and start recording it. */
    case record(pid: Int32)
    /** Finish the recording and close its file. */
    case stop
}

public func parseCommand(_ line: String) -> Command? {
    let words = line.split(separator: " ").map(String.init)
    if words == ["stop"] { return .stop }
    if words.count == 2, words[0] == "record", let pid = Int32(words[1]), pid > 0 { return .record(pid: pid) }
    return nil
}

/**
 * Room around the window on the hidden display, in points. macOS keeps a window's top below the menu bar each display
 * draws, so the window sits this far down, and its frame never reaches the display's edge.
 */
public let margin: CGFloat = 60

/** The hidden display's size for a window of `window` points. */
public func displaySize(window: CGSize) -> CGSize {
    CGSize(width: window.width + 2 * margin, height: window.height + 2 * margin)
}

/** Where the window's top left goes on the display whose bounds are `display`, in global points. */
public func windowPlace(display: CGRect) -> CGPoint {
    CGPoint(x: display.minX + margin, y: display.minY + margin)
}

/**
 * Where the hidden display goes: past the far corner of every other display, below and right of all of them, so it
 * touches them at a corner at most, and the pointer does not wander onto it from an edge the owner uses.
 */
public func displayOrigin(beside displays: [CGRect]) -> CGPoint {
    guard let first = displays.first else { return .zero }
    let all = displays.dropFirst().reduce(first) { $0.union($1) }
    return CGPoint(x: all.maxX, y: all.maxY)
}

/** A window as the screen's list of windows gives it. */
public struct Candidate: Equatable {
    public var id: UInt32
    public var pid: Int32
    public var frame: CGRect
    public var layer: Int

    public init(id: UInt32, pid: Int32, frame: CGRect, layer: Int) {
        self.id = id
        self.pid = pid
        self.frame = frame
        self.layer = layer
    }
}

/**
 * The window to record: the process's largest ordinary window (layer 0) on the hidden display. Chrome also owns small
 * windows of other layers, such as its menus' and its status bubbles', which are never the one.
 */
public func chooseWindow(_ candidates: [Candidate], pid: Int32, display: CGRect) -> UInt32? {
    candidates
        .filter { $0.pid == pid && $0.layer == 0 && display.intersects($0.frame) && $0.frame.width >= 200 }
        .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }?
        .id
}

/** Whether a display with `bounds` holds a display of `size`, with the window and its margins. */
public func fits(_ bounds: CGRect, _ size: CGSize) -> Bool {
    bounds.width >= size.width && bounds.height >= size.height
}
