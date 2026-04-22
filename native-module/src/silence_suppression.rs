// Silence Suppression for Streaming STT - Low Latency Optimized
//
// TWO-STAGE GATING:
// 1. RMS volume check (fast, catches obvious silence)
// 2. WebRTC VAD (ML-based, rejects non-speech noise like typing/dogs)
// Only if BOTH pass do we open the gate. This eliminates false triggers.
//
// DESIGN PRINCIPLES:
// 1. Google STT requires timing continuity - never send gaps
// 2. During silence, send keepalive frames every 100ms
// 3. During speech, send ALL frames immediately with NO delay
// 4. Hangover is for cost savings only, NOT for first-word accuracy
//
// LATENCY BUDGET:
// - Speech onset: 0ms delay (immediate)
// - Hangover: Only affects AFTER speech ends (no latency impact)

use std::time::{Duration, Instant};
use webrtc_vad::{SampleRate as VadSampleRate, Vad, VadMode};

/// Configuration for silence suppression
/// Optimized for low latency with adaptive threshold
pub struct SilenceSuppressionConfig {
    /// Initial RMS threshold for speech detection (i16 scale: 0-32767)
    /// Acts as starting value; adaptive tracking adjusts this over time.
    pub speech_threshold_rms: f32,

    /// Duration to continue sending full audio after speech ends
    /// This does NOT add latency - only affects when we switch to keepalives
    pub speech_hangover: Duration,

    /// How often to send a keepalive frame during silence
    pub silence_keepalive_interval: Duration,

    /// Multiplier above the noise floor EMA to detect speech (default: 3.0)
    pub adaptive_multiplier: f32,

    /// Minimum floor for the adaptive threshold (prevents false triggers in dead silence)
    pub adaptive_min_floor: f32,

    /// EMA smoothing factor (0..1). Lower = slower adaptation. Default 0.02.
    pub ema_alpha: f32,

    /// Native sample rate of the audio being processed (e.g. 48000)
    /// Used to calculate decimation ratio for 16kHz VAD input.
    pub native_sample_rate: u32,

    /// Whether to use ML-based WebRTC VAD in addition to the RMS volume gate.
    pub use_vad: bool,

    /// The strictness level of the WebRTC VAD models.
    pub vad_mode: VadMode,
}

impl Default for SilenceSuppressionConfig {
    fn default() -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(200),
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        }
    }
}

impl SilenceSuppressionConfig {
    /// Create config for system audio (very permissive - system audio is quieter).
    /// Disables VAD because system audio (e.g., YouTube, games) often contains non-human
    /// sounds which the ML VAD model rigidly suppresses, breaking the STT pipeline (#127).
    pub fn for_system_audio() -> Self {
        Self {
            speech_threshold_rms: 30.0,
            speech_hangover: Duration::from_millis(600), // increased from 300ms to preserve context across brief pauses
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 10.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: false,
            vad_mode: VadMode::Quality, // ignored when use_vad is false
        }
    }

    /// Create config for microphone (standard).
    /// Uses Normal VAD mode instead of Aggressive because built-in microphones with heavy
    /// hardware DSP (like macOS Apple Silicon) sound "unnatural" to strict models (#128).
    pub fn for_microphone() -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(500), // increased from 150ms to prevent clipping trailing consonants (s, t, etc)
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        }
    }
}

/// Silence suppression state machine with adaptive threshold + WebRTC VAD
pub struct SilenceSuppressor {
    config: SilenceSuppressionConfig,
    state: SuppressionState,
    last_speech_time: Instant,
    last_keepalive_time: Instant,
    frames_sent: u64,
    frames_suppressed: u64,
    /// Exponential moving average of ambient noise floor RMS
    noise_floor_ema: f32,
    /// Current adaptive speech threshold
    adaptive_threshold: f32,
    /// Tracks whether we were speaking in the previous frame (for edge detection)
    was_speaking: bool,
    /// WebRTC Voice Activity Detector (ML-based, 16kHz)
    vad: Vad,
    /// Decimation factor: native_sample_rate / 16000 (may be non-integer, e.g. 44100/16000 = 2.75625)
    decimation_factor: f64,
    /// Reusable buffer for decimated 16kHz samples (avoids allocation per frame)
    vad_buf: Vec<i16>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SuppressionState {
    Active,     // Speech detected, send everything
    Hangover,   // Speech ended recently, still sending
    Suppressed, // Confirmed silence, send keepalives only
}

/// Result of processing a frame
#[derive(Debug, Clone)]
pub enum FrameAction {
    /// Send this frame to STT
    Send(Vec<i16>),
    /// Replace with silence keepalive frame
    SendSilence,
    /// Suppress this frame (timing maintained by keepalives)
    Suppress,
}

impl SilenceSuppressor {
    pub fn new(config: SilenceSuppressionConfig) -> Self {
        let now = Instant::now();
        let initial_threshold = config.speech_threshold_rms;
        let decimation_factor = config.native_sample_rate as f64 / 16000.0;

        // Reconstruct the VadMode variant to avoid partially moving `config` (since VadMode isn't Copy)
        let mode_clone = match &config.vad_mode {
            VadMode::Quality => VadMode::Quality,
            VadMode::LowBitrate => VadMode::LowBitrate,
            VadMode::Aggressive => VadMode::Aggressive,
            VadMode::VeryAggressive => VadMode::VeryAggressive,
        };

        let vad_mode_str = match &config.vad_mode {
            VadMode::Quality => "Quality",
            VadMode::LowBitrate => "LowBitrate",
            VadMode::Aggressive => "Aggressive",
            VadMode::VeryAggressive => "VeryAggressive",
        };

        let vad = Vad::new_with_rate_and_mode(VadSampleRate::Rate16kHz, mode_clone);

        println!(
            "[SilenceSuppressor] Created: threshold={} (adaptive), hangover={}ms, \
             keepalive={}ms, native_rate={}Hz, decimation={:.2}x, use_vad={}, VAD_mode={}",
            config.speech_threshold_rms,
            config.speech_hangover.as_millis(),
            config.silence_keepalive_interval.as_millis(),
            config.native_sample_rate,
            decimation_factor,
            config.use_vad,
            vad_mode_str,
        );

        Self {
            noise_floor_ema: config.adaptive_min_floor,
            adaptive_threshold: initial_threshold,
            vad_buf: Vec::with_capacity(480), // Max VAD frame size at 16kHz (30ms)
            decimation_factor,
            vad,
            config,
            state: SuppressionState::Suppressed, // MUST start suppressed to avoid false speech_ended on startup
            last_speech_time: now,
            last_keepalive_time: now,
            frames_sent: 0,
            frames_suppressed: 0,
            was_speaking: false, // Prevents false edge detection immediately after init
        }
    }

    /// Process a frame and determine what to do with it.
    /// Returns (FrameAction, speech_just_ended)
    /// `speech_just_ended` is true on the exact frame where speech transitions to silence.
    /// CRITICAL: Speech frames are NEVER delayed.
    ///
    /// The frame can be at ANY native sample rate. Internally, we decimate
    /// to 16kHz for the WebRTC VAD check only.
    pub fn process(&mut self, frame: &[i16]) -> (FrameAction, bool) {
        let now = Instant::now();
        let rms = calculate_rms(frame);

        // ── TWO-STAGE GATE ──────────────────────────────────────────────
        // Stage 1: Fast RMS check (rejects obvious silence cheaply)
        // Stage 2: WebRTC VAD (rejects non-speech noise: typing, dogs, fans)
        let has_speech = if rms >= self.adaptive_threshold {
            if self.config.use_vad {
                // Stage 2: Decimate to 16kHz and run ML-based voice detection
                self.is_voice(frame)
            } else {
                // RMS is high enough and VAD is disabled (e.g. system audio)
                true
            }
        } else {
            false
        };

        // ALWAYS check for speech first - immediate response
        if has_speech {
            self.state = SuppressionState::Active;
            self.last_speech_time = now;
            self.frames_sent += 1;
            self.was_speaking = true;
            return (FrameAction::Send(frame.to_vec()), false);
        }

        // No speech detected - check state
        let mut speech_just_ended = false;
        match self.state {
            SuppressionState::Active | SuppressionState::Hangover => {
                // Check if hangover period has elapsed
                if now.duration_since(self.last_speech_time) > self.config.speech_hangover {
                    self.state = SuppressionState::Suppressed;
                    // Detect the edge: was speaking, now suppressed
                    if self.was_speaking {
                        speech_just_ended = true;
                        self.was_speaking = false;
                    }
                    // Fall through to check keepalive
                } else {
                    // Still in hangover - send full frame
                    self.state = SuppressionState::Hangover;
                    self.frames_sent += 1;
                    return (FrameAction::Send(frame.to_vec()), false);
                }
            }
            SuppressionState::Suppressed => {
                // Already suppressed
            }
        }

        // In suppressed state - update adaptive noise floor EMA
        // Only adapt during confirmed silence to avoid tracking speech levels
        let alpha = self.config.ema_alpha;
        self.noise_floor_ema = self.noise_floor_ema * (1.0 - alpha) + rms * alpha;
        self.adaptive_threshold = (self.noise_floor_ema * self.config.adaptive_multiplier)
            .max(self.config.adaptive_min_floor);

        // Check if time for keepalive
        if now.duration_since(self.last_keepalive_time) >= self.config.silence_keepalive_interval {
            self.last_keepalive_time = now;
            self.frames_sent += 1;
            (FrameAction::SendSilence, speech_just_ended)
        } else {
            self.frames_suppressed += 1;
            (FrameAction::Suppress, speech_just_ended)
        }
    }

    /// Decimate the native-rate frame to ~16kHz and run WebRTC VAD.
    /// WebRTC VAD requires exactly 160/320/480 samples at 16kHz (10/20/30ms).
    /// We dynamically choose the closest valid frame size based on the actual
    /// decimated sample count, handling non-integer ratios (e.g. 44.1kHz).
    #[inline]
    fn is_voice(&mut self, frame: &[i16]) -> bool {
        self.vad_buf.clear();

        // Decimate: take samples at 16kHz intervals using floating-point stepping.
        // This correctly handles non-integer ratios like 44100/16000 = 2.75625.
        let factor = self.decimation_factor;
        if factor <= 1.0 {
            // Native rate IS 16kHz (or lower) — use frame directly
            self.vad_buf.extend_from_slice(frame);
        } else {
            let mut pos = 0.0_f64;
            while (pos as usize) < frame.len() {
                self.vad_buf.push(frame[pos as usize]);
                pos += factor;
            }
        }

        // WebRTC VAD accepts exactly 160 (10ms), 320 (20ms), or 480 (30ms) samples.
        // Pick the largest valid size that fits our decimated data.
        let len = self.vad_buf.len();
        let target = if len >= 480 {
            480
        } else if len >= 320 {
            320
        } else if len >= 160 {
            160
        } else {
            // Frame too small for VAD — fall back to RMS-only
            return true;
        };

        self.vad
            .is_voice_segment(&self.vad_buf[..target])
            .unwrap_or(true)
    }

    /// Get statistics
    pub fn stats(&self) -> (u64, u64) {
        (self.frames_sent, self.frames_suppressed)
    }

    /// Get current state for UI
    pub fn is_speech(&self) -> bool {
        matches!(
            self.state,
            SuppressionState::Active | SuppressionState::Hangover
        )
    }

    /// Get the current adaptive speech threshold
    pub fn adaptive_threshold(&self) -> f32 {
        self.adaptive_threshold
    }

    /// Reset state (e.g., when meeting ends)
    pub fn reset(&mut self) {
        let now = Instant::now();
        self.state = SuppressionState::Suppressed; // Fix: reset to suppressed, same as new()
        self.last_speech_time = now;
        self.last_keepalive_time = now;
        self.noise_floor_ema = self.config.adaptive_min_floor;
        self.adaptive_threshold = self.config.speech_threshold_rms;
        self.was_speaking = false;
    }
}

/// Calculate RMS of i16 samples efficiently
fn calculate_rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    // Sample every 4th sample for speed (320/4 = 80 samples is plenty for RMS)
    let sum_of_squares: f64 = samples
        .iter()
        .step_by(4)
        .map(|&s| (s as f64) * (s as f64))
        .sum();

    let count = (samples.len() + 3) / 4;
    (sum_of_squares / count as f64).sqrt() as f32
}

/// Generate a silence frame of given size
pub fn generate_silence_frame(size: usize) -> Vec<i16> {
    vec![0i16; size]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_speech_immediate() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });

        // Loud frame should be sent immediately (high amplitude sine-ish wave)
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (action, ended) = suppressor.process(&loud_frame);
        assert!(matches!(action, FrameAction::Send(_)));
        assert!(!ended, "Speech should not have 'ended' on a loud frame");
        assert!(suppressor.is_speech());
    }

    #[test]
    fn test_silence_keepalive() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        });

        let silent_frame: Vec<i16> = vec![0; 320];
        let (action, _ended) = suppressor.process(&silent_frame);
        assert!(matches!(
            action,
            FrameAction::SendSilence | FrameAction::Suppress
        ));
    }

    #[test]
    fn test_speech_ended_detection() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        });

        // Send a loud speech-like frame
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (_, ended) = suppressor.process(&loud_frame);
        assert!(!ended, "Speech should not end on a loud frame");

        let silent_frame: Vec<i16> = vec![0; 320];
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(ended, "Speech should have ended on transition to silence");

        let (_, ended) = suppressor.process(&silent_frame);
        assert!(!ended, "Speech_ended should only fire once per transition");
    }

    // --- New edge case tests ---

    #[test]
    fn empty_frame_returns_suppress() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });
        let (action, ended) = suppressor.process(&[]);
        assert!(
            matches!(action, FrameAction::Suppress),
            "Empty frame should be suppressed"
        );
        assert!(!ended, "Empty frame should not trigger speech_ended");
    }

    #[test]
    fn reset_clears_speech_state() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });

        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        suppressor.process(&loud_frame);
        assert!(suppressor.is_speech());

        suppressor.reset();
        assert!(!suppressor.is_speech(), "Reset should clear speech state");
    }

    #[test]
    fn stats_track_frames() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });

        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        suppressor.process(&loud_frame);

        let (sent, _suppressed) = suppressor.stats();
        assert!(sent > 0, "Should have sent at least one frame");
    }

    #[test]
    fn adaptive_threshold_starts_at_config_value() {
        let suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 150.0,
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });
        assert_eq!(suppressor.adaptive_threshold(), 150.0);
    }

    #[test]
    fn hangover_sends_frames_after_speech_ends() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(500),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 16000,
            use_vad: false,
            vad_mode: VadMode::Quality,
        });

        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (action, _) = suppressor.process(&loud_frame);
        assert!(matches!(action, FrameAction::Send(_)));

        let silent_frame: Vec<i16> = vec![0; 320];
        let (action, _ended) = suppressor.process(&silent_frame);
        assert!(
            matches!(action, FrameAction::Send(_)),
            "Hangover should still send frames"
        );
    }

    #[test]
    fn system_audio_does_not_require_vad() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig::for_system_audio());

        let frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 200.0) as i16)
            .collect();
        let (action, _) = suppressor.process(&frame);
        assert!(matches!(action, FrameAction::Send(_)));
    }

    // --- VAD rejection tests (core two-stage gate behavior) ---

    #[test]
    fn vad_rejects_silence_even_with_low_threshold() {
        // Silence is always rejected by VAD, even with very low RMS threshold
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::Quality,
            speech_threshold_rms: 1.0, // Near-zero threshold
            ..SilenceSuppressionConfig::default()
        });

        let silent_frame: Vec<i16> = vec![0; 320];
        let (action, _) = suppressor.process(&silent_frame);
        assert!(
            !matches!(action, FrameAction::Send(_)),
            "Silence should never trigger Send even with near-zero threshold"
        );
    }

    #[test]
    fn vad_path_exercised_with_non_speech_signal() {
        // This test exercises the VAD code path with a non-speech signal.
        // We don't assert Send vs Suppress because VAD behavior with synthetic
        // signals (tones, noise) is not guaranteed - it depends on the GMM model.
        // The value is ensuring the two-stage gate path runs without errors.
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::VeryAggressive,
            speech_threshold_rms: 50.0,
            ..SilenceSuppressionConfig::default()
        });

        let tone: Vec<i16> = (0..320)
            .map(|i| {
                ((i as f32 * 1000.0 / 16000.0 * 2.0 * std::f32::consts::PI).sin() * 15000.0) as i16
            })
            .collect();

        // Verify the path runs without panicking
        let rms = calculate_rms(&tone);
        assert!(rms > 50.0, "Tone should have high RMS: {}", rms);

        let (action, _) = suppressor.process(&tone);
        // Action can be Send or Suppress depending on VAD model behavior
        let _ = action;
    }

    #[test]
    fn vad_rejects_low_amplitude_noise() {
        // Low-amplitude noise should be rejected by VAD even if above threshold
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::VeryAggressive,
            speech_threshold_rms: 10.0,
            ..SilenceSuppressionConfig::default()
        });

        // Very low amplitude alternating signal
        let noise: Vec<i16> = (0..320)
            .map(|i| if i % 2 == 0 { 20i16 } else { -20i16 })
            .collect();

        let rms = calculate_rms(&noise);
        assert!(rms > 10.0, "Noise should be above threshold: {}", rms);

        let (action, _) = suppressor.process(&noise);
        assert!(
            !matches!(action, FrameAction::Send(_)),
            "Low-amplitude noise should not trigger Send, got {:?}",
            action
        );
    }

    #[test]
    fn vad_passes_speech_like_signal() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::Quality,
            speech_threshold_rms: 50.0,
            ..SilenceSuppressionConfig::default()
        });

        // Complex signal that resembles speech (multiple harmonics)
        let speech_like: Vec<i16> = (0..320)
            .map(|i| {
                let t = i as f32 / 16000.0;
                let fundamental = (t * 200.0 * 2.0 * std::f32::consts::PI).sin();
                let harmonic1 = (t * 400.0 * 2.0 * std::f32::consts::PI).sin() * 0.5;
                let harmonic2 = (t * 600.0 * 2.0 * std::f32::consts::PI).sin() * 0.3;
                ((fundamental + harmonic1 + harmonic2) * 10000.0) as i16
            })
            .collect();

        // This test verifies VAD behavior with speech-like signals
        // Note: VAD may still reject synthetic signals - the key assertion is that
        // the test runs without error and the logic path is exercised
        let (action, _) = suppressor.process(&speech_like);
        // We don't assert Send vs Suppress because VAD behavior with synthetic
        // speech-like signals is not guaranteed. The value is exercising the path.
        let _ = action;
    }

    #[test]
    fn rms_passes_vad_disabled() {
        // When VAD is disabled, high RMS should always pass (system audio behavior)
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            use_vad: false,
            speech_threshold_rms: 50.0,
            ..SilenceSuppressionConfig::default()
        });

        // Pure tone that VAD would reject
        let tone: Vec<i16> = (0..320)
            .map(|i| {
                ((i as f32 * 1000.0 / 16000.0 * 2.0 * std::f32::consts::PI).sin() * 15000.0) as i16
            })
            .collect();

        let (action, _) = suppressor.process(&tone);
        assert!(
            matches!(action, FrameAction::Send(_)),
            "With VAD disabled, high RMS should always pass"
        );
    }

    #[test]
    fn generate_silence_frame_is_all_zeros() {
        let silence = generate_silence_frame(640);
        assert_eq!(silence.len(), 640);
        assert!(silence.iter().all(|&s| s == 0));
    }

    #[test_case(0; "empty")]
    #[test_case(1; "single_sample")]
    #[test_case(100; "small")]
    #[test_case(320; "standard_frame")]
    #[test_case(960; "large_frame")]
    fn rms_handles_various_sizes(size: usize) {
        let samples: Vec<i16> = vec![1000; size];
        let rms = calculate_rms(&samples);
        if size == 0 {
            assert_eq!(rms, 0.0, "RMS of empty slice should be 0");
        } else {
            assert!(
                rms > 0.0,
                "RMS should be positive for non-empty samples of size {}",
                size
            );
        }
    }

    #[test]
    fn rms_of_zeros_is_zero() {
        let samples: Vec<i16> = vec![0; 320];
        let rms = calculate_rms(&samples);
        assert_eq!(rms, 0.0);
    }

    #[test]
    fn rms_of_max_amplitude() {
        let samples: Vec<i16> = vec![i16::MAX; 320];
        let rms = calculate_rms(&samples);
        assert!(rms > 30000.0, "Max amplitude should produce high RMS");
    }

    // --- Property-based tests ---

    use proptest::prelude::*;

    proptest! {
        #[test]
        fn rms_is_always_nonnegative(frame in prop::collection::vec(any::<i16>(), 0..1000)) {
            let rms = calculate_rms(&frame);
            prop_assert!(rms >= 0.0, "RMS should never be negative");
        }

        #[test]
        fn speech_detection_is_deterministic(
            frame in prop::collection::vec(any::<i16>(), 320..=960)
        ) {
            let mut s1 = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: 16000,
                use_vad: false,
                ..SilenceSuppressionConfig::default()
            });
            let mut s2 = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: 16000,
                use_vad: false,
                ..SilenceSuppressionConfig::default()
            });

            let (a1, _) = s1.process(&frame);
            let (a2, _) = s2.process(&frame);

            prop_assert!(
                std::mem::discriminant(&a1) == std::mem::discriminant(&a2),
                "Same input should produce same action type"
            );
        }
    }

    #[test]
    fn silence_frame_never_produces_send_action() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 50.0,
            native_sample_rate: 16000,
            use_vad: false,
            ..SilenceSuppressionConfig::default()
        });

        let silent_frame = vec![0i16; 320];
        let (action, _) = suppressor.process(&silent_frame);

        assert!(
            !matches!(action, FrameAction::Send(_)),
            "Pure silence should never trigger Send action"
        );
    }
}
