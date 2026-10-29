import AppKit
import Foundation
import MenuBarTheme

// menu-bar-snapshots render <folder> [dark|light] [plain|console]
//                                                          draws each sample screen to <folder>/<screen>.png, in the
//                                                          dark appearance and the plain look unless asked otherwise
// menu-bar-snapshots compare <mockups> <theme> <out>       checks each screen against the mockup's render and its
//                                                          rectangles (<mockups>/<screen>.png and .json), and writes the
//                                                          two side by side to <out>/<screen>.png; the mockups are the
//                                                          console look's, so <theme> is a console render
// Exit codes: 0 all drawn or all within the limits; 1 a screen failed, with why; 2 wrong usage.

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("menu-bar-snapshots: \(message)\n".utf8))
    exit(code)
}

let arguments = Array(CommandLine.arguments.dropFirst())
MainActor.assumeIsolated {
    _ = NSApplication.shared
    switch (arguments.first, arguments.count) {
    case ("render", 2...4):
        let words = arguments.dropFirst(2)
        let appearances = ["dark": NSAppearance.Name.darkAqua, "light": .aqua]
        let looks = ["plain": Look.plain(), "console": .console]
        guard words.allSatisfy({ appearances[$0] != nil || looks[$0] != nil }),
              words.filter({ appearances[$0] != nil }).count <= 1, words.filter({ looks[$0] != nil }).count <= 1
        else { fail("render takes dark or light and plain or console, not \(words.joined(separator: " "))", code: 2) }
        let folder = URL(fileURLWithPath: arguments[1])
        let appearance = NSAppearance(named: words.compactMap { appearances[$0] }.first ?? .darkAqua)!
        Look.app = words.compactMap { looks[$0] }.first ?? .default
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            for sample in samples {
                try render(sample, appearance: appearance).write(to: folder.appendingPathComponent("\(sample.name).png"))
                print("drew \(sample.name)")
            }
        } catch { fail("\(error)") }
    case ("compare", 4):
        Look.app = .console
        let paths = arguments.dropFirst().map { URL(fileURLWithPath: $0) }
        var failed = false
        for sample in samples where sample.mockup {
            do {
                let problems = try compare(screen: sample.name, mockups: paths[0], theme: paths[1], out: paths[2])
                if problems.isEmpty { print("\(sample.name): within the limits") }
                for problem in problems { print("\(sample.name): \(problem)") }
                failed = failed || !problems.isEmpty
            } catch { fail("\(sample.name): \(error)") }
        }
        if failed { exit(1) }
    default:
        fail("usage: menu-bar-snapshots render <folder> [dark|light] [plain|console] | compare <mockups> <theme> <out>", code: 2)
    }
}
