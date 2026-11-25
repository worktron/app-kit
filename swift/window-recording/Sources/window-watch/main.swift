// The window watch: watches, every 20 milliseconds, the windows on screen of programs named by its first argument that
// started after it did, and prints `outside <pid> <left> <top> <width> <height>` for each sighting of one that touches
// any display but the hidden one, the display holding the point its second and third arguments give. So a run proves
// its window never showed on the owner's screens, from its first frame to its last, rather than asking them. It prints
// `watching` once it has its first look, and `done <sightings> <seen>` when its standard input closes, then ends:
// `seen` counts the looks that found a window of the program anywhere, the hidden display included, since macOS does
// not promise a window's owner name, and a watch that matched nothing would otherwise pass having watched nothing.
// Only the window list is read, so it needs no Screen Recording permission of its own.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 4, let left = Double(CommandLine.arguments[2]), let top = Double(CommandLine.arguments[3]) else {
    FileHandle.standardError.write(Data("usage: window-watch <program name> <left> <top>\n".utf8))
    exit(2)
}
let name = CommandLine.arguments[1]
let place = CGPoint(x: left, y: top)

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

// Programs of that name already running, such as the owner's own Chrome, are not the run's.
let before = Set(windows().compactMap { $0[kCGWindowOwnerPID as String] as? Int32 })
let counts = NSLock()
var sightings = 0
var seen = 0
print("watching")
fflush(stdout)

Thread.detachNewThread {
    while readLine() != nil {}
    counts.lock()
    print("done \(sightings) \(seen)")
    counts.unlock()
    fflush(stdout)
    exit(0)
}

while true {
    let others = displays().filter { !$0.contains(place) }
    var found = false
    for window in windows() {
        guard let pid = window[kCGWindowOwnerPID as String] as? Int32, !before.contains(pid),
              let bounds = window[kCGWindowBounds as String] as? NSDictionary,
              let frame = CGRect(dictionaryRepresentation: bounds),
              frame.width > 1, frame.height > 1,
              (window[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { continue }
        found = true
        if others.contains(where: { $0.intersects(frame) }) {
            counts.lock()
            sightings += 1
            counts.unlock()
            print("outside \(pid) \(Int(frame.minX)) \(Int(frame.minY)) \(Int(frame.width)) \(Int(frame.height))")
            fflush(stdout)
        }
    }
    if found {
        counts.lock()
        seen += 1
        counts.unlock()
    }
    Thread.sleep(forTimeInterval: 0.02)
}
