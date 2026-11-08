// swift-tools-version:6.0
// The window recording program: it makes a display nobody sees for the length of a run, and records one window on it to
// an mp4 with ScreenCaptureKit, so a video can show a real Chrome window, address bar included, with nothing on the
// owner's screen. command-line/window-recording.ts builds it with `swift build` into app-kit's state folder from the
// kit bun installed and drives it over its standard input and output (README.md, "Window recording").
import Foundation
import PackageDescription

// ScreenCaptureKit shows macOS's recording mark in the menu bar from inside the recording process, which reads the
// process's Info.plist and stops the program when it has none; a command-line program carries one in its binary.
let infoPlist = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Sources/window-recording/Info.plist").path

let package = Package(
    name: "WindowRecording",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "window-recording", targets: ["window-recording"]),
    ],
    targets: [
        // The declarations of macOS's virtual display classes, which no public header holds.
        .target(name: "VirtualDisplay"),
        .target(name: "WindowRecording", dependencies: ["VirtualDisplay"]),
        .executableTarget(
            name: "window-recording",
            dependencies: ["WindowRecording"],
            exclude: ["Info.plist"],
            linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist])]
        ),
        .testTarget(name: "WindowRecordingTests", dependencies: ["WindowRecording"]),
    ],
    swiftLanguageModes: [.v5]
)
