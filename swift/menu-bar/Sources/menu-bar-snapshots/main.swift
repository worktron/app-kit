import AppKit
import Foundation

// menu-bar-snapshots render <folder>                       draws each sample screen to <folder>/<screen>.png
// menu-bar-snapshots compare <mockups> <theme> <out>       checks each screen against the mockup's render and its
//                                                          rectangles (<mockups>/<screen>.png and .json), and writes the
//                                                          two side by side to <out>/<screen>.png
// Exit codes: 0 all drawn or all within the limits; 1 a screen failed, with why; 2 wrong usage.

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("menu-bar-snapshots: \(message)\n".utf8))
    exit(code)
}

let arguments = CommandLine.arguments.dropFirst()
MainActor.assumeIsolated {
    _ = NSApplication.shared
    switch (arguments.first, arguments.count) {
    case ("render", 2):
        let folder = URL(fileURLWithPath: arguments.last!)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            for sample in samples {
                try render(sample).write(to: folder.appendingPathComponent("\(sample.name).png"))
                print("drew \(sample.name)")
            }
        } catch { fail("\(error)") }
    case ("compare", 4):
        let paths = arguments.dropFirst().map { URL(fileURLWithPath: $0) }
        var failed = false
        for sample in samples {
            do {
                let problems = try compare(screen: sample.name, mockups: paths[0], theme: paths[1], out: paths[2])
                if problems.isEmpty { print("\(sample.name): within the limits") }
                for problem in problems { print("\(sample.name): \(problem)") }
                failed = failed || !problems.isEmpty
            } catch { fail("\(sample.name): \(error)") }
        }
        if failed { exit(1) }
    default:
        fail("usage: menu-bar-snapshots render <folder> | compare <mockups> <theme> <out>", code: 2)
    }
}
