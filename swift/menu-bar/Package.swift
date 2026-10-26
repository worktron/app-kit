// swift-tools-version:6.0
// The menu bar theme: the console family's look for a Swift menu bar app. An Xcode or Swift package app adds this
// folder, as the kit bun installed holds it, as a local package; a bare swiftc build compiles Sources/MenuBarTheme into
// a module of its own (README.md, "Menu bar theme").
import PackageDescription

let package = Package(
    name: "MenuBarTheme",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "MenuBarTheme", targets: ["MenuBarTheme"]),
        .executable(name: "menu-bar-snapshots", targets: ["menu-bar-snapshots"]),
    ],
    targets: [
        .target(name: "MenuBarTheme", resources: [.copy("Fonts")]),
        .executableTarget(name: "menu-bar-snapshots", dependencies: ["MenuBarTheme"]),
        .testTarget(name: "MenuBarThemeTests", dependencies: ["MenuBarTheme", "menu-bar-snapshots"]),
    ]
)
