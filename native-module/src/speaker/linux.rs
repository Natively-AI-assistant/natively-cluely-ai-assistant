// Linux speaker (system audio) capture via PulseAudio monitor-source loopback.
//
// Works on both X11 and Wayland via:
//   - native PulseAudio (legacy Linux audio servers)
//   - pipewire-pulse (PulseAudio compatibility layer that PipeWire ships with
//     by default on Ubuntu 22.04+, Fedora Workstation, etc.)
//
// Strategy: open a recording stream on the monitor source of the default sink.
// PulseAudio mirrors every audio output to the corresponding "monitor" source,
// which is exactly what WASAPI loopback does on Windows.
//
// Threading model: PulseAudio streams MUST be driven by a mainloop on the
// same thread that created them. We therefore dedicate a capture thread to
// owning the mainloop + stream. On the capture thread, we iterate the
// mainloop in a `loop { iterate(); read_some(); }` pattern:
//   - iterate() runs PA callbacks (including the read callback)
//   - read_some() drains the stream's internal buffer into our ringbuf
// This is simpler than driving the read callback to push directly, because
// peek/discard require &mut Stream, and the callback also takes &mut Stream
// — keeping the actual buffer drain in the main loop avoids aliasing.
//
// Build requirement: libpulse-dev (libpulse.so + headers). The
// libpulse-binding crate's build script invokes pkg-config to find the
// headers; on Debian/Ubuntu install libpulse-dev, on Fedora install
// pulseaudio-libs-devel.
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::{anyhow, Result};
use libpulse_binding as pulse;
use pulse::context::{Context, FlagSet as ContextFlagSet, State as ContextState};
use pulse::mainloop::standard::Mainloop as StandardMainLoop;
use pulse::operation::State as OpState;
use pulse::sample::{Format, Spec};
use pulse::stream::{FlagSet as StreamFlagSet, Stream};
use ringbuf::traits::{Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tracing::error;
use tracing::warn;

struct CaptureState {
    shutdown: bool,
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    capture_state: Arc<Mutex<CaptureState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        if let Ok(mut s) = self.capture_state.lock() {
            s.shutdown = true;
        }
        if let Some(t) = self.capture_thread.take() {
            let _ = t.join();
        }
    }
}

/// Enumerate output sinks. (uid, description) pairs. UID is the sink name
/// (which doubles as the prefix for its monitor source: `<name>.monitor`).
pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let mut mainloop = StandardMainLoop::new().ok_or_else(|| anyhow!("PA mainloop"))?;
    let mut context = Context::new(&mainloop, "natively-list")
        .ok_or_else(|| anyhow!("PA context"))?;
    context
        .connect(None, ContextFlagSet::NOFAIL, None)
        .map_err(|_| anyhow!("PA connect"))?;

    let mut tries = 0;
    while !matches!(context.get_state(), ContextState::Ready) {
        mainloop.iterate(false);
        tries += 1;
        if tries > 200 {
            return Err(anyhow!("PA context ready timeout"));
        }
        thread::sleep(Duration::from_millis(10));
    }

    let results: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let results_cb = results.clone();
    let op = context.introspect().get_sink_info_list(move |result| {
        if let pulse::callbacks::ListResult::Item(info) = result {
            let name = info.name.as_ref().map(|n| n.to_string()).unwrap_or_default();
            let desc = info
                .description
                .as_ref()
                .map(|d| d.to_string())
                .unwrap_or_else(|| name.clone());
            if !name.is_empty() {
                results_cb.lock().unwrap().push((name, desc));
            }
        }
    });
    wait_for_op(&mut mainloop, &op);

    let mut list = results.lock().unwrap().clone();
    list.sort();
    list.dedup();
    Ok(list)
}

/// Returns the sink name of the current default sink, or empty string on failure.
pub fn default_output_device_uid() -> String {
    let Some(mut mainloop) = StandardMainLoop::new() else {
        return String::new();
    };
    let Some(mut context) = Context::new(&mainloop, "natively-default") else {
        return String::new();
    };
    if context.connect(None, ContextFlagSet::NOFAIL, None).is_err() {
        return String::new();
    }
    let mut tries = 0;
    while !matches!(context.get_state(), ContextState::Ready) {
        mainloop.iterate(false);
        tries += 1;
        if tries > 200 {
            return String::new();
        }
        thread::sleep(Duration::from_millis(10));
    }

    let result: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let result_cb = result.clone();
    let op = context.introspect().get_server_info(move |info| {
        if let Some(name) = info.default_sink_name.as_ref() {
            *result_cb.lock().unwrap() = Some(name.to_string());
        }
    });
    wait_for_op(&mut mainloop, &op);

    let result_str = result.lock().unwrap().clone().unwrap_or_default();
    drop(result); // Release the MutexGuard before returning
    result_str
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    /// Spawn the PulseAudio capture thread. Returns the negotiated sample rate.
    pub fn stream(self) -> Result<SpeakerStream> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let capture_state = Arc::new(Mutex::new(CaptureState {
            shutdown: false,
        }));
        let (init_tx, init_rx) = mpsc::channel::<Result<u32>>();

        let state_clone = capture_state.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            if let Err(e) = Self::capture_audio_loop(producer, state_clone, init_tx, device_id) {
                error!("[LinuxSpeaker] capture loop exited: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                if let Ok(mut s) = capture_state.lock() {
                    s.shutdown = true;
                }
                return Err(anyhow!("PulseAudio init failed: {}", e));
            }
            Err(_) => {
                if let Ok(mut s) = capture_state.lock() {
                    s.shutdown = true;
                }
                return Err(anyhow!(
                    "PulseAudio init timed out after 5s (no server, or sink busy)"
                ));
            }
        };

        Ok(SpeakerStream {
            consumer: Some(consumer),
            capture_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
        })
    }

    fn capture_audio_loop(
        mut producer: HeapProd<f32>,
        capture_state: Arc<Mutex<CaptureState>>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        let mut mainloop = StandardMainLoop::new()
            .ok_or_else(|| anyhow!("creating PulseAudio mainloop"))?;
        let mut context = Context::new(&mainloop, "natively-speaker")
            .ok_or_else(|| anyhow!("creating PulseAudio context"))?;
context
        .connect(None, ContextFlagSet::NOFAIL, None)
        .map_err(|e| anyhow!("PA connect: {}", e))?;

        // Wait for context ready (2s budget).
        let mut tries = 0;
        while !matches!(context.get_state(), ContextState::Ready) {
            mainloop.iterate(false);
            tries += 1;
            if tries > 200 {
                let _ = init_tx.send(Err(anyhow!("PA context ready timeout")));
                return Err(anyhow!("PA context ready timeout"));
            }
            thread::sleep(Duration::from_millis(10));
            if matches!(context.get_state(), ContextState::Failed | ContextState::Terminated) {
                let _ = init_tx.send(Err(anyhow!("PA context failed/terminated")));
                return Err(anyhow!("PA context failed/terminated"));
            }
        }

        // Resolve monitor source.
        let monitor_source = match Self::resolve_monitor_source(&mut mainloop, &context, device_id) {
            Ok(s) => s,
            Err(e) => {
                let _ = init_tx.send(Err(anyhow!("{}", e)));
                return Err(anyhow!("{}", e));
            }
        };

        // Build spec: F32le stereo at 48kHz. PA resamples from the hardware
        // rate if needed.
        let spec = Spec {
            format: Format::F32le,
            rate: 48000,
            channels: 2,
        };
        if !spec.is_valid() {
            let _ = init_tx.send(Err(anyhow!("invalid PulseAudio sample spec")));
            return Err(anyhow!("invalid PulseAudio sample spec"));
        }

        // Stream attributes:
        //   ADJUST_LATENCY: let PA pick a sensible buffer size
        //   DONT_MOVE: don't migrate the stream if the default sink changes
        //     mid-meeting — we'd lose the monitor otherwise
        // (DAUDIOCAPTURE / PA_STREAM_RECORD is the implicit default for
        // connect_record and isn't exposed as a stream flag in libpulse-binding.)
        let mut attrs = StreamFlagSet::empty();
        attrs.insert(StreamFlagSet::ADJUST_LATENCY);
        attrs.insert(StreamFlagSet::DONT_MOVE);

        // Build the stream object. We need a unique name to avoid conflicts
        // with other PA clients. Stream::new requires &mut Context.
        let mut stream = Stream::new(&mut context, "natively-capture", &spec, None)
            .ok_or_else(|| anyhow!("creating PA stream"))?;

        // Connect to the monitor source. The stream moves to "ready" state
        // when PA has finished setup. We don't need to wait for a callback
        // here — the connect_record call returns synchronously, and the
        // stream is usable immediately (calls to peek/iterate will block
        // until data arrives).
        stream
            .connect_record(Some(&monitor_source), None, attrs)
            .map_err(|e| anyhow!("PA connect_record failed: {}", e))?;

        // Read back the actual sample rate PA negotiated (PA may resample
        // from the hardware rate).
        let actual_rate = stream.get_sample_spec().map(|s| s.rate).unwrap_or(48000);

        // Signal init complete.
        let _ = init_tx.send(Ok(actual_rate));

        // Main capture loop: iterate the mainloop + drain the stream's
        // internal buffer into our ringbuf. The mainloop processes PA
        // callbacks; we drain via peek/discard which require &mut Stream
        // (not usable from inside a callback, so we do it here).
        loop {
            // Shutdown check.
            {
                let shutdown = capture_state
                    .lock()
                    .map(|s| s.shutdown)
                    .unwrap_or(true);
                if shutdown {
                    break;
                }
            }

            // Process PA callbacks (including any read callbacks).
            mainloop.iterate(false);

            // Drain the stream's buffer. We do this in a loop because
            // peek+discard can be called repeatedly until the buffer is
            // empty (each call returns at most one "fragment" of audio).
            //
            // SAFETY: peek returns a `&[u8]` borrowed from PA's internal
            // buffer. We immediately copy into f32 frames (PA gave us F32le)
            // and then discard. The peek/discard pair must be called with no
            // other PA API calls in between on the same stream.
            loop {
                let slice = match stream.peek() {
                    Ok(pulse::stream::PeekResult::Data(s)) => s,
                    Ok(pulse::stream::PeekResult::Empty) => break,
                    Ok(pulse::stream::PeekResult::Hole(_)) => {
                        // Hole = PA detected a gap in the stream (e.g. sink
                        // disconnected). Skip it; PA advances the read pointer.
                        stream.discard().ok();
                        continue;
                    }
                    Err(e) => {
                        error!("[LinuxSpeaker] peek error: {}", e);
                        return Ok(());
                    }
                };

                // Reinterpret F32le bytes as f32 frames. The slice length
                // should always be a multiple of 4 (frame_size) because
                // we declared channels=2 and Format::F32le. We slice to the
                // largest multiple to be safe.
                let frame_size = std::mem::size_of::<f32>();
                let n_full_frames = slice.len() / frame_size;
                let bytes_to_use = n_full_frames * frame_size;
                let frames = unsafe {
                    std::slice::from_raw_parts(slice.as_ptr() as *const f32, n_full_frames)
                };

                // Push into the ringbuf. If the ringbuf is full we drop
                // remaining samples (better than blocking the capture thread).
                let mut idx = 0;
                while idx < frames.len() {
                    let pushed = producer.push_slice(&frames[idx..]);
                    if pushed == 0 {
                        break;
                    }
                    idx += pushed;
                }

                // Advance PA's read pointer.
                let _ = bytes_to_use;
                if let Err(e) = stream.discard() {
                    error!("[LinuxSpeaker] discard error: {}", e);
                    return Ok(());
                }
            }

            // Don't busy-spin. 5ms = ~200 wakeups/sec which is plenty for
            // 48kHz audio (a 10ms buffer at 48kHz is 480 frames; 5ms gives
            // us ~1 wakeup per buffer).
            thread::sleep(Duration::from_millis(5));
        }

        Ok(())
    }

    fn resolve_monitor_source(
        mainloop: &mut StandardMainLoop,
        context: &Context,
        device_id: Option<String>,
    ) -> Result<String> {
        match device_id {
            Some(ref id) => {
                let candidate = format!("{}.monitor", id);
                let exists: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
                let exists_cb = exists.clone();
                let op =
                    context
                        .introspect()
                        .get_source_info_by_name(&candidate, move |result| {
                            if matches!(
                                result,
                                pulse::callbacks::ListResult::Item(_)
                            ) {
                                *exists_cb.lock().unwrap() = true;
                            }
                        });
                wait_for_op(mainloop, &op);

                if *exists.lock().unwrap() {
                    Ok(candidate)
                } else {
                    warn!(
                        "[LinuxSpeaker] sink '{}' not found or has no monitor; falling back to default",
                        id
                    );
                    Self::default_monitor_source(mainloop, context)
                }
            }
            None => Self::default_monitor_source(mainloop, context),
        }
    }

    fn default_monitor_source(
        mainloop: &mut StandardMainLoop,
        context: &Context,
    ) -> Result<String> {
        let result: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let result_cb = result.clone();
        let op = context.introspect().get_server_info(move |info| {
            if let Some(name) = info.default_sink_name.as_ref() {
                *result_cb.lock().unwrap() = Some(name.to_string());
            }
        });
        wait_for_op(mainloop, &op);

        let sink = result
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| anyhow!("no default sink in PulseAudio"))?;
        Ok(format!("{}.monitor", sink))
    }
}

fn wait_for_op<C: ?Sized>(
    mainloop: &mut StandardMainLoop,
    op: &pulse::operation::Operation<C>,
) {
    let mut tries = 0;
    while !matches!(op.get_state(), OpState::Done) {
        mainloop.iterate(false);
        tries += 1;
        if tries > 1000 {
            break; // Don't hang forever; return whatever PA gave us.
        }
        thread::sleep(Duration::from_millis(1));
    }
}