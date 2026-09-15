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
        do { try await run() }
        catch { emit(["type":"error", "message":error.localizedDescription]); exit(1) }
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
        let analyzer = SpeechAnalyzer(modules:[transcriber])
        let (input, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        try await analyzer.prepareToAnalyze(in:format)
        let results = Task {
            do {
                for try await result in transcriber.results {
                    emit(["type":"transcript", "text":String(result.text.characters), "isFinal":result.isFinal])
                }
            } catch {
                emit(["type":"error", "message":error.localizedDescription])
                exit(1)
            }
        }
        try await analyzer.start(inputSequence:input)
        emit(["type":"ready", "locale":locale.identifier(.bcp47), "sampleRate":format.sampleRate])
        var converter: AVAudioConverter?
        var inputFormat: AVAudioFormat?
        while let line = readLine() {
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
                try await analyzer.finalize(through:nil)
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
        emit(["type":"stopped"])
    }
}
