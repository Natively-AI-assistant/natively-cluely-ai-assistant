import Foundation
@preconcurrency import CoreML
import FluidAudio

// Parakeet TDT on the Apple Neural Engine, for Natively's local STT worker.
//
//   Natively-parakeet --model-dir <dir> --version v2|v3
//
// <dir> holds the CoreML bundles Natively downloaded (see
// electron/audio/whisper/parakeet/downloadFiles.ts). This process never
// downloads anything and never touches the network.
//
// stdin, binary, one request per frame (little-endian):
//   UInt32 requestId, UInt32 sampleCount, sampleCount x Float32 (16 kHz mono, -1...1)
// stdout, JSON lines:
//   {"type":"ready","loadMs":N}
//   {"type":"result","id":N,"text":"...","ms":N}
//   {"type":"error","id":N,"message":"..."}   one request failed; keep going
//   {"type":"fatal","message":"..."}          then exit(1)
// EOF on stdin is the shutdown signal: the parent closing the pipe (or dying)
// always ends this process, so it can never outlive the worker that owns it.

/// stdout is the protocol channel. FluidAudio and CoreML log to stderr, but to
/// make that a guarantee rather than an observation, the protocol writes go to
/// a private duplicate of fd 1 and fd 1 itself is pointed at stderr.
let protocolFd: Int32 = {
    let fd = dup(STDOUT_FILENO)
    dup2(STDERR_FILENO, STDOUT_FILENO)
    return fd
}()

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    var line = data
    line.append(0x0A)
    line.withUnsafeBytes { raw in
        var offset = 0
        while offset < raw.count {
            let n = write(protocolFd, raw.baseAddress! + offset, raw.count - offset)
            if n <= 0 { exit(0) } // parent gone
            offset += n
        }
    }
}

/// Reads exactly `count` bytes from stdin; nil on EOF.
func readExactly(_ count: Int) -> [UInt8]? {
    var buffer = [UInt8](repeating: 0, count: count)
    var offset = 0
    while offset < count {
        let n = buffer.withUnsafeMutableBytes { raw in
            read(STDIN_FILENO, raw.baseAddress! + offset, count - offset)
        }
        if n == 0 { return nil }
        if n < 0 {
            if errno == EINTR { continue }
            return nil
        }
        offset += n
    }
    return buffer
}

func uint32LE(_ bytes: [UInt8], at index: Int) -> UInt32 {
    UInt32(bytes[index]) | UInt32(bytes[index + 1]) << 8 | UInt32(bytes[index + 2]) << 16 | UInt32(bytes[index + 3]) << 24
}

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

/// The worker never sends more than one open speech segment, but a corrupt
/// header must not make this process allocate gigabytes. 10 minutes of audio.
let maxSamples = 16_000 * 600
/// FluidAudio rejects audio under 0.3 s, and anything up to 15 s runs as one
/// padded encoder window anyway, so padding short audio with silence to 1 s
/// costs nothing and keeps a short utterance from being dropped.
let minSamples = 16_000

@main
struct ParakeetANE {
    static func main() async {
        guard let dir = argument("--model-dir") else {
            emit(["type": "fatal", "message": "--model-dir is required"])
            exit(2)
        }
        let version: AsrModelVersion
        switch argument("--version") {
        case "v2": version = .v2
        case "v3": version = .v3
        default:
            emit(["type": "fatal", "message": "--version must be v2 or v3"])
            exit(2)
        }

        let manager: AsrManager
        do {
            let started = Date()
            // loadLocal never downloads, and never deletes the folder on a
            // load failure (FluidAudio's load(from:) does both).
            let models = try AsrModels.loadLocal(from: URL(fileURLWithPath: dir), version: version)
            manager = AsrManager(config: ASRConfig(tdtConfig: TdtConfig(blankId: version.blankId)))
            try await manager.loadModels(models)
            emit(["type": "ready", "loadMs": Int(Date().timeIntervalSince(started) * 1000)])
        } catch {
            emit(["type": "fatal", "message": "Failed to load Parakeet CoreML models: \(error.localizedDescription)"])
            exit(1)
        }

        while let header = readExactly(8) {
            let id = uint32LE(header, at: 0)
            let count = Int(uint32LE(header, at: 4))
            guard count <= maxSamples else {
                emit(["type": "fatal", "message": "Request \(id) declares \(count) samples (limit \(maxSamples))"])
                exit(1)
            }
            guard let payload = readExactly(count * 4) else { break }
            var samples = [Float](repeating: 0, count: max(count, minSamples))
            samples.withUnsafeMutableBytes { dst in
                payload.withUnsafeBytes { src in
                    dst.copyMemory(from: UnsafeRawBufferPointer(rebasing: src[0..<(count * 4)]))
                }
            }
            do {
                let started = Date()
                // A fresh decoder state per request: every request is a
                // complete, independent utterance (the ONNX engine resets too).
                var state = TdtDecoderState.make(decoderLayers: version.decoderLayers)
                let result = try await manager.transcribe(samples, decoderState: &state)
                emit([
                    "type": "result",
                    "id": Int(id),
                    "text": result.text,
                    "ms": Int(Date().timeIntervalSince(started) * 1000),
                ])
            } catch {
                emit(["type": "error", "id": Int(id), "message": error.localizedDescription])
            }
        }
        exit(0)
    }
}
