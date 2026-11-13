// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-iphone-dictation",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-iphone-dictation",
      type: .static,
      targets: ["tauri-plugin-iphone-dictation"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-iphone-dictation",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
