// swift-tools-version:6.0
// What every Swift Mac app writes for itself: its log, launch at login, the Dock icon while a window is open, the
// native messaging host, the build it runs, a refresh that catches up after the Mac wakes, and a program run with a
// time limit. An Xcode or Swift package app adds this folder, as the kit bun installed holds it, as a local package; a
// bare swiftc build compiles Sources/MacApp into a module of its own (README.md, "Mac app").
import PackageDescription

let package = Package(
    name: "MacApp",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "MacApp", targets: ["MacApp"]),
    ],
    targets: [
        .target(name: "MacApp"),
        .testTarget(name: "MacAppTests", dependencies: ["MacApp"]),
    ]
)
