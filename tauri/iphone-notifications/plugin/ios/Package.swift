// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-iphone-notifications",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-iphone-notifications",
      type: .static,
      targets: ["tauri-plugin-iphone-notifications"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-iphone-notifications",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
