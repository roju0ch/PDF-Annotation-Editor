// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "PdfIncomingCore",
    platforms: [.macOS(.v12), .iOS(.v13)],
    products: [.library(name: "PdfIncomingCore", targets: ["PdfIncomingCore"])],
    targets: [
        .target(name: "PdfIncomingCore"),
        .testTarget(name: "PdfIncomingCoreTests", dependencies: ["PdfIncomingCore"])
    ]
)
