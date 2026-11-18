// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-iphone-health",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-iphone-health",
      type: .static,
      targets: ["tauri-plugin-iphone-health"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-iphone-health",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
