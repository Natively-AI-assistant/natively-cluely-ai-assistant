// ScreenCaptureKit-based system audio capture
// Uses cidre 0.11.10 API with correct class registration and inner state

use anyhow::Result;
use cidre::sc::StreamOutput;
use cidre::{api, arc, cm, define_obj_type, dispatch, ns, objc, sc};
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};

// keep for compatibility
use cidre::core_audio as ca;

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let all_devices = ca::System::devices()?;
    let mut list = Vec::new();
    for device in all_devices {
        if let Ok(cfg) = device.output_stream_cfg() {
            if cfg.number_buffers() > 0 {
                let uid = device.uid().map(|u| u.to_string()).unwrap_or_default();
                let name = device.name().map(|n| n.to_string()).unwrap_or_default();
                if !uid.is_empty() {
                    list.push((uid, name));
                }
            }
        }
    }
    Ok(list)
}

/// Returns the UID of the current macOS default output device, or empty string
/// if none can be resolved. Used by main.ts to detect mid-meeting output route
/// changes (user plugs in headphones, switches to AirPods) — when the default
/// changes, the JS side recreates SystemAudioCapture so the CoreAudio Tap
/// follows the new route instead of capturing silence on the old device.
pub fn default_output_device_uid() -> String {
    match ca::System::default_output_device() {
        Ok(dev) => dev.uid().map(|u| u.to_string()).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

pub struct AudioHandlerInner {
    producer: HeapProd<f32>,
}

define_obj_type!(
    AudioHandler + sc::stream::OutputImpl,
    AudioHandlerInner,
    AUDIO_HANDLER_CLS
);

impl sc::stream::Output for AudioHandler {}

#[objc::add_methods]
impl sc::stream::OutputImpl for AudioHandler {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _stream: &sc::Stream,
        sample_buf: &mut cm::SampleBuf,
        kind: sc::stream::OutputType,
    ) {
        if kind != sc::stream::OutputType::Audio {
            return;
        }

        // Access inner state safely
        let inner = self.inner_mut();

        match sample_buf.audio_buf_list_in::<1>(cm::sample_buffer::Flags(0), None, None) {
            Ok(buf_list) => {
                let buffer_count = buf_list.list().number_buffers as usize;
                for i in 0..buffer_count {
                    let buffer = &buf_list.list().buffers[i];
                    let data_ptr = buffer.data as *const f32;
                    let byte_count = buffer.data_bytes_size as usize;

                    // Validate sample format (must be f32 aligned)
                    if byte_count == 0 || byte_count % 4 != 0 {
                        continue;
                    }

                    let float_count = byte_count / 4;

                    if float_count > 0 && !data_ptr.is_null() {
                        unsafe {
                            let slice = std::slice::from_raw_parts(data_ptr, float_count);
                            // Push audio to ring buffer
                            let _pushed = inner.producer.push_slice(slice);
                        }
                    }
                }
            }
            Err(e) => {
                println!("[SystemAudio-SCK] Failed to get audio buffer: {:?}", e);
            }
        }
    }
}

pub struct SpeakerInput {
    cfg: arc::R<sc::StreamCfg>,
    filter: arc::R<sc::ContentFilter>,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        // Gate on macOS 13.0+. sc::StreamCfg.set_captures_audio (and the rest of the
        // ScreenCaptureKit audio surface) was introduced in 13.0; on macOS 12 the
        // selector dispatch would abort the process the same way #249 did for
        // CoreAudio on 14.0-14.3. Fail clean so the JS layer can surface
        // "unsupported macOS" instead of a process crash.
        if !ns::ProcessInfo::current().is_os_at_least_version(api::OsVersion {
            major: 13,
            minor: 0,
            patch: 0,
        }) {
            return Err(anyhow::anyhow!(
                "ScreenCaptureKit audio capture requires macOS 13.0+ (current OS lacks SCStreamConfiguration.capturesAudio)"
            ));
        }

        println!("[SpeakerInput] Initializing ScreenCaptureKit audio capture...");

        // ScreenCaptureKit captures ALL system audio, not per-device. If the
        // user picked a non-default output device they should be told that
        // this fallback path silently ignores it.
        if let Some(ref id) = device_id {
            if !id.is_empty() && id != "default" && id != "sck" {
                eprintln!(
                    "[SpeakerInput] WARNING: ScreenCaptureKit fallback ignores device_id '{}' — will capture global system audio.",
                    id
                );
            }
        }

        // Get available content (triggers permission check) and wait for the
        // callback on a Condvar instead of polling. Pre-fix this loop slept
        // 100ms × 100 iterations; on a cold TCC dialog the user-perceived
        // hang was up to 10s with no UI feedback. Condvar wakes the instant
        // the callback fires.
        use std::sync::{Arc, Condvar, Mutex};

        type WaitSlot = Mutex<Option<Result<arc::R<sc::ShareableContent>>>>;
        let pair: Arc<(WaitSlot, Condvar)> = Arc::new((Mutex::new(None), Condvar::new()));
        let pair_clone = pair.clone();

        sc::ShareableContent::current_with_ch(move |content_opt, error_opt| {
            let result: Result<arc::R<sc::ShareableContent>> = if let Some(e) = error_opt {
                println!(
                    "[SpeakerInput] ERROR: ScreenCaptureKit access denied: {:?}",
                    e
                );
                Err(anyhow::anyhow!("ScreenCaptureKit access denied: {:?}", e))
            } else if let Some(c) = content_opt {
                Ok(c.retained())
            } else {
                Err(anyhow::anyhow!("SCK callback fired with neither content nor error"))
            };
            let (lock, cvar) = &*pair_clone;
            if let Ok(mut slot) = lock.lock() {
                *slot = Some(result);
                cvar.notify_all();
            }
        });

        let (lock, cvar) = &*pair;
        let mut slot = lock.lock().map_err(|_| anyhow::anyhow!("SCK content lock poisoned"))?;
        let timeout = std::time::Duration::from_secs(10);
        while slot.is_none() {
            let (s, wait_res) = cvar
                .wait_timeout(slot, timeout)
                .map_err(|_| anyhow::anyhow!("SCK wait poisoned"))?;
            slot = s;
            if wait_res.timed_out() {
                println!("[SpeakerInput] Please grant Screen Recording permission in System Settings > Privacy & Security");
                return Err(anyhow::anyhow!(
                    "ScreenCaptureKit content callback never fired (10s) — likely Screen Recording permission denied"
                ));
            }
        }
        let content = slot.take().unwrap()?;

        let displays = content.displays();
        if displays.is_empty() {
            return Err(anyhow::anyhow!("No displays found"));
        }

        let display = &displays[0];
        println!(
            "[SpeakerInput] Using display: {}x{}",
            display.width(),
            display.height()
        );

        // Create filter for desktop audio capture (entire display, no excluded windows)
        let empty_windows = ns::Array::<sc::Window>::new();
        let filter = sc::ContentFilter::with_display_excluding_windows(display, &empty_windows);

        // Configure for audio capture
        let mut cfg = sc::StreamCfg::new();
        cfg.set_captures_audio(true);
        cfg.set_sample_rate(48000);
        cfg.set_channel_count(1); // Mono - SCK doesn't affect system audio output quality
        cfg.set_excludes_current_process_audio(true);
        cfg.set_queue_depth(8);

        // Minimize video overhead
        cfg.set_width(2);
        cfg.set_height(2);
        cfg.set_minimum_frame_interval(cm::Time::new(1, 1)); // 1 FPS

        println!("[SpeakerInput] Config: 48kHz mono, queue_depth=8");

        Ok(Self { cfg, filter })
    }

    #[allow(dead_code)]
    pub fn sample_rate(&self) -> f64 {
        self.cfg.sample_rate() as f64
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        let buffer_size = 1024 * 128;
        let rb = HeapRb::<f32>::new(buffer_size);
        let (producer, consumer) = rb.split();

        let stream = sc::Stream::new(&self.filter, &self.cfg);

        // Initialize handler
        let inner = AudioHandlerInner { producer };
        let handler = AudioHandler::with(inner);

        let queue = dispatch::Queue::serial_with_ar_pool();

        if let Err(e) = stream.add_stream_output(
            handler.as_ref(),
            sc::stream::OutputType::Audio,
            Some(&queue),
        ) {
            return Err(anyhow::anyhow!(
                "ScreenCaptureKit add_stream_output failed: {:?}",
                e
            ));
        }

        println!("[SpeakerInput] Starting ScreenCaptureKit stream...");

        use std::sync::{Condvar, Mutex};

        // Wait on a Condvar instead of polling so we wake the instant the
        // start callback fires (was: 100 × 10ms polls + a stale "2s" log).
        let pair = std::sync::Arc::new((Mutex::new(None::<Result<()>>), Condvar::new()));
        let pair_clone = pair.clone();

        stream.start_with_ch(move |err| {
            let result = if let Some(e) = err {
                println!("[SpeakerInput] ERROR: Stream start FAILED: {:?}", e);
                println!("[SpeakerInput] Check Screen Recording permission in System Settings!");
                Err(anyhow::anyhow!("SCK start failed: {:?}", e))
            } else {
                println!("[SpeakerInput] ✅ Stream started successfully!");
                Ok(())
            };
            let (lock, cvar) = &*pair_clone;
            if let Ok(mut slot) = lock.lock() {
                *slot = Some(result);
                cvar.notify_all();
            }
        });

        let (lock, cvar) = &*pair;
        let mut slot = lock.lock().map_err(|_| anyhow::anyhow!("SCK lock poisoned"))?;
        let timeout = std::time::Duration::from_secs(3);
        while slot.is_none() {
            let (s, wait_res) = cvar
                .wait_timeout(slot, timeout)
                .map_err(|_| anyhow::anyhow!("SCK wait poisoned"))?;
            slot = s;
            if wait_res.timed_out() {
                return Err(anyhow::anyhow!(
                    "SCK start callback never fired (3s) — likely Screen Recording permission denied or revoked"
                ));
            }
        }
        slot.take().unwrap()?;

        Ok(SpeakerStream {
            consumer: Some(consumer),
            stream,
            _handler: handler,
            _filter: self.filter,
            _cfg: self.cfg,
        })
    }
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    stream: arc::R<sc::Stream>,
    _handler: arc::R<AudioHandler>,
    _filter: arc::R<sc::ContentFilter>,
    _cfg: arc::R<sc::StreamCfg>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        48000
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        use std::sync::{Arc, Condvar, Mutex};

        println!("[SpeakerStream] Stopping ScreenCaptureKit stream...");

        let stop_pair = Arc::new((Mutex::new(false), Condvar::new()));
        let pair_clone = stop_pair.clone();

        self.stream.stop_with_ch(move |_| {
            println!("[SpeakerStream] Stream stopped");
            let (lock, cvar) = &*pair_clone;
            let mut stopped = lock.lock().unwrap();
            *stopped = true;
            cvar.notify_one();
        });

        // Wait for stop completion (max 2 seconds)
        let (lock, cvar) = &*stop_pair;
        let mut stopped = lock.lock().unwrap();
        if !*stopped {
            let result = cvar
                .wait_timeout(stopped, std::time::Duration::from_secs(2))
                .unwrap();
            stopped = result.0;
            if !*stopped {
                println!("[SpeakerStream] WARNING: Stop callback not received after 2s");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for the macOS 13.0 gate on SCK audio capture. Pins the contract so
    /// a future cidre refactor that breaks `OsVersion::at_least` doesn't silently let the
    /// fallback crash on macOS 12 hosts (where SCStreamConfiguration.capturesAudio doesn't exist).
    #[test]
    fn os_version_gate_resolves_macos_13_on_modern_hosts() {
        assert!(
            api::OsVersion {
                major: 13,
                minor: 0,
                patch: 0
            }
            .at_least(),
            "macOS 13.0 should report at_least() == true on a >=13.0 host"
        );
    }

    #[test]
    fn os_version_gate_rejects_future_version_sck() {
        assert!(
            !api::OsVersion {
                major: 99,
                minor: 0,
                patch: 0
            }
            .at_least(),
            "macOS 99.0 must not report at_least() == true"
        );
    }

    /// Same contract via ProcessInfo — this is the exact API called from
    /// `SpeakerInput::new` on the SCK side.
    #[test]
    fn process_info_is_os_at_least_13_on_modern_hosts() {
        let pi = ns::ProcessInfo::current();
        assert!(
            pi.is_os_at_least_version(api::OsVersion {
                major: 13,
                minor: 0,
                patch: 0
            }),
            "ProcessInfo.isOperatingSystemAtLeastVersion(13.0) must be true on a >=13.0 host"
        );
        assert!(
            !pi.is_os_at_least_version(api::OsVersion {
                major: 99,
                minor: 0,
                patch: 0
            }),
            "ProcessInfo.isOperatingSystemAtLeastVersion(99.0) must be false"
        );
    }
}
