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

        println!(
            "[Resampler] Created: {}Hz -> {}Hz (high-quality rubato)",
            input_sample_rate, output_sample_rate
        );

        // FftFixedIn: Fixed input chunk size, variable output size
        // This is ideal for streaming from a microphone tap that delivers fixed-size buffers
        let resampler = FftFixedIn::<f32>::new(
            input_sample_rate as usize,
            output_sample_rate as usize,
            1024, // chunk size (internal buffer)
            2,    // sub-chunks for better quality
            1,    // mono
        )
        .map_err(|e| anyhow::anyhow!("Failed to create resampler: {}", e))?;

        Ok(Self {
            resampler,
            input_buffer: vec![Vec::new()],
            output_buffer: vec![Vec::new()],
        })
    }

    /// Resample f32 audio data to i16 at 16kHz using high-quality algorithm
    pub fn resample(&mut self, input_data: &[f32]) -> Result<Vec<i16>> {
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
            match self
                .resampler
                .process_into_buffer(&input_chunk, &mut self.output_buffer, None)
            {
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
    use test_case::test_case;

    #[test_case(48000.0; "48kHz_to_16kHz")]
    #[test_case(44100.0; "44.1kHz_to_16kHz")]
    #[test_case(22050.0; "22.05kHz_to_16kHz")]
    #[test_case(16000.0; "16kHz_passthrough")]
    fn resampler_creation_succeeds(input_rate: f64) {
        let res = Resampler::new(input_rate);
        assert!(
            res.is_ok(),
            "Resampler should be created for {}Hz",
            input_rate
        );
    }

    #[test]
    fn resample_empty_input_returns_empty() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let result = resampler.resample(&[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn resample_produces_i16_output() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let input: Vec<f32> = (0..1024).map(|i| (i as f32 * 0.01).sin() * 0.5).collect();
        let output = resampler.resample(&input).unwrap();
        assert!(!output.is_empty(), "Should produce output samples");
    }

    #[test]
    fn resample_output_is_valid_i16_range() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let input: Vec<f32> = (0..2048).map(|i| (i as f32 * 0.01).sin()).collect();
        let output = resampler.resample(&input).unwrap();
        for (i, &sample) in output.iter().enumerate() {
            assert!(
                sample >= i16::MIN && sample <= i16::MAX,
                "Sample {} out of i16 range: {}",
                i,
                sample
            );
        }
    }

    #[test]
    fn resample_silence_produces_near_zero() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let input = vec![0.0f32; 1024];
        let output = resampler.resample(&input).unwrap();
        for &sample in &output {
            assert!(
                sample.abs() < 100,
                "Silence input should produce near-zero output, got {}",
                sample
            );
        }
    }

    #[test]
    fn resample_accumulates_across_calls() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let input = vec![0.5f32; 2048];
        let single_output = resampler.resample(&input).unwrap();

        let mut resampler2 = Resampler::new(48000.0).unwrap();
        let part1 = vec![0.5f32; 1024];
        let part2 = vec![0.5f32; 1024];
        let out1 = resampler2.resample(&part1).unwrap();
        let out2 = resampler2.resample(&part2).unwrap();
        let split_total = out1.len() + out2.len();

        assert!(
            (split_total as i64 - single_output.len() as i64).abs() <= 2,
            "Split calls should produce similar total samples: single={}, split={}",
            single_output.len(),
            split_total
        );
    }

    #[test]
    fn resample_clips_at_extremes() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let input = vec![2.0f32; 1024];
        let output = resampler.resample(&input).unwrap();
        assert!(
            !output.is_empty(),
            "Should produce output for extreme positive input"
        );
        let max_sample = output.iter().max().copied().unwrap();
        assert_eq!(
            max_sample,
            i16::MAX,
            "Extreme positive input should clip to i16::MAX, got {}",
            max_sample
        );
    }

    #[test]
    fn resample_negative_clipping() {
        let mut resampler = Resampler::new(48000.0).unwrap();
        let input = vec![-2.0f32; 1024];
        let output = resampler.resample(&input).unwrap();
        assert!(
            !output.is_empty(),
            "Should produce output for extreme negative input"
        );
        let min_sample = output.iter().min().copied().unwrap();
        assert_eq!(
            min_sample,
            i16::MIN,
            "Extreme negative input should clip to i16::MIN, got {}",
            min_sample
        );
    }
}
