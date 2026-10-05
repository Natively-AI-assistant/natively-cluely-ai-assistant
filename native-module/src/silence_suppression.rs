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

    /// Create config for microphone.
    ///
    /// PLATFORM SPLIT on stage 2. On macOS the WebRTC VAD stays ON and uses
    /// Quality mode rather than Aggressive, because built-in microphones with
    /// heavy hardware DSP (Apple Silicon) sound "unnatural" to strict models
    /// (#128) — it is the only stage that rejects typing, fans and other
    /// non-speech, and it also keeps interviewer audio bleeding from the
    /// speakers back into the mic out of the user's own transcript.
    ///
    /// On Windows it is OFF: device DSP routinely pulls normal laptop/headset
    /// speech below what the VAD will accept, so the gate never opens, the
    /// channel emits only zero keepalives, and the user sees the misleading
    /// "Microphone Is Silent" warning. Cloud STT providers run their own
    /// speech detection, and the adaptive RMS gate below still suppresses a
    /// genuinely idle microphone.
    ///
    /// Note on `speech_threshold_rms`: it is only the INITIAL
    /// `adaptive_threshold`. The suppressor starts in `Suppressed`, so the
    /// first non-speech frame overwrites it with
    /// `max(noise_floor_ema * adaptive_multiplier, adaptive_min_floor)` — with
    /// `noise_floor_ema` seeded at `adaptive_min_floor`, that is ~59 within one
    /// frame. Lowering this value therefore does NOT lower the gate; the live
    /// knobs are `adaptive_min_floor` and `adaptive_multiplier`.
    pub fn for_microphone() -> Self {
        Self::for_microphone_on(cfg!(target_os = "windows"))
    }

    /// `for_microphone` with the platform decision injected, so a test on
    /// EITHER host can exercise BOTH branches. A suite that only covers the
    /// branch its own OS compiles is not coverage for a platform split.
    pub fn for_microphone_on(is_windows: bool) -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(500), // increased from 150ms to prevent clipping trailing consonants (s, t, etc)
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: !is_windows,
            vad_mode: VadMode::Quality,
        }
    }
}

/// How much continuous above-threshold audio an RMS-only gate (use_vad = false:
/// system audio on both platforms, the Windows microphone) looks at before
/// asking whether it has latched open.
///
/// The threshold is learned only while suppressed. After digital silence —
/// the app listening before the call audio starts — it sits at
/// `adaptive_min_floor` (10 for system audio, about -70 dBFS), and any
/// background above that (room tone, hiss, a video's ambience) then counts as
/// speech for good: speech_ended never fires again. Measured 2026-09-26 on
/// this state machine: background at RMS 15 or more after a silent start
/// gave 0 speech ends in 10 turns with 1 s pauses. Everything waiting on that
/// edge fell back to its timer — the REST providers' uploads (every 10 s),
/// OpenAI's live-model commits (every 30 s), Auto Answer's speech-end hint.
///
/// Once latched, only the EDGES change: they come from comparing each frame
/// with the background the window found. The gate itself, and so the audio
/// every provider receives, is left exactly as it was. Raising the gate's
/// threshold instead was measured to cut 77-100% of speech frames when the
/// background was within 5 dB of the speech.
const LATCH_WINDOW_SECS: u64 = 3;
/// A window is treated as latched only when it holds an unbroken stretch this
/// long within `LATCH_RELEASE_MARGIN` of its quietest frame: a pause sitting
/// on the background. Continuous speech dips to its own minimum only between
/// syllables, for tens of milliseconds, so it is never taken for background.
const LATCH_FLOOR_RUN_MS: u64 = 400;
/// While latched, a frame is speech for the edges at background × this: just
/// above the background, so speech over it still counts (equal speech and
/// noise is already ×1.41) and a pause at the background level does not.
const LATCH_RELEASE_MARGIN: f32 = 1.5;

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
    /// RMS-only gates: per-frame RMS of the current run of speech-level frames.
    latch_window_rms: Vec<f32>,
    /// Samples in that run.
    latch_window_samples: u64,
    /// Set while the gate is latched open: the background level the edges are
    /// measured against (see LATCH_WINDOW_SECS). Cleared when the gate itself
    /// reaches silence again.
    latched_background: Option<f32>,
    /// Edge state while latched: speech open, and its last speech-level frame.
    latched_speaking: bool,
    latched_last_speech: Instant,
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

/// Speech edge observed on a processed frame (see `SilenceSuppressor::process_edges`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpeechEdge {
    None,
    /// First speech frame after silence.
    Started,
    /// Hangover elapsed after the last speech frame.
    Ended,
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
            latch_window_rms: Vec::with_capacity(160),
            latch_window_samples: 0,
            latched_background: None,
            latched_speaking: false,
            latched_last_speech: now,
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
        let (action, edge) = self.process_edges(frame);
        (action, edge == SpeechEdge::Ended)
    }

    /// `process` with BOTH edges reported. `Started` fires on the first speech
    /// frame after silence (the channel state machine for Auto Answer needs
    /// the rising edge too); `Ended` is exactly the edge `process` reports.
    pub fn process_edges(&mut self, frame: &[i16]) -> (FrameAction, SpeechEdge) {
        self.process_edges_at(frame, Instant::now())
    }

    /// `process_edges` against a given clock, so tests can run the real
    /// hangover (600 ms for system audio) without sleeping.
    pub(crate) fn process_edges_at(&mut self, frame: &[i16], now: Instant) -> (FrameAction, SpeechEdge) {
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

        if !self.config.use_vad {
            if has_speech {
                self.observe_latch(rms, frame.len(), now);
            } else {
                self.clear_latch_window();
            }
        }

        let (action, gate_edge) = self.gate(frame, rms, has_speech, now);
        (action, self.latched_edge(rms, gate_edge, now))
    }

    /// The gate proper: what to send, and its own speech edges.
    fn gate(&mut self, frame: &[i16], rms: f32, has_speech: bool, now: Instant) -> (FrameAction, SpeechEdge) {
        // ALWAYS check for speech first - immediate response
        if has_speech {
            self.state = SuppressionState::Active;
            self.last_speech_time = now;
            self.frames_sent += 1;
            let edge = if self.was_speaking { SpeechEdge::None } else { SpeechEdge::Started };
            self.was_speaking = true;
            return (FrameAction::Send(frame.to_vec()), edge);
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
                    return (FrameAction::Send(frame.to_vec()), SpeechEdge::None);
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

        let edge = if speech_just_ended { SpeechEdge::Ended } else { SpeechEdge::None };
        // Check if time for keepalive
        if now.duration_since(self.last_keepalive_time) >= self.config.silence_keepalive_interval {
            self.last_keepalive_time = now;
            self.frames_sent += 1;
            (FrameAction::SendSilence, edge)
        } else {
            self.frames_suppressed += 1;
            (FrameAction::Suppress, edge)
        }
    }

    /// The edge to report. Normally the gate's own. While latched, edges come
    /// from the frame against the background instead; when the gate reaches
    /// silence again it takes back over, and its Ended is dropped if the
    /// latched edges had already closed speech, so edges always alternate.
    fn latched_edge(&mut self, rms: f32, gate_edge: SpeechEdge, now: Instant) -> SpeechEdge {
        let Some(background) = self.latched_background else {
            return gate_edge;
        };
        if self.state == SuppressionState::Suppressed {
            println!("[SilenceSuppressor] Background gone: gate back in charge of speech ends");
            self.latched_background = None;
            let speech_open = self.latched_speaking;
            self.latched_speaking = false;
            return if gate_edge == SpeechEdge::Ended && !speech_open { SpeechEdge::None } else { gate_edge };
        }
        if rms >= background * LATCH_RELEASE_MARGIN {
            self.latched_last_speech = now;
            if self.latched_speaking {
                return SpeechEdge::None;
            }
            self.latched_speaking = true;
            return SpeechEdge::Started;
        }
        if self.latched_speaking && now.duration_since(self.latched_last_speech) > self.config.speech_hangover {
            self.latched_speaking = false;
            return SpeechEdge::Ended;
        }
        SpeechEdge::None
    }

    /// RMS-only gates: a speech-level frame joins the current run. Once the run
    /// spans `LATCH_WINDOW_SECS` without one frame below the threshold, look at
    /// its quietest level; if the run also held a pause sitting there
    /// (`LATCH_FLOOR_RUN_MS`), that level is the background the edges are
    /// measured against from now on (see LATCH_WINDOW_SECS).
    fn observe_latch(&mut self, rms: f32, samples: usize, now: Instant) {
        self.latch_window_rms.push(rms);
        self.latch_window_samples += samples as u64;
        let rate = self.config.native_sample_rate as u64;
        if self.latch_window_samples < rate * LATCH_WINDOW_SECS {
            return;
        }
        let floor = self.latch_window_rms.iter().copied().fold(f32::INFINITY, f32::min);
        let release = floor * LATCH_RELEASE_MARGIN;
        let (mut run, mut longest) = (0usize, 0usize);
        for &r in &self.latch_window_rms {
            run = if r <= release { run + 1 } else { 0 };
            longest = longest.max(run);
        }
        let longest_ms = longest as u64 * samples as u64 * 1000 / rate.max(1);
        if release > self.adaptive_threshold && longest_ms >= LATCH_FLOOR_RUN_MS {
            if self.latched_background.is_none() {
                // The gate reported Started and is still open: speech is open,
                // and a pause from here ends it after the hangover.
                self.latched_speaking = true;
                self.latched_last_speech = now;
                println!(
                    "[SilenceSuppressor] Gate held open by background at RMS {:.0} (threshold {:.0}): speech ends now measured against it",
                    floor, self.adaptive_threshold
                );
            }
            self.latched_background = Some(floor);
        }
        self.clear_latch_window();
    }

    fn clear_latch_window(&mut self) {
        self.latch_window_rms.clear();
        self.latch_window_samples = 0;
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

        match self.vad.is_voice_segment(&self.vad_buf[..target]) {
            Ok(is_voice) => is_voice,
            Err(_) => {
                // On VAD error, fall back to RMS-only (don't block audio)
                true
            }
        }
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
        self.clear_latch_window();
        self.latched_background = None;
        self.latched_speaking = false;
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
            native_sample_rate: 16000, // Use 16kHz for test to avoid decimation issues
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
    fn test_speech_started_edge_fires_once_per_utterance() {
        let mut s = SilenceSuppressor::new(SilenceSuppressionConfig {
            use_vad: false,
            speech_hangover: Duration::from_millis(0),
            ..SilenceSuppressionConfig::default()
        });
        let loud: Vec<i16> = vec![10_000; 320];
        let quiet: Vec<i16> = vec![0; 320];

        let (_, e) = s.process_edges(&loud);
        assert_eq!(e, SpeechEdge::Started, "first speech frame is the rising edge");
        let (_, e) = s.process_edges(&loud);
        assert_eq!(e, SpeechEdge::None, "sustained speech is not a new edge");
        let (_, e) = s.process_edges(&quiet);
        assert_eq!(e, SpeechEdge::Ended);
        let (_, e) = s.process_edges(&quiet);
        assert_eq!(e, SpeechEdge::None, "sustained silence is not a new edge");
        let (_, e) = s.process_edges(&loud);
        assert_eq!(e, SpeechEdge::Started, "a second utterance rises again");
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

        // Send a silent frame (should trigger speech_ended)
        let silent_frame: Vec<i16> = vec![0; 320];
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(ended, "Speech should have ended on transition to silence");

        // Another silent frame should NOT trigger speech_ended again
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(!ended, "Speech_ended should only fire once per transition");
    }

    /// The mic VAD split is platform-scoped on purpose: Windows device DSP
    /// starves the VAD ("Microphone Is Silent"), while macOS needs stage 2 to
    /// reject typing/fans and speaker bleed. A global flip would silently take
    /// noise rejection away from macOS, so assert BOTH branches here rather
    /// than only whichever one this build happens to compile.
    #[test]
    fn test_microphone_vad_is_platform_scoped() {
        // BOTH branches, from whichever host runs the suite.
        assert!(
            !SilenceSuppressionConfig::for_microphone_on(true).use_vad,
            "Windows mic must bypass the WebRTC VAD (device DSP starves it)"
        );
        assert!(
            SilenceSuppressionConfig::for_microphone_on(false).use_vad,
            "non-Windows mic must keep the WebRTC VAD (typing/fan/bleed rejection)"
        );

        // The live constructor agrees with the branch this build compiled for.
        assert_eq!(
            SilenceSuppressionConfig::for_microphone().use_vad,
            !cfg!(target_os = "windows")
        );

        // Everything EXCEPT use_vad is shared — the split must not drift into a
        // second, silently divergent microphone tuning.
        let win = SilenceSuppressionConfig::for_microphone_on(true);
        let mac = SilenceSuppressionConfig::for_microphone_on(false);
        assert_eq!(win.speech_threshold_rms, mac.speech_threshold_rms);
        assert_eq!(win.speech_hangover, mac.speech_hangover);
        assert_eq!(win.adaptive_multiplier, mac.adaptive_multiplier);
        assert_eq!(win.adaptive_min_floor, mac.adaptive_min_floor);
        assert_eq!(win.ema_alpha, mac.ema_alpha);

        // System audio is VAD-free on every platform (#127); not part of this split.
        assert!(!SilenceSuppressionConfig::for_system_audio().use_vad);
    }

    /// Guards the comment on for_microphone(): the initial speech_threshold_rms
    /// is NOT the gate. One non-speech frame replaces it with the adaptive
    /// value, which is HIGHER than a "lowered" initial of 50 — the reason the
    /// 100 -> 50 edit this replaced could not have had the effect it claimed.
    #[test]
    fn test_initial_threshold_is_superseded_by_adaptive() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 50.0,
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::for_microphone()
        });
        assert_eq!(suppressor.adaptive_threshold, 50.0, "seeded from the initial value");

        let silent_frame: Vec<i16> = vec![0; 320];
        let _ = suppressor.process(&silent_frame);

        let expected = (20.0_f32 * 0.98) * 3.0; // ema decays from adaptive_min_floor toward 0
        assert!(
            (suppressor.adaptive_threshold - expected).abs() < 0.5,
            "adaptive threshold {} should have replaced the initial 50.0",
            suppressor.adaptive_threshold
        );
        assert!(
            suppressor.adaptive_threshold > 50.0,
            "the adaptive gate sits ABOVE a 'lowered' initial value"
        );
    }

    // ── RMS-only gate latch (2026-09-26) ────────────────────────────────
    // A Groq user saw transcripts only every 20-30 s. The system-audio gate
    // learned its threshold from the digital silence before the call audio
    // began, so background just above -70 dBFS counted as speech for good and
    // speech_ended never fired: the REST providers flushed on their 10 s timer
    // instead of at each pause. These drive the real state machine with the
    // real hangovers on a simulated 20 ms clock.

    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 33) as f32 / (1u64 << 31) as f32) * 2.0 - 1.0
        }
    }

    /// 20 ms of uniform noise at 16 kHz with the given RMS.
    fn background(rng: &mut Lcg, rms: f32) -> Vec<i16> {
        let amp = rms * 3f32.sqrt();
        (0..320).map(|_| (rng.next() * amp) as i16).collect()
    }

    /// Drives `frames` through the gate, 20 ms apart. Returns the End edges seen.
    fn feed(s: &mut SilenceSuppressor, clock: &mut Instant, frames: impl IntoIterator<Item = Vec<i16>>) -> usize {
        let mut ends = 0;
        for f in frames {
            *clock += Duration::from_millis(20);
            if s.process_edges_at(&f, *clock).1 == SpeechEdge::Ended {
                ends += 1;
            }
        }
        ends
    }

    /// 5 s pre-roll, then `turns` of 2 s speech over the background and a 1 s
    /// pause of background alone. Returns (speech ends, final threshold).
    fn conversation(config: SilenceSuppressionConfig, silent_preroll: bool, noise_rms: f32, turns: usize) -> (usize, f32) {
        let mut s = SilenceSuppressor::new(SilenceSuppressionConfig { native_sample_rate: 16000, ..config });
        let mut clock = Instant::now();
        let mut rng = Lcg(42);
        let mut t = 0usize;
        let preroll: Vec<Vec<i16>> = (0..250)
            .map(|_| if silent_preroll { vec![0i16; 320] } else { background(&mut rng, noise_rms) })
            .collect();
        let mut ends = feed(&mut s, &mut clock, preroll);
        for _ in 0..turns {
            let speech: Vec<Vec<i16>> = (0..100)
                .map(|_| {
                    let n = background(&mut rng, noise_rms);
                    (0..320).map(|i| { t += 1; ((t as f32 * 0.07).sin() * 3000.0) as i16 + n[i] }).collect()
                })
                .collect();
            ends += feed(&mut s, &mut clock, speech);
            let pause: Vec<Vec<i16>> = (0..50).map(|_| background(&mut rng, noise_rms)).collect();
            ends += feed(&mut s, &mut clock, pause);
        }
        (ends, s.adaptive_threshold)
    }

    #[test]
    fn system_audio_gate_ends_speech_over_background_after_a_silent_start() {
        for &noise in &[15.0f32, 30.0, 60.0, 150.0] {
            let (ends, threshold) = conversation(SilenceSuppressionConfig::for_system_audio(), true, noise, 10);
            // The first 3 s window (turn 1's speech + pause) is what finds the
            // background, so turn 1 may not end; every pause after it must.
            assert!(
                ends >= 9,
                "background RMS {}: {} speech ends in 10 turns (threshold stuck at {:.1}) — the gate latched open",
                noise, ends, threshold
            );
        }
    }

    #[test]
    fn system_audio_gate_ends_speech_when_loud_background_is_there_from_the_start() {
        // Above the initial threshold (30), the very first frame opened the gate.
        for &noise in &[60.0f32, 150.0] {
            let (ends, _) = conversation(SilenceSuppressionConfig::for_system_audio(), false, noise, 10);
            assert!(ends >= 9, "background RMS {} from the start: {} speech ends in 10 turns", noise, ends);
        }
    }

    #[test]
    fn clean_system_audio_is_unchanged() {
        let (ends, threshold) = conversation(SilenceSuppressionConfig::for_system_audio(), true, 3.0, 10);
        assert_eq!(ends, 10);
        assert_eq!(threshold, 10.0, "pauses below the threshold never open a latch window");
    }

    #[test]
    fn continuous_speech_never_moves_the_threshold() {
        // 6 s of syllable-rate speech (4 Hz envelope, 3.75:1 range) with no
        // pause: it dips to its minimum for ~70 ms at a time, never 400 ms.
        let mut s = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::for_system_audio()
        });
        let mut clock = Instant::now();
        feed(&mut s, &mut clock, (0..250).map(|_| vec![0i16; 320]));
        let before = s.adaptive_threshold;
        let mut t = 0usize;
        let speech: Vec<Vec<i16>> = (0..300)
            .map(|_| {
                (0..320)
                    .map(|_| {
                        t += 1;
                        let secs = t as f32 / 16000.0;
                        let envelope = 1900.0 + 1100.0 * (2.0 * std::f32::consts::PI * 4.0 * secs).sin();
                        ((t as f32 * 0.07).sin() * envelope) as i16
                    })
                    .collect()
            })
            .collect();
        let ends = feed(&mut s, &mut clock, speech);
        assert_eq!(ends, 0);
        assert!(s.latched_background.is_none(), "speech alone must never be taken for background");
        assert_eq!(s.adaptive_threshold, before);
    }

    #[test]
    fn a_latched_gate_still_sends_every_frame() {
        // Only the edges change. Raising the gate's threshold instead cut
        // 77-100% of speech frames at 5 dB SNR (measured with real speech):
        // every provider would have lost audio to fix the REST ones' timing.
        let mut s = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::for_system_audio()
        });
        let mut clock = Instant::now();
        let mut rng = Lcg(3);
        feed(&mut s, &mut clock, (0..250).map(|_| vec![0i16; 320]));
        let (mut frames, mut sent, mut ends) = (0, 0, 0);
        let mut t = 0usize;
        for _ in 0..10 {
            for k in 0..150 {
                let n = background(&mut rng, 2000.0); // loud: ~5 dB under the speech
                let f: Vec<i16> = if k < 100 {
                    (0..320).map(|i| { t += 1; ((t as f32 * 0.07).sin() * 3000.0) as i16 + n[i] }).collect()
                } else {
                    n
                };
                clock += Duration::from_millis(20);
                let (action, edge) = s.process_edges_at(&f, clock);
                frames += 1;
                if matches!(action, FrameAction::Send(_)) { sent += 1; }
                if edge == SpeechEdge::Ended { ends += 1; }
            }
        }
        assert_eq!(sent, frames, "the latch must not change what is sent");
        assert!(ends >= 9, "{} speech ends", ends);
    }

    #[test]
    fn edges_alternate_into_and_out_of_the_latch() {
        let mut s = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::for_system_audio()
        });
        let mut clock = Instant::now();
        let mut rng = Lcg(11);
        let mut edges = Vec::new();
        let mut t = 0usize;
        let push = |s: &mut SilenceSuppressor, clock: &mut Instant, f: Vec<i16>, edges: &mut Vec<SpeechEdge>| {
            *clock += Duration::from_millis(20);
            let (_, e) = s.process_edges_at(&f, *clock);
            if e != SpeechEdge::None { edges.push(e); }
        };
        for _ in 0..250 { push(&mut s, &mut clock, vec![0; 320], &mut edges); }
        for _ in 0..5 {
            for _ in 0..100 {
                let n = background(&mut rng, 60.0);
                let f = (0..320).map(|i| { t += 1; ((t as f32 * 0.07).sin() * 3000.0) as i16 + n[i] }).collect();
                push(&mut s, &mut clock, f, &mut edges);
            }
            for _ in 0..50 { let f = background(&mut rng, 60.0); push(&mut s, &mut clock, f, &mut edges); }
        }
        assert!(s.latched_background.is_some());
        // The call audio stops (digital silence): the gate takes back over.
        for _ in 0..100 { push(&mut s, &mut clock, vec![0; 320], &mut edges); }
        assert!(s.latched_background.is_none());
        // A clean utterance after it.
        for _ in 0..50 {
            let f = (0..320).map(|_| { t += 1; ((t as f32 * 0.07).sin() * 3000.0) as i16 }).collect();
            push(&mut s, &mut clock, f, &mut edges);
        }
        for _ in 0..50 { push(&mut s, &mut clock, vec![0; 320], &mut edges); }

        assert_eq!(edges.first(), Some(&SpeechEdge::Started));
        for pair in edges.windows(2) {
            assert_ne!(pair[0], pair[1], "edges must alternate: {:?}", edges);
        }
        assert_eq!(edges.last(), Some(&SpeechEdge::Ended));
        assert!(edges.len() >= 10, "{:?}", edges);
    }

    #[test]
    fn windows_microphone_gets_the_release_and_macos_microphone_keeps_its_vad() {
        // Windows: RMS-only gate (VAD off), so the same latch and the same release.
        let (ends, threshold) = conversation(SilenceSuppressionConfig::for_microphone_on(true), true, 60.0, 10);
        assert!(ends >= 9, "Windows mic: {} speech ends in 10 turns (threshold {:.1})", ends, threshold);
        // macOS: the WebRTC VAD rejects background, so the release never runs.
        let mut mac = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::for_microphone_on(false)
        });
        let mut clock = Instant::now();
        let mut rng = Lcg(7);
        feed(&mut mac, &mut clock, (0..300).map(|_| background(&mut rng, 150.0)));
        assert!(mac.latch_window_rms.is_empty() && mac.latch_window_samples == 0, "the latch release is for RMS-only gates");
    }
}
