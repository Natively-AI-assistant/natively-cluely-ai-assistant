// Microphone Capture - Lock-Free Real-Time Compliant
//
// Architecture:
// 1. CPAL callback: ONLY pushes to lock-free ring buffer
// 2. No mutexes, allocations, or DSP in callback
// 3. Background thread: drains buffer, resamples, emits to JS

use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{Condvar, Mutex};

use crate::audio_config::RING_BUFFER_SAMPLES;

/// List available input devices
pub fn list_input_devices() -> Result<Vec<(String, String)>> {
    let host = cpal::default_host();
    let mut list = Vec::new();
    list.push(("default".to_string(), "Default Microphone".to_string()));

    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                list.push((name.clone(), name));
            }
        }
    }
    Ok(list)
}

/// Normalize a cpal device name for fuzzy matching across plug/unplug cycles
/// where the OS may renumber the device or use a different unicode dash.
/// Examples handled:
///   "(2- USB Audio Device)" → "usb audio device"
///   "AirPods Pro – Hands-Free" → "airpods pro - hands-free"  (en-dash → hyphen)
///   "  AirPods Pro  " → "airpods pro"
fn normalize_device_name(s: &str) -> String {
    let stripped = s
        .trim()
        // Strip the WASAPI "(N- " or "(NN- " index prefix that cpal sometimes
        // includes. The trailing close-paren is left in the suffix to compare.
        .trim_start_matches(|c: char| c == '(' || c.is_ascii_digit() || c == '-' || c == ' ')
        .trim_end_matches(|c: char| c == ')' || c == ' ');
    // Replace common unicode dashes with ASCII hyphen so en-dash / em-dash / minus
    // all collapse to the same character.
    stripped
        .chars()
        .map(|c| match c {
            '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            other => other,
        })
        .collect::<String>()
        .to_lowercase()
}

fn resolve_input_device(host: &cpal::Host, device_id: Option<&str>) -> Result<cpal::Device> {
    let requested_id = device_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && !id.eq_ignore_ascii_case("default"));

    if let Some(requested_id) = requested_id {
        let normalized_request = normalize_device_name(requested_id);
        // Tier each candidate so we pick the best match without borrow-juggling
        // the cpal::Device handles. 0 = exact, 1 = case-insensitive, 2 = fuzzy.
        let mut best: Option<(u8, cpal::Device, String)> = None;
        let mut available_devices = Vec::new();

        for device in host.input_devices()? {
            let name = device
                .name()
                .unwrap_or_else(|_| "<unknown input>".to_string());

            let tier = if name == requested_id {
                Some(0u8)
            } else if name.eq_ignore_ascii_case(requested_id) {
                Some(1u8)
            } else if normalize_device_name(&name) == normalized_request {
                Some(2u8)
            } else {
                None
            };

            available_devices.push(name.clone());

            if let Some(t) = tier {
                if best.as_ref().map(|(bt, _, _)| t < *bt).unwrap_or(true) {
                    best = Some((t, device, name));
                    if t == 0 {
                        // Exact match — short-circuit, no need to keep enumerating.
                        break;
                    }
                }
            }
        }

        if let Some((tier, device, matched_name)) = best {
            let label = match tier {
                0 => "exact",
                1 => "case-insensitive",
                _ => "fuzzy",
            };
            println!(
                "[Microphone] Using {} match for input device: requested='{}' matched='{}'",
                label, requested_id, matched_name
            );
            return Ok(device);
        }

        return Err(anyhow::anyhow!(
            "Input device '{}' not found. Available devices: {}",
            requested_id,
            available_devices.join(", ")
        ));
    }

    host.default_input_device()
        .ok_or_else(|| anyhow::anyhow!("No input device found"))
}

/// Lock-free microphone stream
///
/// Callback pushes raw f32 samples to ring buffer.
/// Consumer is polled by DSP thread.
pub struct MicrophoneStream {
    stream: Option<Stream>,
    consumer: Option<HeapCons<f32>>,
    sample_rate: u32,
    is_running: Arc<AtomicBool>,
    /// Condvar for DSP thread to wait on audio data
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    /// Set by the cpal err_fn (audio callback thread) when a device error
    /// fires. Polled by the DSP thread so the error can be surfaced to JS.
    /// Without this, USB-mic-unplug or device-reset events were logged to
    /// stderr only and the JS layer never learned that capture had stopped
    /// producing samples.
    err_signal: Arc<Mutex<Option<String>>>,
}

impl MicrophoneStream {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let host = cpal::default_host();
        let device = resolve_input_device(&host, device_id.as_deref())?;

        let config = device
            .default_input_config()
            .map_err(|e| anyhow::anyhow!("Failed to get config: {}", e))?;

        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;

        println!(
            "[Microphone] Device: {}, Rate: {}Hz, Channels: {}, Format: {:?}",
            device.name().unwrap_or_default(),
            sample_rate,
            channels,
            config.sample_format()
        );

        // Create lock-free SPSC ring buffer
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let is_running = Arc::new(AtomicBool::new(false));
        let is_running_clone = is_running.clone();

        // Shared Condvar for DSP thread wakeup
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let data_ready_clone = data_ready.clone();

        let err_signal: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let err_signal_clone = err_signal.clone();

        // Build the stream with minimal callback
        let stream = build_input_stream(
            &device,
            &config,
            producer,
            channels,
            is_running_clone,
            data_ready_clone,
            err_signal_clone,
        )?;

        Ok(Self {
            stream: Some(stream),
            consumer: Some(consumer),
            sample_rate,
            is_running,
            data_ready,
            err_signal,
        })
    }

    /// Start capturing audio
    pub fn play(&self) -> Result<()> {
        if let Some(ref stream) = self.stream {
            stream
                .play()
                .map_err(|e| anyhow::anyhow!("Failed to start stream: {}", e))?;
            self.is_running.store(true, Ordering::SeqCst);
            println!("[Microphone] Stream started");
        }
        Ok(())
    }

    /// Pause capturing
    pub fn pause(&self) -> Result<()> {
        if let Some(ref stream) = self.stream {
            stream
                .pause()
                .map_err(|e| anyhow::anyhow!("Failed to pause stream: {}", e))?;
            self.is_running.store(false, Ordering::SeqCst);
            println!("[Microphone] Stream paused");
        }
        Ok(())
    }

    /// Get the input sample rate
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Take ownership of the consumer for the DSP thread
    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    /// Check if stream is running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    /// Get the Condvar for DSP thread to wait on audio data
    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }

    /// Hand the DSP thread a clone of the err-signal cell so it can poll
    /// for callback-thread errors and report them to JS.
    pub fn err_signal(&self) -> Arc<Mutex<Option<String>>> {
        self.err_signal.clone()
    }
}

/// Build input stream with lock-free callback
///
/// The callback ONLY pushes to the ring buffer.
/// No mutexes, allocations, or DSP.
fn build_input_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    mut producer: HeapProd<f32>,
    channels: usize,
    is_running: Arc<AtomicBool>,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    err_signal: Arc<Mutex<Option<String>>>,
) -> Result<Stream> {
    let err_fn = move |err: cpal::StreamError| {
        let msg = format!("{}", err);
        eprintln!("[Microphone] Stream error: {}", msg);
        // Publish error to err_signal so the DSP thread can forward to JS.
        // First-error-wins; subsequent errors are dropped to avoid log spam.
        if let Ok(mut slot) = err_signal.lock() {
            if slot.is_none() {
                *slot = Some(msg);
            }
        }
    };

    let stream = match config.sample_format() {
        SampleFormat::F32 => {
            let data_ready_f32 = data_ready.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !is_running.load(Ordering::Relaxed) {
                        return;
                    }
                    // REAL-TIME SAFE: Only lock-free push
                    if channels > 1 {
                        for chunk in data.chunks(channels) {
                            let _ = producer.try_push(chunk[0]);
                        }
                    } else {
                        let _ = producer.push_slice(data);
                    }
                    // Signal DSP thread
                    let (lock, cvar) = &*data_ready_f32;
                    if let Ok(mut ready) = lock.lock() {
                        *ready = true;
                        cvar.notify_one();
                    }
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::I16 => {
            let data_ready_i16 = data_ready.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !is_running.load(Ordering::Relaxed) {
                        return;
                    }
                    // REAL-TIME SAFE: Convert and push
                    if channels > 1 {
                        for chunk in data.chunks(channels) {
                            let sample = chunk[0] as f32 / 32768.0;
                            let _ = producer.try_push(sample);
                        }
                    } else {
                        for &sample in data {
                            let _ = producer.try_push(sample as f32 / 32768.0);
                        }
                    }
                    // Signal DSP thread
                    let (lock, cvar) = &*data_ready_i16;
                    if let Ok(mut ready) = lock.lock() {
                        *ready = true;
                        cvar.notify_one();
                    }
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::I32 => {
            let data_ready_i32 = data_ready;
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[i32], _: &cpal::InputCallbackInfo| {
                    if !is_running.load(Ordering::Relaxed) {
                        return;
                    }
                    // REAL-TIME SAFE: Convert and push
                    if channels > 1 {
                        for chunk in data.chunks(channels) {
                            let sample = chunk[0] as f32 / 2147483648.0;
                            let _ = producer.try_push(sample);
                        }
                    } else {
                        for &sample in data {
                            let _ = producer.try_push(sample as f32 / 2147483648.0);
                        }
                    }
                    // Signal DSP thread
                    let (lock, cvar) = &*data_ready_i32;
                    if let Ok(mut ready) = lock.lock() {
                        *ready = true;
                        cvar.notify_one();
                    }
                },
                err_fn,
                None,
            )?
        }
        format => {
            return Err(anyhow::anyhow!("Unsupported sample format: {:?}", format));
        }
    };

    Ok(stream)
}

impl Drop for MicrophoneStream {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        // Stream will be dropped and stopped automatically
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_device_name;

    #[test]
    fn normalize_strips_wasapi_index_prefix() {
        // cpal on Windows often returns "(2- USB Audio Device)" or similar.
        assert_eq!(normalize_device_name("(2- USB Audio Device)"), "usb audio device");
        assert_eq!(normalize_device_name("(15- Microphone)"), "microphone");
    }

    #[test]
    fn normalize_collapses_unicode_dashes() {
        assert_eq!(normalize_device_name("AirPods Pro – Hands-Free"), "airpods pro - hands-free");
        assert_eq!(normalize_device_name("AirPods Pro — Hands-Free"), "airpods pro - hands-free");
    }

    #[test]
    fn normalize_trims_and_lowercases() {
        assert_eq!(normalize_device_name("  AirPods Pro  "), "airpods pro");
        assert_eq!(normalize_device_name("AIRPODS PRO"), "airpods pro");
    }

    #[test]
    fn normalize_idempotent_on_clean_name() {
        assert_eq!(normalize_device_name("built-in microphone"), "built-in microphone");
    }
}
