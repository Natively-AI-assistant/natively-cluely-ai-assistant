import Foundation
@preconcurrency import Speech
@preconcurrency import AVFoundation

// JSON-lines IPC; only PCM and transcripts cross the process boundary.
// SpeechAnalyzer runs entirely on device. Asset installation may use the network.
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(Data(line.utf8))
}
struct BridgeError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Carries a transcriber failure from the results task back to the main loop.
///
/// The results task used to call exit(1) itself. That was a second exit path
/// running on a background task: it bypassed main()'s error handler, skipped
/// every defer, and could in principle fire for a session a flush had already
/// replaced — killing a healthy process over the teardown of one being
/// discarded. (Measured: that teardown does not throw in practice — four
/// flush-restart cycles produced zero catches — so this is about having one
/// exit path, not about a failure seen in the wild.)
///
/// The main loop reads audio lines continuously, so it observes a failure
/// within one chunk (~100ms at the sizes Natively sends) and throws it from
/// the one place that already knows how to report and exit.
final class FailureBox: @unchecked Sendable {
    private let lock = NSLock()
    private var message: String?
    /// First failure wins; later noise during teardown cannot overwrite it.
    func set(_ value: String) {
        lock.lock(); defer { lock.unlock() }
        if message == nil { message = value }
    }
    var current: String? {
        lock.lock(); defer { lock.unlock() }
        return message
    }
}

final class OneShotPCMInput: @unchecked Sendable {
    private var buffer: AVAudioPCMBuffer?
    init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    func take(_ status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        guard let buffer else {
            status.pointee = .noDataNow
            return nil
        }
        self.buffer = nil
        status.pointee = .haveData
        return buffer
    }
}

func flushConverter(
    _ converter: AVAudioConverter,
    to format: AVAudioFormat,
    continuation: AsyncStream<AnalyzerInput>.Continuation
) throws {
    var emptyPasses = 0
    for _ in 0..<64 {
        let converted = AVAudioPCMBuffer(pcmFormat:format,frameCapacity:4096)!
        var conversionError: NSError?
        let status = converter.convert(to:converted,error:&conversionError) { _, outStatus in
            outStatus.pointee = .endOfStream
            return nil
        }
        if status == .error {
            throw conversionError ?? BridgeError(message:"Audio conversion flush failed") as NSError
        }
        if converted.frameLength > 0 {
            emptyPasses = 0
            continuation.yield(AnalyzerInput(buffer:converted))
        } else {
            emptyPasses += 1
        }
        if status == .endOfStream { return }
        if emptyPasses >= 2 {
            throw BridgeError(message:"Audio converter did not finish flushing")
        }
    }
    throw BridgeError(message:"Audio converter exceeded its flush limit")
}

@main struct AppleSpeechHelper {
    static func main() async {
        // `--locales` is a one-shot query used by Settings to show which
        // languages Apple can transcribe and which still need a download.
        // It never starts an analyzer, so it is cheap to call on demand.
        // `--install <bcp47>` downloads one language asset and streams progress
        // so Settings can show a bar instead of a silent wait. Apple reports a
        // fraction only — Progress.totalUnitCount is 1, not a byte count, and
        // localizedAdditionalDescription is empty — so there is no size to report.
        if let i = CommandLine.arguments.firstIndex(of: "--release"),
           i + 1 < CommandLine.arguments.count {
            do { try await releaseLocale(CommandLine.arguments[i + 1]) }
            catch { emit(["type":"error", "message":error.localizedDescription]); exit(1) }
            return
        }
        if let i = CommandLine.arguments.firstIndex(of: "--install"),
           i + 1 < CommandLine.arguments.count {
            do { try await installLocale(CommandLine.arguments[i + 1]) }
            catch { emit(["type":"error", "message":error.localizedDescription]); exit(1) }
            return
        }
        if CommandLine.arguments.contains("--locales") {
            do { try await emitLocales() }
            catch { emit(["type":"error", "message":error.localizedDescription]); exit(1) }
            return
        }
        do { try await run() }
        catch { emit(["type":"error", "message":error.localizedDescription]); exit(1) }
    }

    static func installLocale(_ requested: String) async throws {
        guard #available(macOS 26.0, *), SpeechTranscriber.isAvailable else {
            throw BridgeError(message:"Apple Speech requires macOS 26 and supported Apple hardware.")
        }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo:Locale(identifier:requested)) else {
            throw BridgeError(message:"Apple Speech does not support language \(requested).")
        }
        let transcriber = SpeechTranscriber(locale:locale,preset:.progressiveTranscription)
        guard let request = try await AssetInventory.assetInstallationRequest(supporting:[transcriber]) else {
            // Already installed — report one completed step so the UI can settle.
            emit(["type":"install-progress", "locale":locale.identifier(.bcp47), "fraction":1.0])
            emit(["type":"install-done", "locale":locale.identifier(.bcp47)])
            return
        }
        let progress = request.progress
        let reporter = Task {
            var last = -1.0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 300_000_000)
                let f = progress.fractionCompleted
                // Only emit on change; a stalled download should not spam stdout.
                if f != last {
                    last = f
                    emit(["type":"install-progress", "locale":locale.identifier(.bcp47), "fraction":f])
                }
            }
        }
        defer { reporter.cancel() }
        try await request.downloadAndInstall()
        emit(["type":"install-progress", "locale":locale.identifier(.bcp47), "fraction":1.0])
        emit(["type":"install-done", "locale":locale.identifier(.bcp47)])
    }

    /// Free one allocated locale at the user's explicit request.
    ///
    /// Apple caps an app at AssetInventory.maximumReservedLocales (5) and an
    /// installation permanently takes a slot, so a sixth language fails with
    /// "Too many allocated locales, 5 maximum" and nothing recovers it. This is
    /// the only way back — but it is DESTRUCTIVE: releasing purged zh-CN from
    /// installedLocales outright in testing, so the language has to be
    /// downloaded again afterwards. That is why it is never done automatically
    /// to make room; the user is asked which language to give up.
    static func releaseLocale(_ requested: String) async throws {
        guard #available(macOS 26.0, *), SpeechTranscriber.isAvailable else {
            throw BridgeError(message:"Apple Speech requires macOS 26 and supported Apple hardware.")
        }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo:Locale(identifier:requested)) else {
            throw BridgeError(message:"Apple Speech does not support language \(requested).")
        }
        let released = await AssetInventory.release(reservedLocale: locale)
        emit(["type":"release-done", "locale":locale.identifier(.bcp47), "released":released])
    }

    static func emitLocales() async throws {
        guard #available(macOS 26.0, *), SpeechTranscriber.isAvailable else {
            emit(["type":"locales", "supported":[], "installed":[], "available":false])
            return
        }
        let supported = await SpeechTranscriber.supportedLocales
        let installed = await SpeechTranscriber.installedLocales
        let reserved = await AssetInventory.reservedLocales
        emit([
            "type":"locales",
            "available":true,
            "supported":supported.map { $0.identifier(.bcp47) },
            "installed":installed.map { $0.identifier(.bcp47) },
            "reserved":reserved.map { $0.identifier(.bcp47) },
            "maxReserved":AssetInventory.maximumReservedLocales,
        ])
    }
    static func run() async throws {
        guard #available(macOS 26.0, *), SpeechTranscriber.isAvailable else {
            throw BridgeError(message:"Apple Speech requires macOS 26 and supported Apple hardware.")
        }
        guard let first = readLine(), let data = first.data(using:.utf8),
              let config = try JSONSerialization.jsonObject(with:data) as? [String:Any],
              config["type"] as? String == "init" else {
            throw BridgeError(message:"Expected init message")
        }
        let requested = config["locale"] as? String ?? Locale.current.identifier
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo:Locale(identifier:requested)) else {
            throw BridgeError(message:"Apple Speech does not support language \(requested). Choose a supported language in Audio settings.")
        }
        let transcriber = SpeechTranscriber(locale:locale,preset:.progressiveTranscription)
        // installedLocales is authoritative for shared system assets; status alone
        // may report 'supported' for an already installed locale on macOS 26.
        let installed = await SpeechTranscriber.installedLocales
        if !installed.contains(locale) {
            emit([
                "type":"status",
                "phase":"asset-download",
                "message":"Downloading Apple speech model for \(locale.identifier(.bcp47))…"
            ])
                if let request = try await AssetInventory.assetInstallationRequest(supporting:[transcriber]) {
                try await request.downloadAndInstall()
            }
        }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:[transcriber]) else {
            throw BridgeError(message:"Apple speech model is unavailable for \(locale.identifier(.bcp47)).")
        }
        // One analysis session. A `flush` ends the current session cleanly and
        // starts the next: SpeechAnalyzer.finalize(through:) cannot be used to
        // force a final mid-stream — measured, it destroys recognition of the
        // audio that follows (11% word recall vs 100% without it) and hangs
        // outright when given an explicit boundary time.
        let failure = FailureBox()
        func startSession() async throws -> (SpeechAnalyzer, AsyncStream<AnalyzerInput>.Continuation, Task<Void, Never>) {
            let t = SpeechTranscriber(locale:locale,preset:.progressiveTranscription)
            let a = SpeechAnalyzer(modules:[t])
            let (i, c) = AsyncStream<AnalyzerInput>.makeStream()
            try await a.prepareToAnalyze(in:format)
            let r = Task {
                do {
                    for try await result in t.results {
                        emit(["type":"transcript", "text":String(result.text.characters), "isFinal":result.isFinal])
                    }
                } catch {
                    // Report, do not terminate: main() owns the single exit path.
                    failure.set(error.localizedDescription)
                }
            }
            try await a.start(inputSequence:i)
            return (a, c, r)
        }
        var (analyzer, continuation, results) = try await startSession()
        emit(["type":"ready", "locale":locale.identifier(.bcp47), "sampleRate":format.sampleRate])
        var converter: AVAudioConverter?
        var inputFormat: AVAudioFormat?
        while let line = readLine() {
            // Surface a transcriber failure from the results task at the next
            // audio chunk, through the one handler that reports and exits.
            if let message = failure.current { throw BridgeError(message: message) }
            guard line.utf8.count < 2_000_000, let data = line.data(using:.utf8),
                  let message = try JSONSerialization.jsonObject(with:data) as? [String:Any] else {
                throw BridgeError(message:"Invalid audio message")
            }
            let type = message["type"] as? String
            if type == "stop" { break }
            if type == "flush" {
                if let converter { try flushConverter(converter,to:format,continuation:continuation) }
                converter = nil
                inputFormat = nil
                // End this session through its real end-of-input (the only
                // finalization path Apple honours without corrupting what
                // follows), drain its results, then open a fresh session so
                // the next words are recognised normally.
                continuation.finish()
                try await analyzer.finalizeAndFinishThroughEndOfInput()
                await results.value
                (analyzer, continuation, results) = try await startSession()
                continue
            }
            guard type == "audio", let encoded = message["pcm"] as? String,
                  let pcm = Data(base64Encoded:encoded), pcm.count % 2 == 0,
                  let rate = message["sampleRate"] as? Double, rate >= 8000, rate <= 192000 else {
                throw BridgeError(message:"Expected mono Int16 PCM with a valid sample rate")
            }
            if pcm.isEmpty { continue }
            let source = AVAudioFormat(commonFormat:.pcmFormatInt16,sampleRate:rate,channels:1,interleaved:false)!
            let buffer = AVAudioPCMBuffer(pcmFormat:source,frameCapacity:AVAudioFrameCount(pcm.count/2))!
            buffer.frameLength = buffer.frameCapacity
            pcm.withUnsafeBytes { raw in
                buffer.int16ChannelData![0].update(from:raw.bindMemory(to:Int16.self).baseAddress!,count:pcm.count/2)
            }
            if source == format {
                if let converter { try flushConverter(converter,to:format,continuation:continuation) }
                converter = nil
                inputFormat = nil
                continuation.yield(AnalyzerInput(buffer:buffer))
            } else {
                if inputFormat != source {
                    if let converter { try flushConverter(converter,to:format,continuation:continuation) }
                    inputFormat = source
                    converter = AVAudioConverter(from:source,to:format)
                }
                guard let converter else { throw BridgeError(message:"Unsupported input audio format") }
                let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength)*format.sampleRate/rate)+512)
                let converted = AVAudioPCMBuffer(pcmFormat:format,frameCapacity:capacity)!
                let input = OneShotPCMInput(buffer)
                var conversionError: NSError?
                let status = converter.convert(to:converted,error:&conversionError) { _, outStatus in
                    input.take(outStatus)
                }
                if status == .error { throw conversionError ?? BridgeError(message:"Audio conversion failed") as NSError }
                if converted.frameLength > 0 { continuation.yield(AnalyzerInput(buffer:converted)) }
            }
        }
        if let converter { try flushConverter(converter,to:format,continuation:continuation) }
        continuation.finish()
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        await results.value
        if let message = failure.current { throw BridgeError(message: message) }
        emit(["type":"stopped"])
    }
}
