// swift-tools-version:6.2
// Neural Engine helper for the local Parakeet TDT models (macOS, Apple Silicon).
// Built by scripts/build-parakeet-ane.js; never by the ordinary Electron build.
import PackageDescription

let package = Package(
    name: "ParakeetANE",
    platforms: [.macOS(.v14)],
    dependencies: [
        // Apache-2.0. Pinned exactly: the CoreML file names the helper loads
        // (and Natively downloads) are versioned with the library.
        // `traits: []` opts out of the NemoTextProcessing trait, a prebuilt
        // Rust binary used only for TTS text normalization; ASR does not need
        // it, and without it the helper is built entirely from source.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7", traits: []),
    ],
    targets: [
        .executableTarget(
            name: "ParakeetANE",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            path: "Sources/ParakeetANE"
        ),
    ]
)
