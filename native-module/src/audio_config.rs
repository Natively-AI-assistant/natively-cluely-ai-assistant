// Audio Configuration Constants
// Optimized for low-latency streaming STT

/// Output sample rate for Google STT
pub const SAMPLE_RATE: u32 = 16_000;

/// Frame duration in milliseconds
/// 20ms provides good balance of latency vs overhead
/// - Old: 100ms = 100ms minimum latency
/// - New: 20ms = 20ms minimum latency
pub const FRAME_MS: u32 = 20;

/// Samples per frame at 16kHz
/// 16000 * 0.020 = 320 samples
pub const FRAME_SAMPLES: usize = 320;

// Legacy alias for compatibility during migration
pub const CHUNK_SAMPLES: usize = FRAME_SAMPLES;

/// VAD thresholds (for UI display only - does NOT gate STT audio)
/// These match the Swift implementation values
pub const VAD_START_RMS: f32 = 185.0; // Speech start threshold (~-45dBFS)
pub const VAD_END_RMS: f32 = 100.0; // Speech end threshold (~-50dBFS)

/// VAD preroll chunks to include before speech detection
pub const VAD_PREROLL_CHUNKS: usize = 3;

/// VAD hangover duration in milliseconds
pub const VAD_HANGOVER_MS: u128 = 500;

/// DSP thread poll interval in milliseconds (fallback timeout)
/// Primary wakeup is via Condvar signal from audio callbacks.
/// This only triggers if no audio arrives within the interval.
pub const DSP_POLL_MS: u64 = 5;

/// Ring buffer size in samples
/// 128KB worth of f32 samples = 32768 samples
/// At 48kHz = ~680ms buffer (plenty of headroom)
pub const RING_BUFFER_SAMPLES: usize = 32768;

/// Number of 20ms DSP frames coalesced into a single tsfn (V8 boundary)
/// callback. Each tsfn.call traverses the JS bridge, allocates a Buffer
/// wrapper, and routes through the napi event loop — non-trivial overhead
/// for a 1.9KB chunk. Batching 3 chunks (=60ms of audio) cuts boundary
/// crossings 3x with no perceptible latency cost (STT providers all accept
/// 60-100ms framing). The CHUNK_BATCH_TIMEOUT_MS guard flushes a partial
/// batch when audio is silent so trailing speech is not held up.
pub const CHUNK_BATCH_COUNT: usize = 3;
pub const CHUNK_BATCH_TIMEOUT_MS: u128 = 100;
