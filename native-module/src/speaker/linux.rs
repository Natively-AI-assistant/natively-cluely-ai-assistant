//! Linux system-audio capture through the PulseAudio protocol exposed by
//! PipeWire (the normal audio stack on current Debian/Kali desktops).
//!
//! `parec` is deliberately used instead of linking libpulse directly.  That
//! keeps the N-API binary self-contained and works with both PulseAudio and
//! PipeWire's PulseAudio compatibility server.  The executable is a normal
//! desktop dependency (`pulseaudio-utils` on Debian-family systems), and a
//! missing executable is surfaced as a capture error rather than producing a
//! silent stream.

use super::stop_signal::StopSignal;
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::{anyhow, Result};
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

const CAPTURE_RATE: u32 = 16_000;

fn pactl(args: &[&str]) -> Result<String> {
    let output = Command::new("pactl")
        .args(args)
        .output()
        .map_err(|e| anyhow!("failed to execute pactl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!(
            "pactl {} failed{}",
            args.join(" "),
            if stderr.is_empty() {
                String::new()
            } else {
                format!(": {}", stderr)
            }
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn default_sink() -> Result<String> {
    let sink = pactl(&["get-default-sink"])?;
    if sink.is_empty() {
        return Err(anyhow!("pactl returned an empty default sink"));
    }
    Ok(sink)
}

fn monitor_source(device_id: Option<&str>) -> Result<String> {
    let requested = device_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && !id.eq_ignore_ascii_case("default"));
    let sink = match requested {
        Some(id) => id.to_string(),
        None => default_sink()?,
    };

    // Accept an explicit monitor source as well as the sink IDs returned by
    // list_output_devices(). This makes restored preferences and hand-written
    // configs behave predictably.
    if sink == "@DEFAULT_MONITOR@" || sink.ends_with(".monitor") {
        Ok(sink)
    } else {
        Ok(format!("{}.monitor", sink))
    }
}

fn spawn_parec(source: &str) -> Result<Child> {
    let mut child = Command::new("parec")
        .args([
            "--device",
            source,
            "--format",
            "s16le",
            "--rate",
            &CAPTURE_RATE.to_string(),
            "--channels",
            "1",
            "--raw",
            "--latency-msec",
            "20",
            "--client-name",
            "Natively",
            "--stream-name",
            "Natively System Audio",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| anyhow!("failed to start parec: {} (install pulseaudio-utils)", e))?;

    if child.stdout.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(anyhow!("parec started without a readable stdout pipe"));
    }

    Ok(child)
}

fn capture_pcm(
    mut stdout: impl Read,
    mut producer: HeapProd<f32>,
    stop_signal: Arc<StopSignal>,
    stop_requested: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) {
    let mut bytes = [0u8; 4096];
    let mut trailing_byte: Option<u8> = None;

    loop {
        match stdout.read(&mut bytes) {
            Ok(0) => {
                if !stop_requested.load(Ordering::Acquire) {
                    stop_signal.raise("Linux system-audio monitor (parec) exited unexpectedly");
                }
                break;
            }
            Ok(read) => {
                let mut offset = 0;

                if let Some(first) = trailing_byte.take() {
                    if read > 0 {
                        let sample = i16::from_le_bytes([first, bytes[0]]) as f32 / 32768.0;
                        if !paused.load(Ordering::Relaxed) {
                            let _ = producer.try_push(sample);
                        }
                        offset = 1;
                    }
                }

                while offset + 1 < read {
                    let sample =
                        i16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as f32 / 32768.0;
                    if !paused.load(Ordering::Relaxed) {
                        let _ = producer.try_push(sample);
                    }
                    offset += 2;
                }

                if offset < read {
                    trailing_byte = Some(bytes[offset]);
                }
            }
            Err(error) => {
                if !stop_requested.load(Ordering::Acquire) {
                    stop_signal.raise(format!("Linux system-audio monitor read failed: {}", error));
                }
                break;
            }
        }
    }
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        // Resolve the route before the capture thread is created so a missing
        // PipeWire/PulseAudio server fails immediately and visibly.
        let _ = monitor_source(device_id.as_deref())?;
        Ok(Self { device_id })
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        let source = monitor_source(self.device_id.as_deref())?;
        let mut child = spawn_parec(&source)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("parec stdout was not available"))?;

        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();
        let stop_signal = Arc::new(StopSignal::new());
        let stop_requested = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));

        let stop_signal_thread = stop_signal.clone();
        let stop_requested_thread = stop_requested.clone();
        let paused_thread = paused.clone();
        let capture_thread = thread::spawn(move || {
            capture_pcm(
                stdout,
                producer,
                stop_signal_thread,
                stop_requested_thread,
                paused_thread,
            );
        });

        println!(
            "[SpeakerInput] Linux PipeWire monitor active: source={}, rate={}Hz, mono s16le",
            source, CAPTURE_RATE
        );

        Ok(SpeakerStream {
            consumer: Some(consumer),
            capture_thread: Some(capture_thread),
            child: Some(child),
            stop_signal,
            stop_requested,
            paused,
        })
    }
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    child: Option<Child>,
    stop_signal: Arc<StopSignal>,
    stop_requested: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
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

    pub fn pause(&mut self) {
        self.paused.store(true, Ordering::Release);
    }

    pub fn resume(&mut self) -> Result<()> {
        self.paused.store(false, Ordering::Release);
        Ok(())
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        self.stop_requested.store(true, Ordering::Release);

        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }

        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let output = pactl(&["list", "short", "sinks"])?;
    let mut devices = Vec::new();

    for line in output.lines() {
        let mut fields = line.split('\t');
        let _index = fields.next();
        let Some(name) = fields.next().map(str::trim).filter(|name| !name.is_empty()) else {
            continue;
        };

        // The short format is stable and gives us the exact sink ID needed to
        // address its `.monitor` source. Keep the ID as the label fallback;
        // PipeWire names are still more useful than returning an empty list.
        devices.push((name.to_string(), name.to_string()));
    }

    Ok(devices)
}

pub fn default_output_device_uid() -> String {
    default_sink().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_source_normalizes_sink_ids() {
        assert_eq!(monitor_source(Some("speaker")).unwrap(), "speaker.monitor");
        assert_eq!(
            monitor_source(Some("speaker.monitor")).unwrap(),
            "speaker.monitor"
        );
        assert_eq!(
            monitor_source(Some("@DEFAULT_MONITOR@")).unwrap(),
            "@DEFAULT_MONITOR@"
        );
    }
}
