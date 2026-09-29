// Ported logic
use super::stop_signal::StopSignal;
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::Result;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use tracing::error;
use wasapi::{
    get_default_device, DeviceCollection, Direction, DisconnectReason, EventCallbacks, SampleType,
    ShareMode, WaveFormat,
};

struct WakerState {
    shutdown: bool,
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

/// Consecutive `IAudioCaptureClient` read failures before the loop gives up
/// and surfaces the stream as stopped. A single failure can be transient; a
/// run of them is the signature of AUDCLNT_E_DEVICE_INVALIDATED (headset
/// unplugged, driver reset, Windows switching the endpoint) — which until
/// 2026-09-11 was logged and then `continue`d forever, so JS saw a quiet
/// ring buffer indistinguishable from a silent meeting.
const MAX_CONSECUTIVE_READ_FAILURES: u32 = 5;

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    stop_signal: Arc<StopSignal>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    /// The reason the capture loop stopped on its own (device invalidated),
    /// once. `None` while healthy.
    pub fn take_stop_error(&self) -> Option<String> {
        self.stop_signal.take()
    }

    pub fn backend_name(&self) -> &'static str {
        "wasapi"
    }

    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }
}

// LIMITATION: We currently only capture from the eMultimedia/eConsole default
// render device (or a user-specified id). Many VoIP apps (Zoom, Teams, Discord,
// Meet) route audio to the eCommunications default — which the user can configure
// independently in Sound Settings. Loopback on the multimedia-default captures
// nothing while the meeting plays through the comms-default device. Adding
// eCommunications support requires raw windows-rs IMMDeviceEnumerator since
// wasapi 0.13 has no Role API. Tracked for follow-up.
fn find_device_by_id(direction: &Direction, device_id: &str) -> Option<wasapi::Device> {
    let collection = DeviceCollection::new(direction).ok()?;
    let count = collection.get_nbr_devices().ok()?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            if let Ok(id) = device.get_id() {
                if id == device_id {
                    return Some(device);
                }
            }
        }
    }
    None
}

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let collection =
        DeviceCollection::new(&Direction::Render).map_err(|e| anyhow::anyhow!("{}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    let mut list = Vec::new();
    
    let comms_id = default_communications_device_uid();

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let id = device.get_id().unwrap_or_default();
            let mut name = device.get_friendlyname().unwrap_or_default();
            if !id.is_empty() {
                if Some(id.clone()) == comms_id {
                    name.push_str(" (Default Communications)");
                }
                list.push((id, name));
            }
        }
    }
    Ok(list)
}

/// Returns the WASAPI device id of the current default render device on the
/// eMultimedia/eConsole role, or empty string on failure. JS polls this so the
/// SystemAudioCapture follows the user's output route when they switch
/// devices mid-meeting. Note: this still doesn't track the eCommunications
/// role separately (a known limitation tracked in find_device_by_id).
pub fn default_output_device_uid() -> String {
    match get_default_device(&Direction::Render) {
        Ok(dev) => dev.get_id().unwrap_or_default(),
        Err(_) => String::new(),
    }
}

/// Returns the WASAPI device id of the current default render device on the
/// eCommunications role, or None on failure. This is often different from eConsole
/// and is used by VoIP apps like Zoom, Teams, Meet.
pub fn default_communications_device_uid() -> Option<String> {
    unsafe {
        use windows::Win32::Media::Audio::{eCommunications, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eCommunications).ok()?;
        let id = device.GetId().ok()?;
        Some(id.to_string().ok()?)
    }
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    /// Spawn the WASAPI capture thread and wait for it to report its real
    /// sample rate. Returns Err if init fails or times out, so callers can
    /// surface the failure to JS instead of silently degrading to a fake
    /// stream that produces zero samples.
    pub fn stream(self) -> Result<SpeakerStream> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState { shutdown: false }));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let stop_signal = Arc::new(StopSignal::new());
        let (init_tx, init_rx) = mpsc::channel();

        let waker_clone = waker_state.clone();
        let data_ready_clone = data_ready.clone();
        let stop_signal_clone = stop_signal.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            if let Err(e) = Self::capture_audio_loop(
                producer,
                waker_clone,
                data_ready_clone,
                stop_signal_clone,
                init_tx,
                device_id,
            ) {
                error!("Audio capture loop failed: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                // Init failed. Tear down the thread we just spawned (it'll exit
                // on its own since capture_audio_loop already returned), then
                // bubble the error up to lib.rs which calls tsfn.call(Err(...)).
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!("WASAPI init failed: {}", e));
            }
            Err(_) => {
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!(
                    "WASAPI init timed out after 5s (no default render device, or device busy in exclusive mode)"
                ));
            }
        };

        Ok(SpeakerStream {
            consumer: Some(consumer),
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
            data_ready,
            stop_signal,
        })
    }

    fn capture_audio_loop(
        mut producer: HeapProd<f32>,
        waker_state: Arc<Mutex<WakerState>>,
        data_ready: Arc<(Mutex<bool>, Condvar)>,
        stop_signal: Arc<StopSignal>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        let init_result = (|| -> Result<_> {
            // Resolve target render device. If the saved device_id is stale
            // (unplugged, renamed, fresh install with leftover settings) we
            // must NOT panic — fall through to the default. If even that
            // errors, propagate via ? so init_tx surfaces the failure to JS
            // instead of letting the thread die silently and leaving callers
            // with a fake 44100Hz stream that never produces samples.
            let device = match device_id.as_deref() {
                Some(id) if !id.is_empty() => match find_device_by_id(&Direction::Render, id) {
                    Some(d) => d,
                    None => get_default_device(&Direction::Render)
                        .map_err(|e| anyhow::anyhow!("device '{}' not found and default lookup failed: {}", id, e))?,
                },
                _ => get_default_device(&Direction::Render)
                    .map_err(|e| anyhow::anyhow!("default render device unavailable: {}", e))?,
            };

            let mut audio_client = device
                .get_iaudioclient()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let device_format = audio_client
                .get_mixformat()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let actual_rate = device_format.get_samplespersec();
            let desired_format =
                WaveFormat::new(32, 32, &SampleType::Float, actual_rate as usize, 1, None);

            let (_def_time, min_time) = audio_client
                .get_periods()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            // For WASAPI loopback: device=Render, but initialize with Direction::Capture
            // This triggers AUDCLNT_STREAMFLAGS_LOOPBACK flag in wasapi
            audio_client
                .initialize_client(
                    &desired_format,
                    min_time,
                    &Direction::Capture,
                    &ShareMode::Shared,
                    true,
                )
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let h_event = audio_client
                .set_get_eventhandle()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let render_client = audio_client
                .get_audiocaptureclient()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            audio_client
                .start_stream()
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            // Session-disconnect notification (IAudioSessionEvents::
            // OnSessionDisconnected). This is the signal that fires when the
            // endpoint is removed or the format changes REGARDLESS of buffer
            // activity — an invalidated endpoint that simply stops pulsing
            // its event never reaches the read-failure counter below, because
            // the 3s wait timeout is also what silence looks like. Both the
            // control and the callbacks must stay alive for the loop's
            // lifetime (the registration holds only a Weak). Registration
            // failure is non-fatal: the read-failure counter still applies.
            let session_notification = (|| -> Result<(wasapi::AudioSessionControl, Rc<EventCallbacks>)> {
                let control = audio_client
                    .get_audiosessioncontrol()
                    .map_err(|e| anyhow::anyhow!("{}", e))?;
                let mut callbacks = EventCallbacks::new();
                let signal = stop_signal.clone();
                callbacks.set_disconnected_callback(move |reason: DisconnectReason| {
                    let msg = format!("WASAPI audio session disconnected ({:?})", reason);
                    eprintln!("[SystemAudio-WASAPI] {}", msg);
                    signal.raise(msg);
                });
                let callbacks = Rc::new(callbacks);
                control
                    .register_session_notification(Rc::downgrade(&callbacks))
                    .map_err(|e| anyhow::anyhow!("{}", e))?;
                Ok((control, callbacks))
            })();
            let session_notification = match session_notification {
                Ok(v) => Some(v),
                Err(e) => {
                    error!("[SystemAudio-WASAPI] session notification unavailable ({}); relying on read failures only", e);
                    None
                }
            };

            Ok((h_event, render_client, actual_rate, audio_client, session_notification))
        })();

        match init_result {
            Ok((h_event, render_client, sample_rate, audio_client, session_notification)) => {
                let _ = init_tx.send(Ok(sample_rate));
                let mut consecutive_read_failures: u32 = 0;
                loop {
                    // The session-disconnect callback (above) raised the signal
                    // from the COM notification thread; leave promptly so the
                    // DSP loop surfaces it instead of waiting on a dead event.
                    if stop_signal.is_raised() {
                        let _ = audio_client.stop_stream();
                        break;
                    }
                    {
                        let state = waker_state.lock().unwrap();
                        if state.shutdown {
                            let _ = audio_client.stop_stream();
                            break;
                        }
                    }

                    // Timeout is normal when no audio is playing — WASAPI loopback
                    // doesn't fire events during silence. Just continue waiting.
                    if h_event.wait_for_event(3000).is_err() {
                        continue;
                    }

                    let mut temp_queue = VecDeque::new();
                    // bytes_per_frame for 32-bit float mono = 4 bytes
                    let bytes_per_frame: usize = 4; // 32-bit float, 1 channel
                    if let Err(e) =
                        render_client.read_from_device_to_deque(bytes_per_frame, &mut temp_queue)
                    {
                        error!("Failed to read audio data: {}", e);
                        consecutive_read_failures += 1;
                        if consecutive_read_failures >= MAX_CONSECUTIVE_READ_FAILURES {
                            let reason = format!(
                                "WASAPI loopback read failed {} times in a row (device invalidated or endpoint changed): {}",
                                consecutive_read_failures, e
                            );
                            eprintln!("[SystemAudio-WASAPI] {}", reason);
                            stop_signal.raise(reason);
                            let _ = audio_client.stop_stream();
                            break;
                        }
                        continue;
                    }
                    consecutive_read_failures = 0;

                    if temp_queue.is_empty() {
                        continue;
                    }

                    let mut samples = Vec::with_capacity(temp_queue.len() / 4);
                    while temp_queue.len() >= 4 {
                        let bytes = [
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                        ];
                        let sample = f32::from_le_bytes(bytes);
                        samples.push(sample);
                    }

                    if !samples.is_empty() {
                        let _ = producer.push_slice(&samples);

                        // Signal data ready
                        let (lock, cvar) = &*data_ready;
                        let mut ready = lock.lock().unwrap();
                        *ready = true;
                        cvar.notify_all();
                    }
                }
                // Keep the registration alive for the whole loop; dropped here.
                drop(session_notification);
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
            }
        }
        Ok(())
    }
}

// Implement Drop to stop the thread
impl Drop for SpeakerStream {
    fn drop(&mut self) {
        if let Ok(mut state) = self.waker_state.lock() {
            state.shutdown = true;
        }
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}
