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
    pub struct SpeakerInput;
    impl SpeakerInput {
        pub fn new(_device_id: Option<String>) -> Result<Self> {
            Err(anyhow::anyhow!("Unsupported platform"))
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
