use std::collections::hash_map::DefaultHasher;
use std::ffi::c_void;
use std::hash::{Hash, Hasher};
use std::mem::size_of;
use std::ptr::null_mut;
use std::thread;
use std::time::{Duration, Instant};

use windows::core::PWSTR;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToString};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{CreateEventW, GetCurrentThreadId, WaitForSingleObject};

const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
const KSDATAFORMAT_SUBTYPE_PCM: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

struct ComGuard;
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

struct CoTaskMemWaveFormat(*mut WAVEFORMATEX);
impl CoTaskMemWaveFormat {
    fn new(ptr: *mut WAVEFORMATEX) -> Result<Self, String> {
        if ptr.is_null() {
            Err("GetMixFormat returned null".into())
        } else {
            Ok(Self(ptr))
        }
    }
    fn ptr(&self) -> *const WAVEFORMATEX {
        self.0.cast_const()
    }
    fn format(&self) -> &WAVEFORMATEX {
        unsafe { &*self.0 }
    }
    fn allocation_bytes(&self) -> usize {
        size_of::<WAVEFORMATEX>() + self.format().cbSize as usize
    }
}
impl Drop for CoTaskMemWaveFormat {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0.cast::<c_void>())) };
    }
}

struct WinHandle(HANDLE);
impl Drop for WinHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum SampleKind {
    Float,
    Pcm,
    Unknown,
}

#[derive(Clone, Debug)]
struct FormatInfo {
    tag: u16,
    channels: u16,
    rate: u32,
    bits: u16,
    valid_bits: u16,
    block_align: u16,
    avg_bytes_per_sec: u32,
    cb_size: u16,
    channel_mask: u32,
    sub_format: windows::core::GUID,
    kind: SampleKind,
}

#[derive(Default)]
struct CaptureStats {
    packets: u64,
    frames: u64,
    active_frames: u64,
    silent_frames: u64,
    samples: u64,
    silent_packets: u64,
    peak: f64,
    square_sum: f64,
}
impl CaptureStats {
    fn rms(&self) -> f64 {
        if self.samples == 0 {
            0.0
        } else {
            (self.square_sum / self.samples as f64).sqrt()
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let endpoint_match = args
        .iter()
        .find_map(|arg| arg.strip_prefix("--match=").map(str::to_owned));
    let result = thread::Builder::new()
        .name("wasapi-baseline-com-audio".into())
        .spawn(move || run(endpoint_match.as_deref()))
        .and_then(|handle| {
            handle
                .join()
                .map_err(|_| std::io::Error::other("audio thread panicked"))
        });
    match result {
        Ok(Ok(())) => println!("BASELINE_RESULT=PASS"),
        Ok(Err(error)) => {
            eprintln!("BASELINE_RESULT=FAIL stage={error}");
            std::process::exit(1);
        }
        Err(error) => {
            eprintln!("BASELINE_RESULT=FAIL stage=thread error={error}");
            std::process::exit(1);
        }
    }
}

fn run(endpoint_match: Option<&str>) -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .map_err(|e| format!("CoInitializeEx hresult={:#010x}", e.code().0 as u32))?;
    let _com = ComGuard;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|e| format!("CoCreateInstance hresult={:#010x}", e.code().0 as u32))?;
    let endpoint = select_endpoint(&enumerator, endpoint_match)?;
    let name = friendly_name(&endpoint).unwrap_or_else(|_| "unknown capture endpoint".into());
    let id = endpoint_id(&endpoint)?;
    println!(
        "endpoint friendlyName={name:?} endpointIdHash={}",
        stable_hash(&id)
    );

    println!("phase=timer-baseline state=starting durationMs=3000");
    let timer_stats = capture(&endpoint, false, Duration::from_secs(3))?;
    println!("phase=timer-baseline state=passed initializeHresult=0x00000000 packets={} frames={} activeFrames={} silentFrames={} peak={:.6} rms={:.6} silentPackets={}",
        timer_stats.packets, timer_stats.frames, timer_stats.active_frames, timer_stats.silent_frames, timer_stats.peak, timer_stats.rms(), timer_stats.silent_packets);
    println!("MIC_BASELINE_TIMER_INITIALIZE=SUCCESS");
    println!(
        "MIC_BASELINE_TIMER_ACTIVE_AUDIO={}",
        timer_stats.rms() > 0.0001
    );

    println!("phase=event-baseline state=starting durationMs=3000 prerequisite=timer-passed");
    let event_stats = capture(&endpoint, true, Duration::from_secs(3))?;
    println!("phase=event-baseline state=passed initializeHresult=0x00000000 packets={} frames={} activeFrames={} silentFrames={} peak={:.6} rms={:.6} silentPackets={}",
        event_stats.packets, event_stats.frames, event_stats.active_frames, event_stats.silent_frames, event_stats.peak, event_stats.rms(), event_stats.silent_packets);
    println!("MIC_BASELINE_EVENT_INITIALIZE=SUCCESS");
    println!("MIC_BASELINE_EVENT_SIGNALLED={}", event_stats.packets > 0);
    println!(
        "MIC_BASELINE_EVENT_ACTIVE_AUDIO={}",
        event_stats.rms() > 0.0001
    );
    Ok(())
}

fn select_endpoint(
    enumerator: &IMMDeviceEnumerator,
    endpoint_match: Option<&str>,
) -> Result<IMMDevice, String> {
    if let Some(needle) = endpoint_match {
        let collection = unsafe { enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) }
            .map_err(|e| format!("EnumAudioEndpoints hresult={:#010x}", e.code().0 as u32))?;
        let count = unsafe { collection.GetCount() }
            .map_err(|e| format!("GetCount hresult={:#010x}", e.code().0 as u32))?;
        for index in 0..count {
            let endpoint = unsafe { collection.Item(index) }
                .map_err(|e| format!("Item({index}) hresult={:#010x}", e.code().0 as u32))?;
            let name = friendly_name(&endpoint).unwrap_or_default();
            if name.to_lowercase().contains(&needle.to_lowercase()) {
                return Ok(endpoint);
            }
        }
        return Err(format!(
            "select-endpoint no active capture endpoint matched {needle:?}"
        ));
    }
    unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eConsole) }.map_err(|e| {
        format!(
            "GetDefaultAudioEndpoint(eCapture,eConsole) hresult={:#010x}",
            e.code().0 as u32
        )
    })
}

fn friendly_name(endpoint: &IMMDevice) -> Result<String, String> {
    let store = unsafe { endpoint.OpenPropertyStore(STGM_READ) }
        .map_err(|e| format!("OpenPropertyStore hresult={:#010x}", e.code().0 as u32))?;
    let mut value = unsafe { store.GetValue(&PKEY_Device_FriendlyName) }
        .map_err(|e| format!("GetValue(FriendlyName) hresult={:#010x}", e.code().0 as u32))?;
    let mut buffer = [0u16; 512];
    let result = unsafe { PropVariantToString(&value, &mut buffer) }
        .map_err(|e| format!("PropVariantToString hresult={:#010x}", e.code().0 as u32));
    let _ = unsafe { PropVariantClear(&mut value) };
    result?;
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Ok(String::from_utf16_lossy(&buffer[..len]))
}

fn endpoint_id(endpoint: &IMMDevice) -> Result<String, String> {
    let value: PWSTR = unsafe { endpoint.GetId() }
        .map_err(|e| format!("GetId hresult={:#010x}", e.code().0 as u32))?;
    let text = unsafe { value.to_string() }.map_err(|e| format!("GetId UTF-16 error={e}"));
    unsafe { CoTaskMemFree(Some(value.0.cast::<c_void>())) };
    text
}

fn stable_hash(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn capture(
    endpoint: &IMMDevice,
    event_driven: bool,
    duration: Duration,
) -> Result<CaptureStats, String> {
    let client: IAudioClient = unsafe { endpoint.Activate(CLSCTX_ALL, None) }
        .map_err(|e| format!("Activate<IAudioClient> hresult={:#010x}", e.code().0 as u32))?;
    let raw_format = unsafe { client.GetMixFormat() }
        .map_err(|e| format!("GetMixFormat hresult={:#010x}", e.code().0 as u32))?;
    let format = CoTaskMemWaveFormat::new(raw_format)?;
    let info = inspect_format(&format);
    println!("phase={} mixFormatPtr={:p} allocationBytes={} tag=0x{:04x} channels={} rate={} avgBytesPerSec={} bits={} validBits={} blockAlign={} cbSize={} channelMask=0x{:08x} subFormat={:?} kind={:?}",
        if event_driven { "event-baseline" } else { "timer-baseline" }, format.ptr(), format.allocation_bytes(),
        info.tag, info.channels, info.rate, info.avg_bytes_per_sec, info.bits, info.valid_bits, info.block_align, info.cb_size, info.channel_mask, info.sub_format, info.kind);

    let mut closest = null_mut();
    println!(
        "phase={} formatVariant=raw-getmixformat",
        if event_driven {
            "event-baseline"
        } else {
            "timer-baseline"
        }
    );
    println!("phase={} initializeArguments endpointFlow=eCapture endpointRole=eConsole shareMode=shared numericStreamFlags={} hasLoopbackFlag=false hasEventCallback={} hnsBufferDuration=0 hnsPeriodicity=0 formatPointer={:p} formatAllocationBytes={} formatTag=0x{:04x} cbSize={} formatPointerStable=true sessionGuidNull=true setClientPropertiesCalled=false currentThreadId={} comApartment=MTA",
        if event_driven { "event-baseline" } else { "timer-baseline" },
        if event_driven { AUDCLNT_STREAMFLAGS_EVENTCALLBACK } else { 0 }, event_driven,
        format.ptr(), format.allocation_bytes(), info.tag, info.cb_size,
        unsafe { GetCurrentThreadId() });
    let support = unsafe {
        client.IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, format.ptr(), Some(&mut closest))
    };
    if !closest.is_null() {
        unsafe { CoTaskMemFree(Some(closest.cast::<c_void>())) };
    }
    println!(
        "phase={} isFormatSupportedHresult={:#010x}",
        if event_driven {
            "event-baseline"
        } else {
            "timer-baseline"
        },
        support.0 as u32
    );
    if support.0 < 0 {
        return Err(format!(
            "IsFormatSupported hresult={:#010x}",
            support.0 as u32
        ));
    }

    let event = if event_driven {
        let handle = unsafe { CreateEventW(None, false, false, None) }
            .map_err(|e| format!("CreateEventW hresult={:#010x}", e.code().0 as u32))?;
        Some(WinHandle(handle))
    } else {
        None
    };
    let flags = if event_driven {
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK
    } else {
        0
    };
    let buffer_duration = 0;
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            flags,
            buffer_duration,
            0,
            format.ptr(),
            None,
        )
    }
    .map_err(|e| {
        format!(
            "Initialize mode={} hresult={:#010x} bufferDuration={buffer_duration}",
            if event_driven { "event" } else { "timer" },
            e.code().0 as u32
        )
    })?;
    if let Some(handle) = &event {
        unsafe { client.SetEventHandle(handle.0) }
            .map_err(|e| format!("SetEventHandle hresult={:#010x}", e.code().0 as u32))?;
    }
    let buffer_frames = unsafe { client.GetBufferSize() }
        .map_err(|e| format!("GetBufferSize hresult={:#010x}", e.code().0 as u32))?;
    let capture: IAudioCaptureClient = unsafe { client.GetService() }.map_err(|e| {
        format!(
            "GetService<IAudioCaptureClient> hresult={:#010x}",
            e.code().0 as u32
        )
    })?;
    println!(
        "phase={} initialized bufferFrames={} bufferDuration={buffer_duration}",
        if event_driven {
            "event-baseline"
        } else {
            "timer-baseline"
        },
        buffer_frames
    );
    unsafe { client.Start() }.map_err(|e| format!("Start hresult={:#010x}", e.code().0 as u32))?;
    let started = Instant::now();
    let mut stats = CaptureStats::default();
    while started.elapsed() < duration {
        if let Some(handle) = &event {
            let wait = unsafe { WaitForSingleObject(handle.0, 250) };
            if wait != WAIT_OBJECT_0 {
                continue;
            }
        } else {
            thread::sleep(Duration::from_millis(10));
        }
        drain_packets(&capture, &info, &mut stats)?;
    }
    let _ = unsafe { client.Stop() };
    Ok(stats)
}

fn inspect_format(format: &CoTaskMemWaveFormat) -> FormatInfo {
    let base = format.format();
    let mut kind = match base.wFormatTag {
        WAVE_FORMAT_IEEE_FLOAT => SampleKind::Float,
        1 => SampleKind::Pcm,
        _ => SampleKind::Unknown,
    };
    let mut valid_bits = base.wBitsPerSample;
    let mut channel_mask = 0;
    let mut sub_format = windows::core::GUID::zeroed();
    if base.wFormatTag == WAVE_FORMAT_EXTENSIBLE
        && base.cbSize as usize >= size_of::<WAVEFORMATEXTENSIBLE>() - size_of::<WAVEFORMATEX>()
    {
        let extended = format.ptr().cast::<WAVEFORMATEXTENSIBLE>();
        valid_bits =
            unsafe { std::ptr::addr_of!((*extended).Samples.wValidBitsPerSample).read_unaligned() };
        channel_mask = unsafe { std::ptr::addr_of!((*extended).dwChannelMask).read_unaligned() };
        sub_format = unsafe { std::ptr::addr_of!((*extended).SubFormat).read_unaligned() };
        kind = if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
            SampleKind::Float
        } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
            SampleKind::Pcm
        } else {
            SampleKind::Unknown
        };
    }
    FormatInfo {
        tag: base.wFormatTag,
        channels: base.nChannels,
        rate: base.nSamplesPerSec,
        avg_bytes_per_sec: base.nAvgBytesPerSec,
        bits: base.wBitsPerSample,
        valid_bits,
        block_align: base.nBlockAlign,
        cb_size: base.cbSize,
        channel_mask,
        sub_format,
        kind,
    }
}

fn drain_packets(
    capture: &IAudioCaptureClient,
    info: &FormatInfo,
    stats: &mut CaptureStats,
) -> Result<(), String> {
    loop {
        let packet_frames = unsafe { capture.GetNextPacketSize() }
            .map_err(|e| format!("GetNextPacketSize hresult={:#010x}", e.code().0 as u32))?;
        if packet_frames == 0 {
            return Ok(());
        }
        let mut data = null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
            .map_err(|e| format!("GetBuffer hresult={:#010x}", e.code().0 as u32))?;
        stats.packets += 1;
        stats.frames += frames as u64;
        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
            stats.silent_packets += 1;
            stats.silent_frames += frames as u64;
        } else {
            stats.active_frames += frames as u64;
            measure(data, frames, info, stats);
        }
        unsafe { capture.ReleaseBuffer(frames) }
            .map_err(|e| format!("ReleaseBuffer hresult={:#010x}", e.code().0 as u32))?;
    }
}

fn measure(data: *const u8, frames: u32, info: &FormatInfo, stats: &mut CaptureStats) {
    let sample_count = frames as usize * info.channels as usize;
    let bytes_per_sample = (info.bits as usize + 7) / 8;
    let bytes =
        unsafe { std::slice::from_raw_parts(data, frames as usize * info.block_align as usize) };
    for index in 0..sample_count {
        let offset = index * bytes_per_sample;
        if offset + bytes_per_sample > bytes.len() {
            break;
        }
        let value = match (info.kind, info.bits) {
            (SampleKind::Float, 32) => {
                f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as f64
            }
            (SampleKind::Pcm, 16) => {
                i16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap()) as f64 / 32768.0
            }
            (SampleKind::Pcm, 24) => {
                let raw = (bytes[offset] as i32)
                    | ((bytes[offset + 1] as i32) << 8)
                    | ((bytes[offset + 2] as i32) << 16);
                let signed = if raw & 0x0080_0000 != 0 {
                    raw | !0x00ff_ffff
                } else {
                    raw
                };
                signed as f64 / 8_388_608.0
            }
            (SampleKind::Pcm, 32) => {
                i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as f64
                    / 2_147_483_648.0
            }
            _ => continue,
        };
        if value.is_finite() {
            let magnitude = value.abs();
            stats.peak = stats.peak.max(magnitude);
            stats.square_sum += value * value;
            stats.samples += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensible_allocation_is_base_plus_cb_size() {
        assert_eq!(
            size_of::<WAVEFORMATEX>() + 22,
            size_of::<WAVEFORMATEXTENSIBLE>()
        );
    }
}
