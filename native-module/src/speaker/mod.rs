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
    use anyhow::Result;
    use ringbuf::HeapCons;
    pub struct SpeakerInput;
    pub struct SpeakerStream;
    impl SpeakerInput {
        pub fn new(_device_id: Option<String>) -> Result<Self> {
            Err(anyhow::anyhow!("Unsupported platform"))
        }
        pub fn stream(self) -> Result<SpeakerStream> {
            Err(anyhow::anyhow!("Unsupported platform"))
        }
    }
    impl SpeakerStream {
        pub fn sample_rate(&self) -> u32 { 48000 }
        pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> { None }
        pub fn pause(&mut self) {}
        pub fn resume(&mut self) -> Result<()> { Ok(()) }
    }
    pub fn list_output_devices() -> Result<Vec<(String, String)>> {
        Ok(Vec::new())
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerStream;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::list_output_devices;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerInput;
