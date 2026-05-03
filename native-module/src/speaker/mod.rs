// removed unused anyhow::Result

#[cfg(target_os = "macos")]
mod core_audio;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
mod sck;
#[cfg(target_os = "macos")]
pub use macos::list_output_devices;
#[cfg(target_os = "macos")]
pub use macos::SpeakerInput;
#[cfg(target_os = "macos")]
pub use macos::SpeakerStream;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use windows::list_output_devices;
#[cfg(target_os = "windows")]
pub use windows::SpeakerInput;
#[cfg(target_os = "windows")]
pub use windows::SpeakerStream;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub mod fallback {
    // Stub implementation for Linux (and any other unsupported platform).
    // The system-audio capture pipeline is macOS/Windows only — `new()` always
    // returns an error, so `stream()` / `pause()` etc. are never reached at
    // runtime. These stubs exist only so the rest of the crate (lib.rs) still
    // type-checks on Linux instead of failing with E0599 on `.stream()` calls.
    // See issue #219.
    use anyhow::Result;
    use ringbuf::HeapCons;

    pub struct SpeakerInput;
    impl SpeakerInput {
        pub fn new(_device_id: Option<String>) -> Result<Self> {
            Err(anyhow::anyhow!("Unsupported platform: system audio capture is implemented for macOS and Windows only"))
        }
        pub fn stream(self) -> SpeakerStream {
            unreachable!("SpeakerInput::new() always errors on this platform; stream() should never be called")
        }
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
        pub fn pause(&mut self) -> Result<()> {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
        pub fn resume(&mut self) -> Result<()> {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
    }

    pub struct SpeakerStream;
    impl SpeakerStream {
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn pause(&mut self) {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn resume(&mut self) -> Result<()> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
    }

    pub fn list_output_devices() -> Result<Vec<(String, String)>> {
        Ok(Vec::new())
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::list_output_devices;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerInput;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerStream;
