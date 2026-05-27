//! PulseAudio monitor-source loopback for Linux (PipeWire via pipewire-pulse).
use crate::audio_config::RING_BUFFER_SAMPLES;
use crate::speaker::{se, SystemAudioErrorCode};
use anyhow::Result;
use libpulse_binding as pulse;
use libpulse_binding::callbacks::ListResult;
use libpulse_binding::context::{Context, FlagSet as ContextFlagSet};
use libpulse_binding::mainloop::standard::Mainloop;
use libpulse_binding::sample::{Format, Spec};
use libpulse_binding::stream::Direction;
use libpulse_simple_binding::Simple;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use tracing::error;

struct WakerState {
    shutdown: bool,
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }

    pub fn pause(&mut self) {}

    pub fn resume(&mut self) -> Result<()> {
        Ok(())
    }
}

fn monitor_source_name(sink_name: &str) -> String {
    if sink_name.ends_with(".monitor") {
        sink_name.to_string()
    } else {
        format!("{}.monitor", sink_name)
    }
}

fn resolve_monitor_source(device_id: Option<String>) -> Result<String> {
    if let Some(id) = device_id.filter(|s| !s.is_empty() && s != "default") {
        return Ok(monitor_source_name(&id));
    }
    Ok(String::from("@DEFAULT_SINK@.monitor"))
}

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    let mut mainloop = Mainloop::new().ok_or_else(|| se(SystemAudioErrorCode::PulseNotAvailable))?;
    let mut context = Context::new(&mainloop, "natively-list-devices")
        .ok_or_else(|| se(SystemAudioErrorCode::PulseNotAvailable))?;

    context
        .connect(None, ContextFlagSet::NOFLAGS, None)
        .map_err(|_| se(SystemAudioErrorCode::PulseNotAvailable))?;

    let finished = Arc::new(AtomicBool::new(false));
    let devices = Arc::new(Mutex::new(Vec::<(String, String)>::new()));

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match context.get_state() {
            pulse::context::State::Ready => break,
            pulse::context::State::Failed | pulse::context::State::Terminated => {
                return Err(se(SystemAudioErrorCode::PulseNotAvailable));
            }
            _ => {
                mainloop.iterate(false);
                if std::time::Instant::now() > deadline {
                    return Err(se(SystemAudioErrorCode::InitTimeout));
                }
            }
        }
    }

    let finished_cb = finished.clone();
    let devices_cb = devices.clone();
    let _op = context.introspect().get_sink_info_list(move |result| {
        match result {
            ListResult::Item(info) => {
                let name = info
                    .name
                    .as_deref()
                    .unwrap_or("unknown")
                    .to_string();
                let desc = info
                    .description
                    .as_deref()
                    .unwrap_or(&name)
                    .to_string();
                let monitor = monitor_source_name(&name);
                if let Ok(mut list) = devices_cb.lock() {
                    list.push((monitor, format!("{} Monitor", desc)));
                }
            }
            ListResult::End | ListResult::Error => {
                finished_cb.store(true, Ordering::SeqCst);
            }
        }
    });

    let list_deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !finished.load(Ordering::SeqCst) {
        mainloop.iterate(false);
        if std::time::Instant::now() > list_deadline {
            return Err(se(SystemAudioErrorCode::InitTimeout));
        }
    }

    let list = devices
        .lock()
        .map_err(|_| se(SystemAudioErrorCode::PulseNotAvailable))?
        .clone();
    if list.is_empty() {
        return Ok(vec![(
            "@DEFAULT_SINK@.monitor".to_string(),
            "Default Output Monitor".to_string(),
        )]);
    }
    Ok(list)
}

pub fn default_output_device_uid() -> String {
    String::from("@DEFAULT_SINK@.monitor")
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        Ok(Self { device_id })
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState { shutdown: false }));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let (init_tx, init_rx) = mpsc::channel();

        let monitor_source = resolve_monitor_source(self.device_id)?;
        let waker_clone = waker_state.clone();
        let data_ready_clone = data_ready.clone();

        let capture_thread = thread::spawn(move || {
            if let Err(e) = capture_loop(
                producer,
                waker_clone,
                data_ready_clone,
                init_tx,
                monitor_source,
            ) {
                error!("PulseAudio capture loop failed: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(e);
            }
            Err(_) => {
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(se(SystemAudioErrorCode::InitTimeout));
            }
        };

        Ok(SpeakerStream {
            consumer: Some(consumer),
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
            data_ready,
        })
    }
}

fn capture_loop(
    mut producer: HeapProd<f32>,
    waker_state: Arc<Mutex<WakerState>>,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    init_tx: mpsc::Sender<Result<u32>>,
    monitor_source: String,
) -> Result<()> {
    const SAMPLE_RATE: u32 = 48000;
    let spec = Spec {
        format: Format::F32le,
        rate: SAMPLE_RATE,
        channels: 2,
    };
    if !spec.is_valid() {
        return Err(se(SystemAudioErrorCode::StreamConnectFailed));
    }

    let simple = Simple::new(
        None,
        "natively",
        Direction::Record,
        Some(monitor_source.as_str()),
        "System Audio Capture",
        &spec,
        None,
        None,
    )
    .map_err(|_| se(SystemAudioErrorCode::PulseNotAvailable))?;

    let _ = init_tx.send(Ok(SAMPLE_RATE));

    let mut buf = vec![0u8; 4096];
    loop {
        if waker_state.lock().map(|s| s.shutdown).unwrap_or(true) {
            break;
        }

        match simple.read(&mut buf) {
            Ok(()) => {
                let samples: Vec<f32> = buf
                    .chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect();
                let mono: Vec<f32> = samples
                    .chunks(2)
                    .map(|p| if p.len() == 2 { (p[0] + p[1]) * 0.5 } else { p[0] })
                    .collect();
                if !mono.is_empty() {
                    let _ = producer.push_slice(&mono);
                    let (lock, cvar) = &*data_ready;
                    if let Ok(mut ready) = lock.lock() {
                        *ready = true;
                        cvar.notify_all();
                    }
                }
            }
            Err(_e) => {
                if waker_state.lock().map(|s| s.shutdown).unwrap_or(true) {
                    break;
                }
                return Err(se(SystemAudioErrorCode::StreamConnectFailed));
            }
        }
    }
    Ok(())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_source_name_appends_suffix() {
        assert_eq!(
            monitor_source_name("alsa_output.pci.analog-stereo"),
            "alsa_output.pci.analog-stereo.monitor"
        );
    }

    #[test]
    fn resolve_default_monitor() {
        assert_eq!(
            resolve_monitor_source(None).unwrap(),
            "@DEFAULT_SINK@.monitor"
        );
    }
}
