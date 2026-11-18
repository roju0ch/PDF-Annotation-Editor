// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "tauri-plugin-ios-bridge",
    platforms: [.macOS(.v12), .iOS(.v13)],
    products: [
        .library(
            name: "tauri-plugin-ios-bridge",
            type: .static,
            targets: ["tauri-plugin-ios-bridge"]
        )
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        .package(name: "PdfIncomingCore", path: "../core")
    ],
    targets: [
        .target(
            name: "tauri-plugin-ios-bridge",
            dependencies: [.byName(name: "Tauri"), .byName(name: "PdfIncomingCore")],
            path: "Sources"
        )
    ]
)
