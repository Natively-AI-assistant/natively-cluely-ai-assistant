//! Linux system-audio capture: the monitor source of an output (sink) on
//! PulseAudio, or PipeWire through its PulseAudio server. Device ids are sink
//! names (`pactl`'s), the same ones the picker lists; capture reads
//! `<sink>.monitor`. macOS/Windows backends are CoreAudio tap / WASAPI loopback.
use super::stop_signal::StopSignal;
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::Result;
use libpulse_binding::def::BufferAttr;
use libpulse_binding::sample::{Format, Spec};
use libpulse_binding::stream::Direction;
use libpulse_simple_binding::Simple;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapRb,
};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

/// Pulse resamples + downmixes to this for us, so the DSP loop gets mono f32.
const CAPTURE_RATE: u32 = 48_000;
/// 10 ms of mono f32 per read, like the other backends' engine period.
const READ_FRAMES: usize = (CAPTURE_RATE / 100) as usize;

pub struct SpeakerInput {
    device_id: Option<String>,
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    stop_signal: Arc<StopSignal>,
    shutdown: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        CAPTURE_RATE
    }
    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }
    pub fn take_stop_error(&self) -> Option<String> {
        self.stop_signal.take()
    }
    pub fn backend_name(&self) -> &'static str {
        "pulse-monitor"
    }
    // Pause/resume are macOS-only in lib.rs; kept for a uniform surface.
    pub fn pause(&mut self) {}
    pub fn resume(&mut self) -> Result<()> {
        Ok(())
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        if let Some(h) = self.capture_thread.take() {
            let _ = h.join();
        }
    }
}

fn pactl(args: &[&str]) -> Option<String> {
    let out = Command::new("pactl").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `(sink name, description)` for every output. Parsed from `pactl list sinks`
/// (stable text, `LC_ALL=C`-independent keys `Name:` / `Description:`).
pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let text = pactl(&["list", "sinks"])
        .ok_or_else(|| anyhow::anyhow!("pactl unavailable (install pulseaudio-utils / pipewire-pulse)"))?;
    let mut list = Vec::new();
    let mut name = String::new();
    for line in text.lines().map(str::trim) {
        if let Some(n) = line.strip_prefix("Name:") {
            name = n.trim().to_string();
        } else if let Some(d) = line.strip_prefix("Description:") {
            if !name.is_empty() {
                list.push((std::mem::take(&mut name), d.trim().to_string()));
            }
        }
    }
    Ok(list)
}

pub fn default_output_device_uid() -> String {
    pactl(&["get-default-sink"]).map(|s| s.trim().to_string()).unwrap_or_default()
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        Ok(Self { device_id: device_id.filter(|id| !id.is_empty() && id != "default") })
    }

    pub fn sample_rate(&self) -> u32 {
        CAPTURE_RATE
    }
    pub fn pause(&mut self) -> Result<()> {
        Ok(())
    }
    pub fn resume(&mut self) -> Result<()> {
        Ok(())
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        let source = match &self.device_id {
            Some(sink) => format!("{sink}.monitor"),
            None => "@DEFAULT_MONITOR@".to_string(),
        };
        let spec = Spec { format: Format::F32le, channels: 1, rate: CAPTURE_RATE };
        let attr = BufferAttr {
            maxlength: u32::MAX,
            tlength: u32::MAX,
            prebuf: u32::MAX,
            minreq: u32::MAX,
            fragsize: (READ_FRAMES * 4) as u32, // low-latency fragments
        };
        // Fails here (not in the thread) so a missing sink surfaces as an init error.
        let pulse = Simple::new(
            None,
            "Natively",
            Direction::Record,
            Some(&source),
            "system audio",
            &spec,
            None,
            Some(&attr),
        )
        .map_err(|e| anyhow::anyhow!("PulseAudio open '{}' failed: {}", source, e))?;

        let (mut producer, consumer) = HeapRb::<f32>::new(RING_BUFFER_SAMPLES).split();
        let stop_signal = Arc::new(StopSignal::new());
        let shutdown = Arc::new(AtomicBool::new(false));
        let (stop, down) = (stop_signal.clone(), shutdown.clone());

        let capture_thread = thread::spawn(move || {
            let mut bytes = vec![0u8; READ_FRAMES * 4];
            while !down.load(Ordering::Acquire) {
                if let Err(e) = pulse.read(&mut bytes) {
                    stop.raise(format!("PulseAudio read failed: {e}"));
                    return;
                }
                let samples: Vec<f32> = bytes
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                let _ = producer.push_slice(&samples);
            }
        });

        Ok(SpeakerStream { consumer: Some(consumer), stop_signal, shutdown, capture_thread: Some(capture_thread) })
    }
}
