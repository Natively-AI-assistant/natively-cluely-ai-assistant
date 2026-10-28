// swift-tools-version:6.2
// Neural Engine helper for the local Parakeet TDT models (macOS, Apple Silicon).
// Built by scripts/build-parakeet-ane.js; never by the ordinary Electron build.
import PackageDescription

// FluidAudio (Apache-2.0) is compiled from source in FluidAudio/, which the
// build script fetches at the commit it pins (FLUIDAUDIO in
// scripts/build-parakeet-ane.js) and verifies. It is not a SwiftPM package
// dependency on purpose: SwiftPM downloads every binary target a dependency
// declares, traits or not, and FluidAudio declares a prebuilt Rust
// xcframework (~87 MB, TTS text normalization only) this helper never links.
// These targets mirror FluidAudio's own manifest without it, which is the
// same as its `traits: []` opt-out: the NemoTextProcessing code compiles out.
let fluidAudio = "FluidAudio/Sources"

let package = Package(
    name: "ParakeetANE",
    platforms: [.macOS(.v14)],
    targets: [
        .target(
            name: "FluidAudio",
            dependencies: ["FastClusterWrapper", "MachTaskSelfWrapper"],
            path: "\(fluidAudio)/FluidAudio",
            exclude: ["ASR/Parakeet/Unified/benchmark.md"],
            resources: [.process("TTS/LuxTts/G2p/Resources")],
            // Third-party code: quiet, as SwiftPM keeps a package dependency.
            swiftSettings: [.unsafeFlags(["-suppress-warnings"])]
        ),
        .target(
            name: "FastClusterWrapper",
            path: "\(fluidAudio)/FastClusterWrapper",
            publicHeadersPath: "include",
            cxxSettings: [.unsafeFlags(["-w"])]
        ),
        .target(
            name: "MachTaskSelfWrapper",
            path: "\(fluidAudio)/MachTaskSelfWrapper",
            publicHeadersPath: "include"
        ),
        .executableTarget(
            name: "ParakeetANE",
            dependencies: ["FluidAudio"],
            path: "Sources/ParakeetANE"
        ),
    ]
)
