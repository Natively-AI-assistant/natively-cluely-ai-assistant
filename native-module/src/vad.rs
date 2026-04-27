// Voice Activity Detection - UI ONLY
//
// IMPORTANT: This VAD is for UI state display only.
// It does NOT gate or delay audio sent to Google STT.
//
// The silence_suppression module handles audio gating.
// This module is for:
// - Showing "speaking" indicator in UI
// - Detecting utterance boundaries
// - Optional stream management (not used currently)

use std::time::{SystemTime, UNIX_EPOCH};

use crate::audio_config::{VAD_END_RMS, VAD_HANGOVER_MS, VAD_START_RMS};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VadState {
    Idle,
    Speech,
    Hangover,
}

/// Voice Activity Detector for UI indication
/// Does NOT gate audio - only reports state
pub struct VadIndicator {
    state: VadState,
    start_threshold: f32,
    end_threshold: f32,
    hangover_duration_ms: u128,
    hangover_start_time: u128,
    pub last_rms: f32,
}

impl VadIndicator {
    pub fn new() -> Self {
        Self {
            state: VadState::Idle,
            start_threshold: VAD_START_RMS,
            end_threshold: VAD_END_RMS,
            hangover_duration_ms: VAD_HANGOVER_MS,
            hangover_start_time: 0,
            last_rms: 0.0,
        }
    }

    /// Update VAD state based on audio chunk
    /// Returns current state for UI display
    /// DOES NOT affect audio flow to STT
    pub fn update(&mut self, chunk: &[i16]) -> VadState {
        let rms = self.calculate_rms(chunk);
        self.last_rms = rms;
        let now = self.current_time_ms();

        match self.state {
            VadState::Idle => {
                if rms > self.start_threshold {
                    self.state = VadState::Speech;
                    println!("[VAD-UI] Speech detected (RMS: {})", rms as i32);
                }
            }
            VadState::Speech => {
                if rms < self.end_threshold {
                    self.state = VadState::Hangover;
                    self.hangover_start_time = now;
                }
            }
            VadState::Hangover => {
                if rms > self.start_threshold {
                    self.state = VadState::Speech;
                } else {
                    let time_in_hangover = now - self.hangover_start_time;
                    if time_in_hangover > self.hangover_duration_ms {
                        self.state = VadState::Idle;
                        println!("[VAD-UI] Speech ended");
                    }
                }
            }
        }

        self.state
    }

    /// Check if currently in speech state (for UI)
    pub fn is_speech(&self) -> bool {
        matches!(self.state, VadState::Speech | VadState::Hangover)
    }

    pub fn reset(&mut self) {
        self.state = VadState::Idle;
    }

    fn calculate_rms(&self, data: &[i16]) -> f32 {
        if data.is_empty() {
            return 0.0;
        }

        let step = 10;
        let mut sum: f32 = 0.0;
        let mut count = 0;

        let mut i = 0;
        while i < data.len() {
            let sample = data[i] as f32;
            sum += sample * sample;
            count += 1;
            i += step;
        }

        if count == 0 {
            return 0.0;
        }

        (sum / count as f32).sqrt()
    }

    fn current_time_ms(&self) -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }
}

// Keep legacy VadGate for compatibility during migration
// This is the OLD interface that was used for gating
// NEW code should use SilenceSuppressor instead
pub type VadGate = VadIndicator;

impl VadGate {
    /// Legacy compatibility: process returns empty during silence
    /// WARNING: This is the OLD pattern that causes latency issues
    /// New code should use SilenceSuppressor directly
    pub fn process(&mut self, chunk: Vec<i16>) -> Vec<Vec<i16>> {
        let state = self.update(&chunk);
        match state {
            VadState::Speech | VadState::Hangover => vec![chunk],
            VadState::Idle => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_case::test_case;

    #[test]
    fn new_starts_in_idle() {
        let vad = VadIndicator::new();
        assert!(!vad.is_speech());
    }

    #[test]
    fn loud_chunk_triggers_speech() {
        let mut vad = VadIndicator::new();
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let state = vad.update(&loud_frame);
        assert_eq!(state, VadState::Speech);
        assert!(vad.is_speech());
    }

    #[test]
    fn silent_chunk_stays_idle() {
        let mut vad = VadIndicator::new();
        let silent_frame: Vec<i16> = vec![0; 320];
        let state = vad.update(&silent_frame);
        assert_eq!(state, VadState::Idle);
        assert!(!vad.is_speech());
    }

    #[test]
    fn reset_returns_to_idle() {
        let mut vad = VadIndicator::new();
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        vad.update(&loud_frame);
        assert!(vad.is_speech());

        vad.reset();
        assert!(!vad.is_speech());
    }

    #[test]
    fn empty_chunk_does_not_panic() {
        let mut vad = VadIndicator::new();
        let state = vad.update(&[]);
        assert_eq!(state, VadState::Idle);
    }

    #[test]
    fn last_rms_is_updated() {
        let mut vad = VadIndicator::new();
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        vad.update(&loud_frame);
        assert!(vad.last_rms > 0.0);
    }

    #[test]
    fn process_legacy_returns_chunk_when_speech() {
        let mut vad = VadIndicator::new();
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        vad.update(&loud_frame);
        let result = vad.process(loud_frame.clone());
        assert_eq!(
            result.len(),
            1,
            "Should return the chunk when in speech state"
        );
        assert_eq!(result[0], loud_frame);
    }

    #[test]
    fn process_legacy_returns_empty_when_idle() {
        let mut vad = VadIndicator::new();
        let silent_frame: Vec<i16> = vec![0; 320];
        let result = vad.process(silent_frame);
        assert!(result.is_empty(), "Should return empty when idle");
    }

    #[test]
    fn is_speech_idle_is_false() {
        let vad = VadIndicator::new();
        assert!(!vad.is_speech(), "Idle should not be speech");
    }

    #[test]
    fn is_speech_after_loud_audio_is_true() {
        let mut vad = VadIndicator::new();
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.5).sin() * 20000.0) as i16)
            .collect();
        vad.update(&loud_frame);
        assert!(
            vad.is_speech(),
            "After loud audio, is_speech should be true"
        );
    }

    #[test]
    fn is_speech_returns_false_for_silence() {
        let mut vad = VadIndicator::new();
        let silent_frame: Vec<i16> = vec![0; 320];
        vad.update(&silent_frame);
        assert!(!vad.is_speech(), "Silence should not be speech");
    }

    #[test]
    fn rms_calculation_step_by_10() {
        let vad = VadIndicator::new();
        let samples: Vec<i16> = (0..100).map(|i| (i * 100) as i16).collect();
        let rms = vad.calculate_rms(&samples);
        assert!(rms > 0.0);
    }

    #[test]
    fn rms_of_empty_is_zero() {
        let vad = VadIndicator::new();
        let rms = vad.calculate_rms(&[]);
        assert_eq!(rms, 0.0);
    }
}
