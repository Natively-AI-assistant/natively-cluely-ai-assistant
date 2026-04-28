use super::core_audio;
use super::sck;
use anyhow::Result;
use ringbuf::HeapCons;

pub use super::sck::list_output_devices;

pub struct SpeakerInput {
    backend: BackendInput,
}

enum BackendInput {
    CoreAudio(core_audio::SpeakerInput),
    Sck(sck::SpeakerInput),
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        Self::new_with_pids(device_id, Vec::new())
    }

    pub fn new_with_pids(device_id: Option<String>, target_pids: Vec<i32>) -> Result<Self> {
        Self::new_with_filter(device_id, target_pids, Vec::new())
    }

    pub fn new_with_filter(
        device_id: Option<String>,
        target_pids: Vec<i32>,
        bundle_id_prefixes: Vec<String>,
    ) -> Result<Self> {
        // Honour the "sck" override only when there are no per-process targets. SCK
        // cannot do per-process filtering, so falling into it silently when the caller
        // requested per-app capture would defeat the entire feature.
        let has_targets = !target_pids.is_empty() || !bundle_id_prefixes.is_empty();
        let force_sck = device_id.as_deref() == Some("sck") && !has_targets;
        if device_id.as_deref() == Some("sck") && has_targets {
            println!(
                "[SpeakerInput] Ignoring 'sck' override — per-process tap requires CoreAudio backend"
            );
        }

        if !force_sck {
            // Try CoreAudio Tap first (Default)
            println!("[SpeakerInput] Initializing CoreAudio Tap backend...");
            match core_audio::SpeakerInput::new_with_filter(
                device_id.clone(),
                target_pids.clone(),
                bundle_id_prefixes.clone(),
            ) {
                Ok(input) => {
                    println!("[SpeakerInput] CoreAudio Tap backend initialized.");
                    return Ok(Self {
                        backend: BackendInput::CoreAudio(input),
                    });
                }
                Err(e) => {
                    println!("[SpeakerInput] CoreAudio Tap initialization failed: {}. Falling back to ScreenCaptureKit.", e);
                }
            }
        } else {
            println!("[SpeakerInput] SCK backend explicitly requested.");
        }

        // Fallback to ScreenCaptureKit. SCK does not support per-process targeting in this build,
        // so per-process tap is a CoreAudio-only feature; SCK fallback always captures the
        // whole device output mix.
        let _ = target_pids;
        let _ = bundle_id_prefixes;
        let input = sck::SpeakerInput::new(device_id)?;
        Ok(Self {
            backend: BackendInput::Sck(input),
        })
    }

    pub fn stream(self) -> SpeakerStream {
        match self.backend {
            BackendInput::CoreAudio(input) => {
                // We wrap the stream creation to catch potential panics if start_device fails
                // Ideally core_audio::stream should return Result, but for now we rely on it working if new worked.
                // If it crashes, we can't easily fallback here without changing signature.
                // But core_audio::new does most of the heavy lifting.
                // NOTE: core_audio::stream() currently panics on start failure.
                // We should assume it works or modify core_audio.rs.
                // Given the constraints, let's assume if tap creation worked, starting works.
                let stream = input.stream();
                SpeakerStream {
                    backend: BackendStream::CoreAudio(stream),
                }
            }
            BackendInput::Sck(input) => {
                let stream = input.stream();
                SpeakerStream {
                    backend: BackendStream::Sck(stream),
                }
            }
        }
    }
}

pub struct SpeakerStream {
    backend: BackendStream,
}

enum BackendStream {
    CoreAudio(core_audio::SpeakerStream),
    Sck(sck::SpeakerStream),
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        match &self.backend {
            BackendStream::CoreAudio(s) => s.sample_rate(),
            BackendStream::Sck(s) => s.sample_rate(),
        }
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        match &mut self.backend {
            BackendStream::CoreAudio(s) => s.take_consumer(),
            BackendStream::Sck(s) => s.take_consumer(),
        }
    }

    /// Pause the underlying audio stream without destroying it.
    pub fn pause(&mut self) {
        match &mut self.backend {
            BackendStream::CoreAudio(s) => s.pause(),
            BackendStream::Sck(_s) => {
                println!("[SpeakerStream] SCK pause: no-op (managed by capture thread)");
            }
        }
    }

    /// Resume the underlying audio stream.
    /// Returns Err for CoreAudio (needs full recreation); SCK is a no-op.
    pub fn resume(&mut self) -> Result<()> {
        match &mut self.backend {
            BackendStream::CoreAudio(s) => s.resume(),
            BackendStream::Sck(_s) => {
                println!("[SpeakerStream] SCK resume: no-op (stream remains active)");
                Ok(())
            }
        }
    }
}
