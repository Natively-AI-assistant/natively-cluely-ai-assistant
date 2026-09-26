// removed unused anyhow::Result

/// Shared by every backend — see stop_signal.rs for why a stopped stream must
/// be surfaced instead of read as silence.
pub mod stop_signal;

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
#[cfg(target_os = "macos")]
pub use sck::default_output_device_uid;
#[cfg(target_os = "macos")]
pub use sck::active_display_count;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use windows::list_output_devices;
#[cfg(target_os = "windows")]
pub use windows::SpeakerInput;
#[cfg(target_os = "windows")]
pub use windows::SpeakerStream;
#[cfg(target_os = "windows")]
pub use windows::default_output_device_uid;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "linux")]
pub use linux::list_output_devices;
#[cfg(target_os = "linux")]
pub use linux::SpeakerInput;
#[cfg(target_os = "linux")]
pub use linux::SpeakerStream;
#[cfg(target_os = "linux")]
pub use linux::default_output_device_uid;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub mod fallback {
    // Stub implementation for platforms without a native system-audio
    // backend. `new()` always returns an error, so `stream()` / `pause()` etc.
    // are never reached at runtime. These stubs keep the rest of the crate
    // type-checking on unsupported targets.
    use anyhow::Result;
    use ringbuf::HeapCons;
    pub struct SpeakerInput;
    pub struct SpeakerStream;
    impl SpeakerInput {
        pub fn new(_device_id: Option<String>) -> Result<Self> {
            Err(anyhow::anyhow!("Unsupported platform: system audio capture is implemented for macOS, Windows, and Linux"))
        }
        pub fn stream(self) -> Result<SpeakerStream> {
            Err(anyhow::anyhow!("Unsupported platform"))
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
    impl SpeakerStream {
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn take_stop_error(&self) -> Option<String> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn backend_name(&self) -> &'static str {
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

    pub fn default_output_device_uid() -> String {
        String::new()
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use fallback::list_output_devices;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use fallback::SpeakerInput;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use fallback::SpeakerStream;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use fallback::default_output_device_uid;
