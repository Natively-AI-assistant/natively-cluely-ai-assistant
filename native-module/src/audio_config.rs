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

#[cfg(test)]
mod tests {
    use super::*;
    use test_case::test_case;

    #[test]
    fn frame_samples_matches_rate_and_duration() {
        let expected = (SAMPLE_RATE as f64 * FRAME_MS as f64 / 1000.0) as usize;
        assert_eq!(FRAME_SAMPLES, expected);
    }

    #[test]
    fn chunk_samples_is_alias() {
        assert_eq!(CHUNK_SAMPLES, FRAME_SAMPLES);
    }

    #[test_case(185.0, 100.0; "default_thresholds")]
    fn vad_start_above_end(start: f32, end: f32) {
        assert!(
            start > end,
            "VAD start threshold must be above end threshold"
        );
    }

    #[test]
    fn constants_are_nonzero() {
        assert!(SAMPLE_RATE > 0);
        assert!(FRAME_MS > 0);
        assert!(FRAME_SAMPLES > 0);
        assert!(VAD_START_RMS > 0.0);
        assert!(VAD_END_RMS > 0.0);
        assert!(VAD_PREROLL_CHUNKS > 0);
        assert!(VAD_HANGOVER_MS > 0);
        assert!(DSP_POLL_MS > 0);
        assert!(RING_BUFFER_SAMPLES > 0);
    }

    #[test]
    fn ring_buffer_is_power_of_two() {
        let n = RING_BUFFER_SAMPLES;
        assert!(
            n > 0 && (n & (n - 1)) == 0,
            "Ring buffer should be power of 2"
        );
    }

    #[test]
    fn ring_buffer_fits_at_48khz() {
        let duration_ms = (RING_BUFFER_SAMPLES as f64 / 48000.0) * 1000.0;
        assert!(duration_ms > 500.0, "Buffer should hold at least 500ms");
    }
}
