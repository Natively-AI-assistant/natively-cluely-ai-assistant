use anyhow::Result;
use rubato::{FftFixedIn, Resampler as RubatoResampler};

/// High-quality resampler using rubato (polyphase FIR with sinc interpolation)
/// Converts f32 audio from input sample rate to 16kHz i16 output
pub struct Resampler {
    resampler: FftFixedIn<f32>,
    input_buffer: Vec<Vec<f32>>,
    output_buffer: Vec<Vec<f32>>,
}

impl Resampler {
    pub fn new(input_sample_rate: f64) -> Result<Self> {
        let output_sample_rate = 16000.0;
        
        println!("[Resampler] Created: {}Hz -> {}Hz (high-quality rubato)", 
                 input_sample_rate, output_sample_rate);
        
        // FftFixedIn: Fixed input chunk size, variable output size
        // This is ideal for streaming from a microphone tap that delivers fixed-size buffers
        let resampler = FftFixedIn::<f32>::new(
            input_sample_rate as usize,
            output_sample_rate as usize,
            1024,  // chunk size (internal buffer)
            2,     // sub-chunks for better quality
            1,     // mono
        ).map_err(|e| anyhow::anyhow!("Failed to create resampler: {}", e))?;
        
        Ok(Self {
            resampler,
            input_buffer: vec![Vec::new()],
            output_buffer: vec![Vec::new()],
        })
    }

    /// Resample f32 audio data to i16 at 16kHz using high-quality algorithm.
    /// Named `resample_to_i16` (not `resample`) to avoid colliding with rubato's
    /// `Resampler` trait method of the same name, which is in scope here.
    pub fn resample_to_i16(&mut self, input_data: &[f32]) -> Result<Vec<i16>> {
        if input_data.is_empty() {
            return Ok(Vec::new());
        }

        // Add new input to our buffer (mono, so channel 0)
        self.input_buffer[0].extend_from_slice(input_data);
        
        let mut output_samples = Vec::new();
        
        // Process complete chunks
        let frames_needed = self.resampler.input_frames_next();
        
        while self.input_buffer[0].len() >= frames_needed {
            // Take exactly the frames we need
            let chunk: Vec<f32> = self.input_buffer[0].drain(0..frames_needed).collect();
            let input_chunk = vec![chunk];
            
            // Resize output buffer
            let output_frames = self.resampler.output_frames_next();
            self.output_buffer[0].resize(output_frames, 0.0);
            
            // Process
            match self.resampler.process_into_buffer(&input_chunk, &mut self.output_buffer, None) {
                Ok((_, out_len)) => {
                    // Convert f32 [-1.0, 1.0] to i16
                    for i in 0..out_len {
                        let sample = self.output_buffer[0][i];
                        let scaled = (sample * 32767.0).clamp(-32768.0, 32767.0);
                        output_samples.push(scaled as i16);
                    }
                }
                Err(e) => {
                    println!("[Resampler] Process error: {}", e);
                }
            }
        }
        
        Ok(output_samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    /// Generate `n` samples of a sine at `freq` Hz sampled at `rate` Hz.
    fn sine(freq: f64, rate: f64, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * PI * freq * (i as f64) / rate).sin() as f32 * 0.8)
            .collect()
    }

    /// Goertzel single-bin power for `target` Hz in an i16 signal at `rate` Hz.
    /// Used to measure how much energy lands at a given frequency post-resample.
    fn bin_power(samples: &[i16], rate: f64, target: f64) -> f64 {
        if samples.is_empty() {
            return 0.0;
        }
        let n = samples.len();
        let k = (target / rate) * n as f64;
        let w = 2.0 * PI * k / n as f64;
        let coeff = 2.0 * w.cos();
        let (mut s0, mut s1, mut s2) = (0.0_f64, 0.0_f64, 0.0_f64);
        for &x in samples {
            s0 = (x as f64 / 32768.0) + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        (s1 * s1 + s2 * s2 - coeff * s1 * s2).abs() / (n as f64)
    }

    fn feed(input_rate: f64, input: &[f32]) -> Vec<i16> {
        let mut r = Resampler::new(input_rate).expect("resampler ctor");
        // Feed in streaming-sized blocks to mirror real DSP usage.
        let mut out = Vec::new();
        for chunk in input.chunks(512) {
            out.extend(r.resample_to_i16(chunk).expect("resample"));
        }
        out
    }

    #[test]
    fn resamples_48k_to_16k_preserves_in_band_tone() {
        // 1kHz tone is well within the 8kHz Nyquist of 16kHz output.
        let input = sine(1000.0, 48000.0, 48000); // 1s
        let out = feed(48000.0, &input);
        assert!(!out.is_empty(), "expected resampled output");
        let in_band = bin_power(&out, 16000.0, 1000.0);
        // The 1kHz tone must survive with substantial energy.
        assert!(in_band > 1e-3, "1kHz tone lost after 48k->16k: {}", in_band);
    }

    #[test]
    fn resamples_48k_to_16k_rejects_above_nyquist_alias() {
        // 11kHz tone is above the 8kHz output Nyquist. A naive decimator would
        // fold it back into the audible band as alias energy near 5kHz
        // (16000 - 11000). A proper anti-aliased resampler attenuates it.
        let input = sine(11000.0, 48000.0, 48000);
        let out = feed(48000.0, &input);
        assert!(!out.is_empty());
        let alias = bin_power(&out, 16000.0, 5000.0);
        // Reference: in-band 1kHz energy at the same amplitude.
        let reference = bin_power(&feed(48000.0, &sine(1000.0, 48000.0, 48000)), 16000.0, 1000.0);
        assert!(
            alias < reference * 0.1,
            "alias from 11kHz not attenuated: alias={} reference={}",
            alias,
            reference
        );
    }

    #[test]
    fn resamples_24k_to_16k_non_integer_ratio_preserves_tone() {
        // The AirPods-HFP case: 24kHz native, factor 1.5 (non-integer) — the
        // case the naive TS decimators corrupted. 1kHz must survive cleanly.
        let input = sine(1000.0, 24000.0, 24000); // 1s
        let out = feed(24000.0, &input);
        assert!(!out.is_empty(), "expected output for 24k->16k");
        let in_band = bin_power(&out, 16000.0, 1000.0);
        assert!(in_band > 1e-3, "1kHz tone lost after 24k->16k: {}", in_band);
    }

    #[test]
    fn resamples_24k_to_16k_rejects_alias() {
        // 10kHz at 24kHz native is above the 8kHz output Nyquist; must be
        // attenuated rather than folded to 6kHz.
        let input = sine(10000.0, 24000.0, 24000);
        let out = feed(24000.0, &input);
        let alias = bin_power(&out, 16000.0, 6000.0);
        let reference = bin_power(&feed(24000.0, &sine(1000.0, 24000.0, 24000)), 16000.0, 1000.0);
        assert!(
            alias < reference * 0.15,
            "alias from 10kHz not attenuated: alias={} reference={}",
            alias,
            reference
        );
    }

    #[test]
    fn output_length_approximates_target_rate() {
        // 1s of 48k input should yield ~16000 samples at 16k (within resampler
        // internal-buffering slack).
        let input = sine(1000.0, 48000.0, 48000);
        let out = feed(48000.0, &input);
        let ratio = out.len() as f64 / 16000.0;
        assert!(
            ratio > 0.9 && ratio < 1.1,
            "expected ~16000 output samples, got {}",
            out.len()
        );
    }
}
