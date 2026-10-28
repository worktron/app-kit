// The bare swiftc route, as Fleet and perf-buddy build: the package compiled as a module of its own and an app that
// imports it, with a Program of its own. swiftc-build.sh builds and runs it in a folder of the build's; it runs a
// program with a limit, writes the outcome to a log, and writes a native host's manifest, and fails when any is wrong.
import Foundation
import MacApp

struct Program {
    let name: String
}

let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let mine = Program(name: "an app's own program")
let log = AppLog(file: folder.appendingPathComponent("app.log"))
do {
    let outcome = try MacApp.Program.run("/bin/echo", arguments: ["ran"], limit: 30)
    log.note("ran", outcome.outputText, "exit \(outcome.exitCode.map(String.init) ?? "none")")
    let host = try NativeHost(name: "com.example.app", description: "Example", extensionIDs: [String(repeating: "a", count: 32)])
    let wrote = try host.install(executable: "/Applications/Example.app/Contents/MacOS/Example", in: folder.appendingPathComponent("hosts"))
    guard outcome.outputText == "ran\n", log.tail(1).first?.hasSuffix("\tran\tran \texit 0") == true, wrote else {
        FileHandle.standardError.write(Data("swiftc-app: \(outcome) \(log.tail(1)) \(wrote)\n".utf8))
        exit(1)
    }
    print("ran a program, logged it and wrote a host beside \(mine.name)")
} catch {
    FileHandle.standardError.write(Data("swiftc-app: \(error)\n".utf8))
    exit(1)
}
