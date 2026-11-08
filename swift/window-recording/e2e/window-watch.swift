// For the live tests: watches, every 20 milliseconds, the windows on screen of programs named by its first argument that
// started after it did, and prints `outside <pid> <left> <top> <width> <height>` for each sighting of one that touches
// any display but the hidden one, the display holding the point its second and third arguments give. So a test proves
// its window never showed on the owner's screens, from its first frame to its last, rather than asking them. It prints
// `watching` once it has its first look, and `done <sightings>` when its standard input closes, then ends.
import CoreGraphics
import Foundation

let name = CommandLine.arguments[1]
let place = CGPoint(x: Double(CommandLine.arguments[2])!, y: Double(CommandLine.arguments[3])!)

func windows() -> [[String: Any]] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? [])
        .filter { ($0[kCGWindowOwnerName as String] as? String) == name }
}

func displays() -> [CGRect] {
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    CGGetActiveDisplayList(16, &ids, &count)
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
}

// Programs of that name already running, such as the owner's own Chrome, are not the test's.
let before = Set(windows().compactMap { $0[kCGWindowOwnerPID as String] as? Int32 })
var sightings = 0
print("watching")
fflush(stdout)

Thread.detachNewThread {
    while readLine() != nil {}
    print("done \(sightings)")
    fflush(stdout)
    exit(0)
}

while true {
    let screens = displays()
    let others = screens.filter { !$0.contains(place) }
    for window in windows() {
        guard let pid = window[kCGWindowOwnerPID as String] as? Int32, !before.contains(pid),
              let bounds = window[kCGWindowBounds as String] as? NSDictionary,
              let frame = CGRect(dictionaryRepresentation: bounds),
              frame.width > 1, frame.height > 1,
              (window[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { continue }
        if others.contains(where: { $0.intersects(frame) }) {
            sightings += 1
            print("outside \(pid) \(Int(frame.minX)) \(Int(frame.minY)) \(Int(frame.width)) \(Int(frame.height))")
            fflush(stdout)
        }
    }
    Thread.sleep(forTimeInterval: 0.02)
}
