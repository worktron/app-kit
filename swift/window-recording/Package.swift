// swift-tools-version:6.0
// The window recording program: it makes a display nobody sees for the length of a run, and records one window on it to
// an mp4 with ScreenCaptureKit, so a video can show a real Chrome window, address bar included, with nothing on the
// owner's screen. command-line/window-recording.ts builds it with `swift build` into app-kit's state folder from the
// kit bun installed and drives it over its standard input and output (README.md, "Window recording").
import PackageDescription

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
        .executableTarget(name: "window-recording", dependencies: ["WindowRecording"]),
        .testTarget(name: "WindowRecordingTests", dependencies: ["WindowRecording"]),
    ],
    swiftLanguageModes: [.v5]
)
