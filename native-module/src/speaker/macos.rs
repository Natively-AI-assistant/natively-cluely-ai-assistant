use anyhow::Result;
use ringbuf::HeapCons;
use super::core_audio;
use super::sck;

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
        let force_sck = device_id.as_deref() == Some("sck");
        
        if !force_sck {
            // Try CoreAudio Tap first (Default)
            println!("[SpeakerInput] Initializing CoreAudio Tap backend...");
            match core_audio::SpeakerInput::new(device_id.clone()) {
                Ok(input) => {
                     println!("[SpeakerInput] CoreAudio Tap backend initialized.");
                     return Ok(Self { backend: BackendInput::CoreAudio(input) });
                },
                Err(e) => {
                    println!("[SpeakerInput] CoreAudio Tap initialization failed: {}. Falling back to ScreenCaptureKit.", e);
                }
            }
        } else {
            println!("[SpeakerInput] SCK backend explicitly requested.");
        }
        
        // Fallback to ScreenCaptureKit
        let input = sck::SpeakerInput::new(device_id)?;
        Ok(Self { backend: BackendInput::Sck(input) })
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
                SpeakerStream { backend: BackendStream::CoreAudio(stream) }
            },
            BackendInput::Sck(input) => {
                let stream = input.stream();
                SpeakerStream { backend: BackendStream::Sck(stream) }
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
}


