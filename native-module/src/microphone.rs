// Microphone Capture — Lock-Free Real-Time Compliant
//
// Two backends share a single ring-buffer/consumer/condvar surface so the
// rest of the pipeline (DSP, suppressor, napi callback) is unchanged:
//
//   1. CPAL backend (default, all platforms)
//      — minimal callback, lock-free push to ring buffer.
//
//   2. AEC backend (macOS only, opt-in via `enable_voice_processing=true`)
//      — AVAudioEngine with `setVoiceProcessingEnabled:` on the input node.
//        Apple's AUVoiceProcessingIO unit handles acoustic echo cancellation
//        + noise suppression + AGC end-to-end against the system output
//        device. The mic stream stops carrying speaker bleed entirely.
//
// When AEC is on, the speaker-attribution router in
// `electron/main.ts:shouldRouteMicrophoneAsInterviewer` becomes near-redundant
// because the mic only contains the user's voice; relabeling to interviewer
// is no longer needed for echo. We keep the router as a safety net for the
// rare case when AEC fails to fully suppress (laptop speakers at high volume).

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

/// Lock-free microphone stream.
///
/// Two backends — cpal (default) or Apple voice-processing AEC (macOS only)
/// — both push f32 samples to the same ring buffer that the DSP thread polls.
pub struct MicrophoneStream {
    stream: Option<Stream>,
    #[cfg(target_os = "macos")]
    aec: Option<AecBackend>,
    consumer: Option<HeapCons<f32>>,
    sample_rate: u32,
    is_running: Arc<AtomicBool>,
    /// Condvar for DSP thread to wait on audio data
    data_ready: Arc<(Mutex<bool>, Condvar)>,
}

/// macOS-only: holds the AVAudioEngine + InputNode for the AEC backend so they
/// stay alive for the lifetime of the stream. The tap is installed during
/// construction and disposed when this is dropped.
#[cfg(target_os = "macos")]
struct AecBackend {
    engine: cidre::arc::R<cidre::av::audio::Engine>,
    input_node: cidre::arc::R<cidre::av::audio::InputNode>,
}

#[cfg(target_os = "macos")]
impl Drop for AecBackend {
    fn drop(&mut self) {
        // Pull the tap before dropping so the audio thread doesn't fire into
        // a dangling closure capture. `engine.stop()` is also fine — at this
        // point the napi class is being torn down and audio is no longer
        // being consumed.
        let _ = self.input_node.remove_tap_on_bus(0);
        self.engine.stop();
    }
}

// SAFETY: AVAudioEngine and AVAudioInputNode are reference-counted Objective-C
// objects whose methods are thread-safe at the OS level (per Apple's audio
// session guarantees). cidre's `arc::R<T>` itself is Send/Sync when T is, but
// the auto-trait isn't always inferred for objc objects — we only ever access
// these from the napi-owned thread anyway.
#[cfg(target_os = "macos")]
unsafe impl Send for AecBackend {}

impl MicrophoneStream {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        Self::new_with_options(device_id, false)
    }

    /// Create a microphone stream, optionally routed through Apple's voice
    /// processing AU for echo cancellation. When `enable_voice_processing` is
    /// true on macOS, the AEC backend is used; otherwise (and on every other
    /// OS) the cpal backend is used.
    pub fn new_with_options(
        device_id: Option<String>,
        enable_voice_processing: bool,
    ) -> Result<Self> {
        let is_running = Arc::new(AtomicBool::new(false));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));

        // ── AEC path (macOS only, opt-in) ──────────────────────────────────
        #[cfg(target_os = "macos")]
        {
            if enable_voice_processing {
                let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
                let (producer, consumer) = rb.split();
                match build_aec_backend(producer, is_running.clone(), data_ready.clone()) {
                    Ok((aec, sample_rate)) => {
                        println!(
                            "[Microphone] AEC backend ready (AVAudioEngine + voice processing). Rate: {}Hz",
                            sample_rate
                        );
                        return Ok(Self {
                            stream: None,
                            aec: Some(aec),
                            consumer: Some(consumer),
                            sample_rate,
                            is_running,
                            data_ready,
                        });
                    }
                    Err(e) => {
                        // Fall through to cpal — AEC is best-effort and we
                        // never want a configuration glitch to leave the user
                        // with no microphone at all. The producer above was
                        // consumed by the failed attempt; recreate below.
                        eprintln!(
                            "[Microphone] AEC backend init failed, falling back to cpal: {}",
                            e
                        );
                    }
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            if enable_voice_processing {
                eprintln!(
                    "[Microphone] AEC requested but unsupported on this platform; using cpal."
                );
            }
        }

        // ── cpal path (default + AEC fallback) ─────────────────────────────
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();
        build_cpal_stream(device_id, producer, consumer, is_running, data_ready)
    }

    /// Start capturing audio
    pub fn play(&mut self) -> Result<()> {
        if let Some(ref stream) = self.stream {
            stream
                .play()
                .map_err(|e| anyhow::anyhow!("Failed to start stream: {}", e))?;
            self.is_running.store(true, Ordering::SeqCst);
            println!("[Microphone] Stream started");
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        if let Some(ref mut aec) = self.aec {
            // AVAudioEngine.start is &mut self per cidre; the engine handle is
            // unique here so the borrow is sound.
            aec.engine
                .start()
                .map_err(|e| anyhow::anyhow!("AVAudioEngine start failed: {:?}", e))?;
            self.is_running.store(true, Ordering::SeqCst);
            println!("[Microphone] AEC engine started");
            return Ok(());
        }
        Ok(())
    }

    /// Pause capturing
    pub fn pause(&mut self) -> Result<()> {
        if let Some(ref stream) = self.stream {
            stream
                .pause()
                .map_err(|e| anyhow::anyhow!("Failed to pause stream: {}", e))?;
            self.is_running.store(false, Ordering::SeqCst);
            println!("[Microphone] Stream paused");
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        if let Some(ref mut aec) = self.aec {
            aec.engine.pause();
            self.is_running.store(false, Ordering::SeqCst);
            println!("[Microphone] AEC engine paused");
            return Ok(());
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

/// Compose device resolution + cpal stream wiring + struct construction.
/// Used both by the default path and the AEC fallback path.
fn build_cpal_stream(
    device_id: Option<String>,
    producer: HeapProd<f32>,
    consumer: HeapCons<f32>,
    is_running: Arc<AtomicBool>,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
) -> Result<MicrophoneStream> {
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

    let stream = build_input_stream(
        &device,
        &config,
        producer,
        channels,
        is_running.clone(),
        data_ready.clone(),
    )?;

    Ok(MicrophoneStream {
        stream: Some(stream),
        #[cfg(target_os = "macos")]
        aec: None,
        consumer: Some(consumer),
        sample_rate,
        is_running,
        data_ready,
    })
}

/// macOS only: spin up an AVAudioEngine with voice processing enabled on the
/// input node. Apple's AUVoiceProcessingIO unit handles AEC + AGC + noise
/// suppression against the system output device, so the mic stream stops
/// carrying speaker bleed entirely.
///
/// On macOS 14+ the input node format after voice processing is float32 mono
/// (deinterleaved) at the device's native rate. We install a tap that pushes
/// channel-0 samples into the same ring buffer the cpal path uses, signaling
/// the DSP condvar so the existing pipeline downstream is unchanged.
#[cfg(target_os = "macos")]
fn build_aec_backend(
    mut producer: HeapProd<f32>,
    is_running: Arc<AtomicBool>,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
) -> Result<(AecBackend, u32)> {
    use cidre::av;
    use ringbuf::traits::Producer as _;

    let engine = av::audio::Engine::new();
    let mut input_node = engine.input_node();

    // Enable Apple's voice processing pipeline on the input node. This is the
    // single call that activates AEC + AGC + NS — the OS handles the rest.
    input_node
        .set_vp_enabled(true)
        .map_err(|e| anyhow::anyhow!("setVoiceProcessingEnabled failed: {:?}", e))?;
    println!("[Microphone] AVAudioInputNode voice processing enabled.");

    // Read the format the input node will emit AFTER voice processing. AEC may
    // change the rate (e.g. force 48k) and channel count (typically downmix to
    // mono). We bind the tap to this exact format so AVAudioEngine doesn't
    // need to insert an internal converter.
    let format = input_node.output_format_for_bus(0);
    let asbd = format.absd();
    let sample_rate = asbd.sample_rate as u32;
    let channels = format.channel_count() as usize;
    println!(
        "[Microphone] AEC tap format: {}Hz, {}ch, common={:?}",
        sample_rate,
        channels,
        format.common_format()
    );

    // The tap callback runs on AVAudioEngine's audio render thread. Move the
    // ring producer + condvar in by ownership; both are Send and we only need
    // FnMut access since the AU calls the closure sequentially.
    let data_ready_tap = data_ready.clone();
    let is_running_tap = is_running.clone();

    // Buffer size of 1024 frames at 48k = ~21 ms — small enough that the
    // downstream 20 ms chunker barely buffers anything, big enough to avoid
    // chasing the audio thread on every render quantum.
    let install_result = input_node.install_tap_on_bus(
        0,
        1024,
        Some(&format),
        move |pcm_buf, _time| {
            if !is_running_tap.load(Ordering::Relaxed) {
                return;
            }
            // After voice processing the input is mono — channel 0 is the
            // AEC-cleaned mic signal. If the format ever drops back to stereo
            // for some reason, channel 0 is still left/main.
            if let Some(samples) = pcm_buf.data_f32_at(0) {
                let frame_len = pcm_buf.frame_len() as usize;
                let slice = if frame_len <= samples.len() {
                    &samples[..frame_len]
                } else {
                    samples
                };

                // push_slice may partially fail if the consumer hasn't drained
                // yet — that's the same backpressure behavior as the cpal path
                // and the suppressor downstream tolerates it.
                let _ = producer.push_slice(slice);

                // Wake the DSP thread.
                let (lock, cvar) = &*data_ready_tap;
                if let Ok(mut ready) = lock.lock() {
                    *ready = true;
                    cvar.notify_one();
                }
            }
        },
    );

    if let Err(e) = install_result {
        return Err(anyhow::anyhow!("install_tap_on_bus failed: {:?}", e));
    }

    Ok((
        AecBackend {
            engine,
            input_node,
        },
        sample_rate,
    ))
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
