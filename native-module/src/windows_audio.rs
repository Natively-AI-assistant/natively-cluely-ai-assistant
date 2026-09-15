use std::collections::VecDeque;
use wasapi::SampleType;

pub(crate) fn decode_sample(
    bytes: &[u8],
    sample_type: SampleType,
    bits_per_sample: u16,
) -> Option<f32> {
    match (sample_type, bits_per_sample) {
        (SampleType::Float, 32) if bytes.len() >= 4 => {
            Some(f32::from_le_bytes(bytes[..4].try_into().ok()?))
        }
        (SampleType::Float, 64) if bytes.len() >= 8 => {
            Some(f64::from_le_bytes(bytes[..8].try_into().ok()?) as f32)
        }
        // 8-bit PCM is unsigned; wider PCM formats are signed little-endian.
        (SampleType::Int, 8) if !bytes.is_empty() => Some((bytes[0] as f32 - 128.0) / 128.0),
        (SampleType::Int, 16) if bytes.len() >= 2 => {
            Some(i16::from_le_bytes(bytes[..2].try_into().ok()?) as f32 / 32_768.0)
        }
        (SampleType::Int, 24) if bytes.len() >= 3 => {
            let value = ((bytes[0] as i32) | ((bytes[1] as i32) << 8) | ((bytes[2] as i32) << 16))
                << 8
                >> 8;
            Some(value as f32 / 8_388_608.0)
        }
        (SampleType::Int, 32) if bytes.len() >= 4 => {
            Some(i32::from_le_bytes(bytes[..4].try_into().ok()?) as f32 / 2_147_483_648.0)
        }
        _ => None,
    }
}

pub(crate) fn downmix_to_mono(
    bytes: VecDeque<u8>,
    bytes_per_frame: usize,
    channels: usize,
    sample_type: SampleType,
    bits_per_sample: u16,
) -> Vec<f32> {
    let bytes_per_sample = bytes_per_frame / channels;
    let bytes: Vec<u8> = bytes.into_iter().collect();
    let mut samples = Vec::with_capacity(bytes.len() / bytes_per_frame);

    for frame in bytes.chunks_exact(bytes_per_frame) {
        let mut sum = 0.0;
        for channel in 0..channels {
            let start = channel * bytes_per_sample;
            let end = start + bytes_per_sample;
            let Some(sample) = decode_sample(&frame[start..end], sample_type, bits_per_sample)
            else {
                return Vec::new();
            };
            sum += sample;
        }
        samples.push(sum / channels as f32);
    }
    samples
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: f32, expected: f32) {
        assert!(
            (actual - expected).abs() < 1.0e-6,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn decodes_supported_pcm_formats() {
        let cases: Vec<(Vec<u8>, SampleType, u16, f32)> = vec![
            (vec![0], SampleType::Int, 8, -1.0),
            (vec![128], SampleType::Int, 8, 0.0),
            (16_384_i16.to_le_bytes().to_vec(), SampleType::Int, 16, 0.5),
            (vec![0x00, 0x00, 0x40], SampleType::Int, 24, 0.5),
            (
                1_073_741_824_i32.to_le_bytes().to_vec(),
                SampleType::Int,
                32,
                0.5,
            ),
            (0.25_f32.to_le_bytes().to_vec(), SampleType::Float, 32, 0.25),
            (0.75_f64.to_le_bytes().to_vec(), SampleType::Float, 64, 0.75),
        ];

        for (bytes, sample_type, bits, expected) in cases {
            assert_close(
                decode_sample(&bytes, sample_type, bits).expect("format should decode"),
                expected,
            );
        }
    }

    #[test]
    fn rejects_unsupported_or_truncated_samples() {
        assert_eq!(decode_sample(&[0], SampleType::Int, 16), None);
        assert_eq!(decode_sample(&[0; 4], SampleType::Float, 16), None);
    }

    #[test]
    fn downmixes_multichannel_frames_and_ignores_partial_tail() {
        let mut bytes = VecDeque::new();
        for sample in [16_384_i16, -16_384, 8_192, 8_192] {
            bytes.extend(sample.to_le_bytes());
        }
        bytes.push_back(0xff);

        let samples = downmix_to_mono(bytes, 4, 2, SampleType::Int, 16);

        assert_eq!(samples.len(), 2);
        assert_close(samples[0], 0.0);
        assert_close(samples[1], 0.25);
    }
}
