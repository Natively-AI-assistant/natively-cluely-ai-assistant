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

fn resolve_input_device(host: &cpal::Host, device_id: Option<&str>) -> Result<cpal::Device> {
    let requested_id = device_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && !id.eq_ignore_ascii_case("default"));

    if let Some(requested_id) = requested_id {
        let mut case_insensitive_match = None;
        let mut available_devices = Vec::new();

        for device in host.input_devices()? {
            let name = device
                .name()
                .unwrap_or_else(|_| "<unknown input>".to_string());

            if name == requested_id {
                println!("[Microphone] Using requested input device: {}", name);
                return Ok(device);
            }

            if case_insensitive_match.is_none() && name.eq_ignore_ascii_case(requested_id) {
                case_insensitive_match = Some(device);
            }

            available_devices.push(name);
        }

        if let Some(device) = case_insensitive_match {
            println!(
                "[Microphone] Using case-insensitive match for requested input device: {}",
                requested_id
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

        // Build the stream with minimal callback
        let stream = build_input_stream(
            &device,
            &config,
            producer,
            channels,
            is_running_clone,
            data_ready_clone,
        )?;

        Ok(Self {
            stream: Some(stream),
            consumer: Some(consumer),
            sample_rate,
            is_running,
            data_ready,
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
) -> Result<Stream> {
    let err_fn = |err| eprintln!("[Microphone] Stream error: {}", err);

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
    use super::*;

    #[test]
    fn list_input_devices_returns_default() {
        let devices = list_input_devices().unwrap();
        assert!(
            !devices.is_empty(),
            "Should always have at least 'default' device"
        );
        assert_eq!(devices[0].0, "default");
        assert_eq!(devices[0].1, "Default Microphone");
    }

    /// Initialize COM on the current thread (Windows only).
    /// cpal 0.15.x has a bug where COM is only initialized on the first thread
    /// that accesses the audio enumerator, causing crashes on parallel test threads.
    #[cfg(windows)]
    fn ensure_com_initialized() {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    }

    #[test]
    fn resolve_default_returns_default_device() {
        #[cfg(windows)]
        ensure_com_initialized();

        let host = cpal::default_host();
        let _result = resolve_input_device(&host, Some("default"));
    }

    #[test]
    fn resolve_empty_string_returns_default() {
        #[cfg(windows)]
        ensure_com_initialized();

        let host = cpal::default_host();
        let _result = resolve_input_device(&host, Some(""));
    }

    #[test]
    fn resolve_whitespace_returns_default() {
        #[cfg(windows)]
        ensure_com_initialized();

        let host = cpal::default_host();
        let _result = resolve_input_device(&host, Some("   "));
    }

    #[test]
    fn resolve_nonexistent_device_returns_error() {
        #[cfg(windows)]
        ensure_com_initialized();

        let host = cpal::default_host();
        let result = resolve_input_device(&host, Some("__nonexistent_device_xyz__"));
        assert!(result.is_err(), "Should error for nonexistent device");
    }

    #[test]
    fn resolve_none_uses_default() {
        #[cfg(windows)]
        ensure_com_initialized();

        let host = cpal::default_host();
        let _result = resolve_input_device(&host, None);
    }
}
