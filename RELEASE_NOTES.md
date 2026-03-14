## Summary

Version 2.0.4 introduces a massive architectural overhaul to the native audio pipeline, guaranteeing production-ready stability, true zero-allocation data transfer, and instantaneous STT responsiveness with WebRTC ML-based VAD.

## What's New

- **Two-Stage Silence Processing**: Replaced basic RMS noise gating with a two-stage pipeline combining an adaptive RMS threshold and WebRTC Machine Learning VAD. Rejects typing, fan noise, and non-speech sounds before they bill STT APIs.
- **Zero-Copy ABI Transfers**: Transitioned the `ThreadsafeFunction` bridging to direct `napi::Buffer` (Uint8Array) allocations, completely eliminating V8 garbage collection pressure during continuous capture.
- **Sliding-Window RAG**: Implemented a 50-token semantic overlap in `SemanticChunker.ts` to prevent conversational context loss across chunk boundaries.

## Improvements

- **Latency & Responsiveness Tuning**: Stripped redundant TS debouncing, slashed `MIN_BUFFER_BYTES`, and reduced native hangover, achieving a ~300ms reduction in end-to-end transcription latency. short utterances ("Yes", "Stop") no longer sit trapped in the buffer.
- Removed floating-point division truncation for superior downsampling from 44.1kHz external microphones.

## Fixes

- Fixed a critical bug where the native Rust monitor returned a hardcoded `16000Hz` while actually streaming 48kHz audio. Now syncs true hardware sample rates.
- Resolved the "Input missing" silent crash bug on microphone restarts by properly recreating the CPAL stream.
- Restored the 10s continuous speech backstop for REST APIs to prevent unbounded buffer growth.
- Added missing `notifySpeechEnded()` properties and cleaned up dangerous type casts.

## Technical

- Audio processing transitioned entirely to strict ABI memory bridging (`napi::Buffer`)
- Re-architected native silence_suppression state machine around WebRTC VAD inputs.

## ⚠️macOS Installation (Unsigned Build)

Download the correct architecture .zip or .dmg file for your device (Apple Silicon or Intel).

If you see "App is damaged":

- **For .zip downloads:**
  1. Move the app to your Applications folder.
  2. Open Terminal and run: `xattr -cr /Applications/Natively.app`

- **For .dmg downloads:**
  1. Open Terminal and run:
     ```bash
     xattr -cr ~/Downloads/Natively-2.0.4-arm64.dmg
     # Or for Intel Macs:
     xattr -cr ~/Downloads/Natively-2.0.4.dmg
     ```
  2. Install the natively.dmg
  3. Open Terminal and run: `xattr -cr /Applications/Natively.app`
