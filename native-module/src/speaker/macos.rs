use super::core_audio;
use super::sck;
use anyhow::Result;
use ringbuf::HeapCons;

pub use super::sck::active_display_count;
pub use super::sck::list_output_devices;

/// A device_id of `input:<name>` captures system audio from a virtual INPUT
/// device (BlackHole and friends) that the user routes the system sound into
/// via a Multi-Output Device. Mirrors SYSTEM_AUDIO_INPUT_PREFIX in
/// electron/audio/audioDeviceSelection.mjs. This is the only system-audio path
/// on macOS < 13: the CoreAudio process tap needs 14.4 and ScreenCaptureKit
/// audio needs 13.0.
const INPUT_DEVICE_PREFIX: &str = "input:";

pub struct SpeakerInput {
    backend: BackendInput,
}

enum BackendInput {
    CoreAudio(core_audio::SpeakerInput),
    Sck(sck::SpeakerInput),
    InputDevice(crate::microphone::MicrophoneStream),
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        // Explicit virtual-input choice: no CoreAudio/SCK fallback. A missing
        // BlackHole must surface as "Input device '…' not found" (microphone.rs
        // resolve_input_device), not be hidden behind a fallback failure.
        if let Some(name) = device_id.as_deref().and_then(|d| d.strip_prefix(INPUT_DEVICE_PREFIX)) {
            println!("[SpeakerInput] Input-device backend requested: {}", name);
            let mic = crate::microphone::MicrophoneStream::new(Some(name.to_string()))?;
            return Ok(Self {
                backend: BackendInput::InputDevice(mic),
            });
        }

        let force_sck = device_id.as_deref() == Some("sck");

        if !force_sck {
            // Try CoreAudio Tap first (Default)
            println!("[SpeakerInput] Initializing CoreAudio Tap backend...");
            match core_audio::SpeakerInput::new(device_id.clone()) {
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

        // Fallback to ScreenCaptureKit
        let input = sck::SpeakerInput::new(device_id)?;
        Ok(Self {
            backend: BackendInput::Sck(input),
        })
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        match self.backend {
            BackendInput::CoreAudio(input) => {
                let stream = input.stream()?;
                Ok(SpeakerStream {
                    backend: BackendStream::CoreAudio(stream),
                })
            }
            BackendInput::Sck(input) => {
                let stream = input.stream()?;
                Ok(SpeakerStream {
                    backend: BackendStream::Sck(stream),
                })
            }
            BackendInput::InputDevice(mic) => {
                mic.play()?;
                Ok(SpeakerStream {
                    backend: BackendStream::InputDevice(mic),
                })
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
    // ponytail: left channel only (microphone.rs mixes channel 0); average
    // channels if a mono-mixed system source ever matters.
    InputDevice(crate::microphone::MicrophoneStream),
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        match &self.backend {
            BackendStream::CoreAudio(s) => s.sample_rate(),
            BackendStream::Sck(s) => s.sample_rate(),
            BackendStream::InputDevice(s) => s.sample_rate(),
        }
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        match &mut self.backend {
            BackendStream::CoreAudio(s) => s.take_consumer(),
            BackendStream::Sck(s) => s.take_consumer(),
            BackendStream::InputDevice(s) => s.take_consumer(),
        }
    }

    /// The reason the platform stopped the stream underneath us, once.
    /// `None` while healthy. CoreAudio taps have no stop callback of their own;
    /// their route changes are handled by main.ts's default-output watcher.
    pub fn take_stop_error(&self) -> Option<String> {
        match &self.backend {
            BackendStream::CoreAudio(_) => None,
            BackendStream::Sck(s) => s.take_stop_error(),
            BackendStream::InputDevice(s) => s.err_signal().lock().ok().and_then(|mut e| e.take()),
        }
    }

    /// Which backend actually ended up capturing — the JS side compares this
    /// with what the user requested ("sck") to notice a silent fallback.
    pub fn backend_name(&self) -> &'static str {
        match &self.backend {
            BackendStream::CoreAudio(s) => s.backend_name(),
            BackendStream::Sck(s) => s.backend_name(),
            BackendStream::InputDevice(_) => "input-device",
        }
    }

    /// Pause the underlying audio stream without destroying it.
    pub fn pause(&mut self) {
        match &mut self.backend {
            BackendStream::CoreAudio(s) => s.pause(),
            BackendStream::Sck(_s) => {
                println!("[SpeakerStream] SCK pause: no-op (managed by capture thread)");
            }
            BackendStream::InputDevice(s) => {
                let _ = s.pause();
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
            BackendStream::InputDevice(s) => s.play(),
        }
    }
}
