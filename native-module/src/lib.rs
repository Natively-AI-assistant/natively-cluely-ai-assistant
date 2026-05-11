#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use ringbuf::traits::Consumer;

pub mod audio_config;
pub mod license;
pub mod microphone;
pub mod silence_suppression;
pub mod speaker;

use crate::audio_config::{CHUNK_BATCH_COUNT, CHUNK_BATCH_TIMEOUT_MS, DSP_POLL_MS};
use crate::silence_suppression::{FrameAction, SilenceSuppressionConfig, SilenceSuppressor};
use std::time::Instant;

// ============================================================================
// HELPERS — i16 slice → zero-copy LE bytes
// ============================================================================

/// Convert an i16 slice to little-endian bytes.
///
/// All targets supported by Natively (macOS x64/arm64, Windows x64, Linux x64)
/// are little-endian, so `i16` in memory IS the little-endian byte
/// representation. `bytemuck::cast_slice` produces a `&[u8]` view of the same
/// memory in O(1) with no per-sample work; we then `to_vec` once into the
/// owned buffer napi requires for `Buffer::from(Vec<u8>)`.
///
/// Replaces the previous per-sample `extend_from_slice(&s.to_le_bytes())` loop,
/// which did 960 sequential 2-byte appends per 20ms chunk × 50 chunks/sec.
#[inline]
fn i16_slice_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    bytemuck::cast_slice::<i16, u8>(samples).to_vec()
}

/// Coalesces up to `CHUNK_BATCH_COUNT` Send/SendSilence DSP frames into a
/// single tsfn (V8 boundary) call. Each tsfn invocation traverses the napi
/// scheduler, allocates a JS Buffer wrapper, and dispatches an event-loop
/// task — non-trivial overhead per ~1.9 KB chunk. Coalescing 3 frames cuts
/// boundary crossings 3× while keeping latency below STT framing thresholds
/// (Google / Soniox / Deepgram all accept 60–100 ms framing).
///
/// Flush triggers:
///   - `frames` == CHUNK_BATCH_COUNT (capacity reached), or
///   - `(now - first_push_at) > CHUNK_BATCH_TIMEOUT_MS` (timeout for trailing
///     speech in light traffic), or
///   - explicit `flush()` (DSP loop exit).
struct BatchEmitter {
    buffer: Vec<u8>,
    frames: usize,
    first_push_at: Option<Instant>,
}
impl BatchEmitter {
    fn new(estimated_chunk_bytes: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(estimated_chunk_bytes * CHUNK_BATCH_COUNT),
            frames: 0,
            first_push_at: None,
        }
    }
    fn push(&mut self, bytes: &[u8], tsfn: &ThreadsafeFunction<Buffer>) {
        if self.first_push_at.is_none() {
            self.first_push_at = Some(Instant::now());
        }
        self.buffer.extend_from_slice(bytes);
        self.frames += 1;
        if self.frames >= CHUNK_BATCH_COUNT {
            self.flush(tsfn);
        }
    }
    fn maybe_flush_timeout(&mut self, tsfn: &ThreadsafeFunction<Buffer>) {
        if let Some(t) = self.first_push_at {
            if t.elapsed().as_millis() >= CHUNK_BATCH_TIMEOUT_MS {
                self.flush(tsfn);
            }
        }
    }
    fn flush(&mut self, tsfn: &ThreadsafeFunction<Buffer>) {
        if self.buffer.is_empty() {
            self.first_push_at = None;
            self.frames = 0;
            return;
        }
        // Move buffer's contents out into a fresh Vec for the napi Buffer.
        // Keep the original allocation for the next batch.
        let take = std::mem::take(&mut self.buffer);
        self.buffer.reserve(take.capacity());
        tsfn.call(
            Ok(Buffer::from(take)),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
        self.frames = 0;
        self.first_push_at = None;
    }
}

// ============================================================================
// SYSTEM AUDIO CAPTURE (CoreAudio Tap / ScreenCaptureKit on macOS)
// ============================================================================

#[napi]
pub struct SystemAudioCapture {
    stop_signal: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Shared atomic sample rate — updated by the background thread once the
    /// native device is initialized. Callers always get the real hardware rate.
    sample_rate: Arc<AtomicU32>,
    device_id: Option<String>,
}

#[napi]
impl SystemAudioCapture {
    #[napi(constructor)]
    pub fn new(device_id: Option<String>) -> napi::Result<Self> {
        println!("[SystemAudioCapture] Created (device: {:?})", device_id);

        Ok(SystemAudioCapture {
            stop_signal: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            // Default to 48000 until the background thread reports the real rate.
            // 48kHz is the standard macOS CoreAudio rate.
            sample_rate: Arc::new(AtomicU32::new(48000)),
            device_id,
        })
    }

    #[napi]
    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    #[napi]
    pub fn start(
        &mut self,
        callback: ThreadsafeFunction<Buffer>,
        on_speech_ended: Option<ThreadsafeFunction<bool>>,
    ) -> napi::Result<()> {
        // Guard against double-start — prevents spawning concurrent threads
        if self.capture_thread.is_some() {
            return Err(napi::Error::from_reason("Capture already running"));
        }

        let tsfn = callback;
        let speech_ended_tsfn = on_speech_ended;

        self.stop_signal.store(false, Ordering::SeqCst);
        let stop_signal = self.stop_signal.clone();
        let sample_rate_shared = self.sample_rate.clone();
        let device_id = self.device_id.clone();

        // ALL init + DSP runs in background thread — start() returns INSTANTLY
        self.capture_thread = Some(thread::spawn(move || {
            // 1. SpeakerInput Init (takes 5-7 seconds — runs OFF main thread)
            println!("[SystemAudioCapture] Background init starting...");
            let input = match speaker::SpeakerInput::new(device_id.clone()) {
                Ok(i) => i,
                Err(e) => {
                    println!("[SystemAudioCapture] Init failed: {}. Trying default...", e);
                    match speaker::SpeakerInput::new(None) {
                        Ok(i) => i,
                        Err(e2) => {
                            let msg = format!(
                                "[SystemAudioCapture] FATAL: All init attempts failed: {}",
                                e2
                            );
                            eprintln!("{}", msg);
                            // Notify JS so it can emit 'error' and reset isRecording
                            tsfn.call(
                                Err(napi::Error::from_reason(msg)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                            return;
                        }
                    }
                }
            };

            let mut stream = match input.stream() {
                Ok(s) => s,
                Err(e) => {
                    let msg = format!(
                        "[SystemAudioCapture] FATAL: stream() failed: {}",
                        e
                    );
                    eprintln!("{}", msg);
                    tsfn.call(
                        Err(napi::Error::from_reason(msg)),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    return;
                }
            };
            let mut consumer = match stream.take_consumer() {
                Some(c) => c,
                None => {
                    let msg = "[SystemAudioCapture] FATAL: Failed to get consumer".to_string();
                    eprintln!("{}", msg);
                    tsfn.call(
                        Err(napi::Error::from_reason(msg)),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    return;
                }
            };

            let native_rate = stream.sample_rate();
            // Publish the real native rate so JS can read it via get_sample_rate()
            sample_rate_shared.store(native_rate, Ordering::Release);
            println!(
                "[SystemAudioCapture] Background init complete. Initial Rate: {}Hz. DSP starting.",
                native_rate
            );

            // 2. DSP loop with silence suppression + WebRTC VAD
            let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: native_rate,
                ..SilenceSuppressionConfig::for_system_audio()
            });

            // 20ms chunks at native rate (e.g. 960 samples at 48kHz)
            let chunk_size = (native_rate as usize / 1000) * 20;
            let mut frame_buffer: Vec<i16> = Vec::with_capacity(chunk_size * 4);
            let mut raw_batch: Vec<f32> = Vec::with_capacity(4096);
            // PERF: pre-allocated frame scratch (avoids per-chunk Vec alloc).
            let mut frame_scratch: Vec<i16> = Vec::with_capacity(chunk_size);
            // PERF: coalesce up to CHUNK_BATCH_COUNT frames into one tsfn call.
            // Cuts V8 boundary crossings 3× with no perceptible STT-side latency.
            let mut emitter = BatchEmitter::new(chunk_size * 2);

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                // Drain ALL available samples from ring buffer (lock-free)
                while let Some(sample) = consumer.try_pop() {
                    raw_batch.push(sample);
                }

                // Convert f32 -> i16 at native sample rate
                if !raw_batch.is_empty() {
                    for &f in &raw_batch {
                        let scaled = (f * 32767.0).clamp(-32768.0, 32767.0);
                        frame_buffer.push(scaled as i16);
                    }
                    raw_batch.clear();
                }

                // Process in 20ms chunks through the two-stage gate
                while frame_buffer.len() >= chunk_size {
                    frame_scratch.clear();
                    frame_scratch.extend(frame_buffer.drain(0..chunk_size));

                    let (action, speech_ended) = suppressor.process(&frame_scratch);

                    match action {
                        FrameAction::Send(data) => {
                            let bytes = i16_slice_to_le_bytes(&data);
                            emitter.push(&bytes, &tsfn);
                        }
                        FrameAction::SendSilence => {
                            // Zero-filled bytes to keep streaming APIs alive.
                            let silence = vec![0u8; chunk_size * 2];
                            emitter.push(&silence, &tsfn);
                        }
                        FrameAction::Suppress => {
                            // Do nothing — bandwidth saving. A pending partial
                            // batch can age out via the timeout check below.
                        }
                    }

                    // Fire speech_ended callback on the exact transition frame.
                    // Flush any pending batch FIRST so STT sees the trailing audio
                    // before being told the utterance ended.
                    if speech_ended {
                        emitter.flush(&tsfn);
                        if let Some(ref se_tsfn) = speech_ended_tsfn {
                            se_tsfn.call(Ok(true), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }

                // Flush partial batch on timeout so trailing speech in light
                // traffic isn't held up.
                emitter.maybe_flush_timeout(&tsfn);

                // Keep the sleep small so we quickly read the ring buffer
                thread::sleep(Duration::from_millis(DSP_POLL_MS));
            }

            // Flush any remaining batched audio before exit.
            emitter.flush(&tsfn);
            println!("[SystemAudioCapture] DSP thread stopped.");
            // stream is dropped here → SpeakerStream::Drop calls stop_with_ch
        }));

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

// ============================================================================
// MICROPHONE CAPTURE (CPAL)
//
// Design: The MicrophoneStream (CPAL handle) is recreated on every start()
// call. This guarantees the ring buffer consumer is always fresh, allowing
// seamless stop→start restart cycles (e.g. between meetings).
// ============================================================================

#[napi]
pub struct MicrophoneCapture {
    stop_signal: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Shared atomic sample rate — updated once the CPAL device is opened.
    sample_rate: Arc<AtomicU32>,
    /// Stores the requested device ID for recreation on restart.
    device_id: Option<String>,
    /// Holds the live CPAL stream. Recreated on each start().
    input: Option<microphone::MicrophoneStream>,
}

#[napi]
impl MicrophoneCapture {
    #[napi(constructor)]
    pub fn new(device_id: Option<String>) -> napi::Result<Self> {
        // Eagerly create the stream to detect device errors early and read the
        // native sample rate.
        let input = match microphone::MicrophoneStream::new(device_id.clone()) {
            Ok(i) => i,
            Err(e) => return Err(napi::Error::from_reason(format!("Failed: {}", e))),
        };

        let native_rate = input.sample_rate();
        println!(
            "[MicrophoneCapture] Initialized. Device: {:?}, Rate: {}Hz",
            device_id, native_rate
        );

        Ok(MicrophoneCapture {
            stop_signal: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            sample_rate: Arc::new(AtomicU32::new(native_rate)),
            device_id,
            input: Some(input),
        })
    }

    #[napi]
    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    #[napi]
    pub fn start(
        &mut self,
        callback: ThreadsafeFunction<Buffer>,
        on_speech_ended: Option<ThreadsafeFunction<bool>>,
    ) -> napi::Result<()> {
        let tsfn = callback;
        let speech_ended_tsfn = on_speech_ended;

        self.stop_signal.store(false, Ordering::SeqCst);
        let stop_signal = self.stop_signal.clone();

        // If the stream was consumed by a previous start() cycle, recreate it.
        // This is the fix for the one-shot take_consumer() bug.
        if self.input.is_none() {
            println!("[MicrophoneCapture] Recreating CPAL stream for restart...");
            match microphone::MicrophoneStream::new(self.device_id.clone()) {
                Ok(i) => {
                    let rate = i.sample_rate();
                    self.sample_rate.store(rate, Ordering::Release);
                    self.input = Some(i);
                }
                Err(e) => {
                    return Err(napi::Error::from_reason(format!(
                        "[MicrophoneCapture] Failed to recreate stream: {}",
                        e
                    )));
                }
            }
        }

        let input_ref = self
            .input
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("Input missing"))?;

        input_ref
            .play()
            .map_err(|e| napi::Error::from_reason(format!("{}", e)))?;

        let native_rate = input_ref.sample_rate();
        self.sample_rate.store(native_rate, Ordering::Release);

        let mut consumer = input_ref
            .take_consumer()
            .ok_or_else(|| napi::Error::from_reason("Failed to get consumer"))?;

        // Hand the DSP thread a clone of the err_signal so we can surface
        // CPAL callback-thread errors (USB unplug, device reset, exclusive-
        // mode steal) to the JS layer instead of just logging to stderr.
        let err_signal = input_ref.err_signal();

        // DSP thread with silence suppression + WebRTC VAD
        self.capture_thread = Some(thread::spawn(move || {
            let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: native_rate,
                ..SilenceSuppressionConfig::for_microphone()
            });

            // 20ms chunks at native rate
            let chunk_size = (native_rate as usize / 1000) * 20;
            let mut frame_buffer: Vec<i16> = Vec::with_capacity(chunk_size * 4);
            let mut raw_batch: Vec<f32> = Vec::with_capacity(4096);
            // PERF: pre-allocated scratch — see SystemAudioCapture for rationale.
            let mut frame_scratch: Vec<i16> = Vec::with_capacity(chunk_size);
            // PERF: coalesce up to CHUNK_BATCH_COUNT frames into one tsfn call.
            let mut emitter = BatchEmitter::new(chunk_size * 2);

            println!("[MicrophoneCapture] DSP thread started (VAD + suppression active, rate={}Hz, chunk={})", native_rate, chunk_size);

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                // Surface any callback-thread error to JS exactly once. After
                // reporting, we keep looping so a subsequent device recovery
                // (e.g. user re-plugged the USB mic) is still observed via the
                // ringbuf — but main.ts will typically destroy + recreate this
                // capture on receiving the error. Flush any batched audio first
                // so partial trailing speech reaches STT before the error event.
                if let Ok(mut slot) = err_signal.lock() {
                    if let Some(msg) = slot.take() {
                        let full = format!("[MicrophoneCapture] CPAL error: {}", msg);
                        eprintln!("{}", full);
                        emitter.flush(&tsfn);
                        tsfn.call(
                            Err(napi::Error::from_reason(full)),
                            ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }

                // 1. Drain ALL available samples from ring buffer (lock-free)
                while let Some(sample) = consumer.try_pop() {
                    raw_batch.push(sample);
                }

                // 2. Convert f32 -> i16 at native sample rate
                if !raw_batch.is_empty() {
                    for &f in &raw_batch {
                        let scaled = (f * 32767.0).clamp(-32768.0, 32767.0);
                        frame_buffer.push(scaled as i16);
                    }
                    raw_batch.clear();
                }

                // 3. Process in 20ms chunks through the two-stage gate
                while frame_buffer.len() >= chunk_size {
                    frame_scratch.clear();
                    frame_scratch.extend(frame_buffer.drain(0..chunk_size));

                    let (action, speech_ended) = suppressor.process(&frame_scratch);

                    match action {
                        FrameAction::Send(data) => {
                            let bytes = i16_slice_to_le_bytes(&data);
                            emitter.push(&bytes, &tsfn);
                        }
                        FrameAction::SendSilence => {
                            let silence = vec![0u8; chunk_size * 2];
                            emitter.push(&silence, &tsfn);
                        }
                        FrameAction::Suppress => {
                            // Do nothing — partial batch can age out via timeout.
                        }
                    }

                    if speech_ended {
                        emitter.flush(&tsfn);
                        if let Some(ref se_tsfn) = speech_ended_tsfn {
                            se_tsfn.call(Ok(true), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }

                emitter.maybe_flush_timeout(&tsfn);

                // 4. Short sleep
                thread::sleep(Duration::from_millis(DSP_POLL_MS));
            }

            emitter.flush(&tsfn);
            println!("[MicrophoneCapture] DSP thread stopped.");
        }));

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
        // Pause and destroy the CPAL stream so start() recreates it fresh.
        if let Some(ref input) = self.input {
            let _ = input.pause();
        }
        self.input = None;
    }
}

// ============================================================================
// DEVICE ENUMERATION
// ============================================================================

#[napi(object)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

#[napi]
pub fn get_input_devices() -> Vec<AudioDeviceInfo> {
    match microphone::list_input_devices() {
        Ok(devs) => devs
            .into_iter()
            .map(|(id, name)| AudioDeviceInfo { id, name })
            .collect(),
        Err(e) => {
            eprintln!("[get_input_devices] Error: {}", e);
            Vec::new()
        }
    }
}

#[napi]
pub fn get_output_devices() -> Vec<AudioDeviceInfo> {
    match speaker::list_output_devices() {
        Ok(devs) => devs
            .into_iter()
            .map(|(id, name)| AudioDeviceInfo { id, name })
            .collect(),
        Err(e) => {
            eprintln!("[get_output_devices] Error: {}", e);
            Vec::new()
        }
    }
}

/// Returns the platform-native ID of the current default output device.
/// macOS: CoreAudio device UID. Windows: WASAPI device id (eMultimedia/eConsole role).
/// Empty string on error or unsupported platform.
///
/// JS polls this every few seconds during an active meeting; when the value
/// changes, main.ts recreates SystemAudioCapture so the CoreAudio Tap follows
/// the new output route. Without this, switching output devices mid-meeting
/// (plug in headphones, swap AirPods, route to virtual cable) leaves the tap
/// bound to the original device, capturing silence.
#[napi]
pub fn get_default_output_device_id() -> String {
    speaker::default_output_device_uid()
}
