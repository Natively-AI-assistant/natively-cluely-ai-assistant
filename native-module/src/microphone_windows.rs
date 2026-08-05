//! Windows microphone capture using the endpoint's real WASAPI shared-mode
//! mix format. PCM is kept separate from process loopback and converted to
//! mono f32 for the existing 16 kHz DSP/resampler in `lib.rs`.

use anyhow::Result;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapRb,
};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use wasapi::{
    get_default_device, AudioCaptureClient, Device, DeviceCollection, Direction, Handle,
    SampleType, ShareMode, WaveFormat,
};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    IAudioCaptureClient as RawAudioCaptureClient, IAudioClient3, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use crate::audio_config::RING_BUFFER_SAMPLES;

fn endpoint_hash(id: &str) -> String {
    format!("{:x}", Sha256::digest(id.as_bytes()))[..12].to_string()
}
fn normalize(value: &str) -> String {
    value.trim().to_lowercase().replace(['–', '—', '−'], "-")
}

fn devices() -> Result<Vec<Device>> {
    let collection = DeviceCollection::new(&Direction::Capture)
        .map_err(|e| anyhow::anyhow!("DeviceCollection: {e}"))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| anyhow::anyhow!("GetDeviceCount: {e}"))?;
    Ok((0..count)
        .filter_map(|index| collection.get_device_at_index(index).ok())
        .collect())
}

fn resolve_device(requested: Option<&str>) -> Result<Device> {
    let requested = requested
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("default"));
    if let Some(requested) = requested {
        let wanted = normalize(requested);
        for device in devices()? {
            let id = device.get_id().unwrap_or_default();
            let name = device.get_friendlyname().unwrap_or_default();
            if id == requested || normalize(&name) == wanted {
                return Ok(device);
            }
        }
        return Err(anyhow::anyhow!(
            "ResolveEndpoint: requested microphone was not found"
        ));
    }
    get_default_device(&Direction::Capture)
        .map_err(|e| anyhow::anyhow!("GetDefaultAudioEndpoint: {e}"))
}

pub fn list_input_devices() -> Result<Vec<(String, String)>> {
    let com_initialized = wasapi::initialize_mta().is_ok();
    let mut result = vec![("default".to_string(), "Default Microphone".to_string())];
    for device in devices()? {
        if let (Ok(id), Ok(name)) = (device.get_id(), device.get_friendlyname()) {
            result.push((id, name));
        }
    }
    if com_initialized {
        wasapi::deinitialize();
    }
    Ok(result)
}

enum CaptureBackend {
    Wasapi {
        client: wasapi::AudioClient,
        capture: AudioCaptureClient,
        event: Handle,
    },
    Client3 {
        client: IAudioClient3,
        capture: RawAudioCaptureClient,
        event: HANDLE,
    },
}
struct ReadyCapture {
    backend: CaptureBackend,
    format: WaveFormat,
    timer_driven: bool,
}

fn format_label(format: &WaveFormat) -> String {
    format!(
        "rate={},channels={},bits={},validBits={},channelMask={},subformat={:?}",
        format.get_samplespersec(),
        format.get_nchannels(),
        format.get_bitspersample(),
        format.get_validbitspersample(),
        format.get_dwchannelmask(),
        format.get_subformat()
    )
}

fn initialize_client3(
    endpoint_id: &str,
    format: &WaveFormat,
    diagnostics: &str,
) -> Result<ReadyCapture> {
    let wide: Vec<u16> = endpoint_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let enumerator: IMMDeviceEnumerator = unsafe {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
    }
    .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.CoCreateInstance,error={e}"))?;
    let device = unsafe { enumerator.GetDevice(PCWSTR(wide.as_ptr())) }
        .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.GetDevice,error={e}"))?;
    let client: IAudioClient3 = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.Activate,error={e}"))?;
    // Reuse the exact allocation returned by this raw IAudioClient3. This
    // avoids reconstructing/casting WAVEFORMATEXTENSIBLE across crate versions,
    // which strict USB drivers reject as E_INVALIDARG even when every visible
    // field appears equivalent.
    let format_ptr = unsafe { client.GetMixFormat() }
        .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.GetMixFormat,error={e}"))?;
    let mut default_frames = 0;
    let mut fundamental = 0;
    let mut minimum = 0;
    let mut maximum = 0;
    unsafe {
        client.GetSharedModeEnginePeriod(
            format_ptr,
            &mut default_frames,
            &mut fundamental,
            &mut minimum,
            &mut maximum,
        )
    }
    .map_err(|e| {
        anyhow::anyhow!("{diagnostics},stage=Client3.GetSharedModeEnginePeriod,error={e}")
    })?;
    let mut failures = Vec::new();
    for period_frames in [default_frames, minimum, fundamental] {
        let candidate: IAudioClient3 = unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.Activate,error={e}"))?;
        if let Err(error) = unsafe {
            candidate.InitializeSharedAudioStream(
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                period_frames,
                format_ptr,
                None,
            )
        } {
            failures.push(format!("periodFrames={period_frames}:{error}"));
            continue;
        }
        let event = unsafe { CreateEventW(None, false, false, None) }
            .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.CreateEvent,error={e}"))?;
        if let Err(error) = unsafe { candidate.SetEventHandle(event) } {
            let _ = unsafe { CloseHandle(event) };
            failures.push(format!(
                "periodFrames={period_frames}:SetEventHandle={error}"
            ));
            continue;
        }
        let capture: RawAudioCaptureClient = unsafe { candidate.GetService() }
            .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.GetService,error={e}"))?;
        unsafe { candidate.Start() }
            .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.Start,error={e}"))?;
        eprintln!("[MicrophoneCapture] {diagnostics},mixFormat={},shareMode=shared,streamFlags=eventcallback,bufferDurationFrames={period_frames},periodicityFrames={period_frames},selected=IAudioClient3", format_label(format));
        unsafe {
            CoTaskMemFree(Some(format_ptr as *const _));
        }
        return Ok(ReadyCapture {
            backend: CaptureBackend::Client3 {
                client: candidate,
                capture,
                event,
            },
            format: format.clone(),
            timer_driven: false,
        });
    }
    let timer_client: IAudioClient3 = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|e| anyhow::anyhow!("{diagnostics},stage=Client3.Timer.Activate,error={e}"))?;
    match unsafe { timer_client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 0, 0, format_ptr, None) } {
        Ok(()) => {
            let capture: RawAudioCaptureClient =
                unsafe { timer_client.GetService() }.map_err(|e| {
                    anyhow::anyhow!("{diagnostics},stage=Client3.Timer.GetService,error={e}")
                })?;
            unsafe { timer_client.Start() }.map_err(|e| {
                anyhow::anyhow!("{diagnostics},stage=Client3.Timer.Start,error={e}")
            })?;
            eprintln!("[MicrophoneCapture] {diagnostics},mixFormat={},shareMode=shared,streamFlags=none,bufferDuration=0,periodicity=0,selected=IAudioClient3-timer", format_label(format));
            unsafe {
                CoTaskMemFree(Some(format_ptr as *const _));
            }
            return Ok(ReadyCapture {
                backend: CaptureBackend::Client3 {
                    client: timer_client,
                    capture,
                    event: HANDLE::default(),
                },
                format: format.clone(),
                timer_driven: true,
            });
        }
        Err(error) => failures.push(format!("timer(duration=0):{error}")),
    }
    unsafe {
        CoTaskMemFree(Some(format_ptr as *const _));
    }
    Err(anyhow::anyhow!("{diagnostics},stage=Client3.InitializeSharedAudioStream,enginePeriods=default:{default_frames}/min:{minimum}/fundamental:{fundamental}/max:{maximum},attempts={}", failures.join("|")))
}

fn initialize(device: &Device, endpoint_id: &str, diagnostics: &str) -> Result<ReadyCapture> {
    let probe = device
        .get_iaudioclient()
        .map_err(|e| anyhow::anyhow!("{diagnostics},stage=GetIAudioClient,error={e}"))?;
    let mix = probe
        .get_mixformat()
        .map_err(|e| anyhow::anyhow!("{diagnostics},stage=GetMixFormat,error={e}"))?;
    let support = probe.is_supported(&mix, &ShareMode::Shared);
    let closest = support.as_ref().ok().and_then(|value| value.clone());
    let support_label = match &support {
        Ok(None) => "native",
        Ok(Some(_)) => "closest",
        Err(_) => "failed",
    };
    let periods = probe.get_periods().map_err(|e| {
        anyhow::anyhow!(
            "{diagnostics},mixFormat={},stage=GetDevicePeriod,error={e}",
            format_label(&mix)
        )
    })?;
    let mut formats = vec![mix.clone()];
    if let Ok(simple) = mix.to_waveformatex() {
        formats.push(simple);
    }
    if let Some(format) = closest {
        formats.push(format);
    }
    let mut failures = Vec::new();
    for format in formats {
        for (timer_driven, duration) in [
            (false, 0i64),
            (false, periods.0),
            (true, 0i64),
            (true, periods.0),
        ] {
            let mode = if timer_driven {
                "shared-timer-fallback"
            } else {
                "shared-event"
            };
            let mut client = match device.get_iaudioclient() {
                Ok(value) => value,
                Err(error) => {
                    failures.push(format!("{mode}:GetIAudioClient={error}"));
                    continue;
                }
            };
            if let Err(error) = client.initialize_client(
                &format,
                duration,
                &Direction::Capture,
                &ShareMode::Shared,
                false,
            ) {
                failures.push(format!("{mode}(duration={duration}):Initialize={error}"));
                continue;
            }
            let event = match client.set_get_eventhandle() {
                Ok(value) => value,
                Err(error) => {
                    failures.push(format!("{mode}:SetEventHandle={error}"));
                    continue;
                }
            };
            let capture = match client.get_audiocaptureclient() {
                Ok(value) => value,
                Err(error) => {
                    failures.push(format!("{mode}:GetCaptureClient={error}"));
                    continue;
                }
            };
            if let Err(error) = client.start_stream() {
                failures.push(format!("{mode}:Start={error}"));
                continue;
            }
            eprintln!("[MicrophoneCapture] {diagnostics},mixFormat={},shareMode=shared,streamFlags={},bufferDuration={},periodicity=0,isFormatSupported={},closestSupported={},selected={mode}", format_label(&mix), if timer_driven { "eventcallback(timer-poll)" } else { "eventcallback" }, duration, support_label, support.as_ref().ok().and_then(|v| v.as_ref()).map(format_label).unwrap_or_else(|| "none".to_string()));
            return Ok(ReadyCapture {
                backend: CaptureBackend::Wasapi {
                    client,
                    capture,
                    event,
                },
                format,
                timer_driven,
            });
        }
    }
    initialize_client3(endpoint_id, &mix, diagnostics).map_err(|client3| anyhow::anyhow!("{diagnostics},mixFormat={},shareMode=shared,streamFlags=eventcallback,bufferDuration={},periodicity=0,isFormatSupported={},closestSupported={},stage=Initialize/Start,attempts={},client3={client3}", format_label(&mix), periods.0, support_label, support.as_ref().ok().and_then(|v| v.as_ref()).map(format_label).unwrap_or_else(|| "none".to_string()), failures.join("|")))
}

fn decode_frame(bytes: &[u8], format: &WaveFormat) -> f32 {
    let channels = format.get_nchannels().max(1) as usize;
    let bits = format.get_bitspersample() as usize;
    let bytes_per_sample = (bits + 7) / 8;
    let mut sum = 0.0f32;
    for channel in 0..channels {
        let offset = channel * bytes_per_sample;
        if offset + bytes_per_sample > bytes.len() {
            break;
        }
        let value = match format.get_subformat().unwrap_or(SampleType::Int) {
            SampleType::Float if bits == 32 => {
                f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
            }
            SampleType::Float if bits == 64 => {
                f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap()) as f32
            }
            SampleType::Int if bits == 16 => {
                i16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap()) as f32 / 32768.0
            }
            SampleType::Int if bits == 24 => {
                let raw = (bytes[offset] as i32)
                    | ((bytes[offset + 1] as i32) << 8)
                    | ((bytes[offset + 2] as i32) << 16);
                ((raw << 8) >> 8) as f32 / 8_388_608.0
            }
            SampleType::Int if bits == 32 => {
                i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as f32
                    / 2_147_483_648.0
            }
            _ => 0.0,
        };
        sum += value;
    }
    sum / channels as f32
}

pub struct MicrophoneStream {
    consumer: Option<HeapCons<f32>>,
    sample_rate: u32,
    is_running: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    err_signal: Arc<Mutex<Option<String>>>,
}

impl MicrophoneStream {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (mut producer, consumer) = rb.split();
        let is_running = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let err_signal = Arc::new(Mutex::new(None));
        let (init_tx, init_rx) = mpsc::channel();
        let running_worker = is_running.clone();
        let shutdown_worker = shutdown.clone();
        let ready_worker = data_ready.clone();
        let error_worker = err_signal.clone();
        let capture_thread = thread::spawn(move || {
            if let Err(error) = wasapi::initialize_mta() {
                let _ = init_tx.send(Err(anyhow::anyhow!("stage=CoInitializeEx,error={error}")));
                return;
            }
            let device = match resolve_device(device_id.as_deref()) {
                Ok(value) => value,
                Err(error) => {
                    let _ = init_tx.send(Err(error));
                    return;
                }
            };
            let id = device.get_id().unwrap_or_default();
            let friendly = device
                .get_friendlyname()
                .unwrap_or_else(|_| "Unknown microphone".to_string());
            let state = device.get_state().unwrap_or(0);
            let diagnostics = format!(
                "endpointHash={},friendlyName={},deviceState={state}",
                endpoint_hash(&id),
                friendly.replace([',', '\n', '\r'], " ")
            );
            let ready = match initialize(&device, &id, &diagnostics) {
                Ok(value) => value,
                Err(error) => {
                    let _ = init_tx.send(Err(error));
                    return;
                }
            };
            let rate = ready.format.get_samplespersec();
            let block = ready.format.get_blockalign() as usize;
            let _ = init_tx.send(Ok(rate));
            let mut queue = VecDeque::new();
            while !shutdown_worker.load(Ordering::Relaxed) {
                match &ready.backend {
                    CaptureBackend::Wasapi { event, .. } if !ready.timer_driven => {
                        let _ = event.wait_for_event(250);
                    }
                    CaptureBackend::Client3 { event, .. } if !ready.timer_driven => {
                        let _ = unsafe { WaitForSingleObject(*event, 250) } == WAIT_OBJECT_0;
                    }
                    _ => thread::sleep(Duration::from_millis(10)),
                }
                match &ready.backend {
                    CaptureBackend::Wasapi { capture, .. } => {
                        while capture.get_next_nbr_frames().ok().flatten().unwrap_or(0) > 0 {
                            if let Err(error) = capture.read_from_device_to_deque(block, &mut queue)
                            {
                                if let Ok(mut slot) = error_worker.lock() {
                                    *slot = Some(format!(
                                        "{diagnostics},stage=GetBuffer,error={error}"
                                    ));
                                }
                                break;
                            }
                        }
                    }
                    CaptureBackend::Client3 { capture, .. } => {
                        while unsafe { capture.GetNextPacketSize() }.unwrap_or(0) > 0 {
                            let mut data = std::ptr::null_mut();
                            let mut frames = 0;
                            let mut flags = 0;
                            let mut device_position = 0u64;
                            let mut qpc_position = 0u64;
                            match unsafe {
                                capture.GetBuffer(
                                    &mut data,
                                    &mut frames,
                                    &mut flags,
                                    Some(&mut device_position),
                                    Some(&mut qpc_position),
                                )
                            } {
                                Ok(()) => {
                                    let bytes = frames as usize * block;
                                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0
                                        || data.is_null()
                                    {
                                        queue.extend(std::iter::repeat(0).take(bytes));
                                    } else {
                                        queue.extend(unsafe {
                                            std::slice::from_raw_parts(data, bytes)
                                        });
                                    }
                                    let _ = unsafe { capture.ReleaseBuffer(frames) };
                                }
                                Err(error) => {
                                    if let Ok(mut slot) = error_worker.lock() {
                                        *slot = Some(format!(
                                            "{diagnostics},stage=Client3.GetBuffer,error={error}"
                                        ));
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
                if !running_worker.load(Ordering::Relaxed) {
                    queue.clear();
                    continue;
                }
                while queue.len() >= block {
                    let frame: Vec<u8> = queue.drain(..block).collect();
                    let _ = producer.try_push(decode_frame(&frame, &ready.format));
                }
                let (lock, condvar) = &*ready_worker;
                if let Ok(mut ready) = lock.lock() {
                    *ready = true;
                    condvar.notify_one();
                }
            }
            match ready.backend {
                CaptureBackend::Wasapi { client, .. } => {
                    let _ = client.stop_stream();
                }
                CaptureBackend::Client3 { client, event, .. } => {
                    let _ = unsafe { client.Stop() };
                    if !event.is_invalid() {
                        let _ = unsafe { CloseHandle(event) };
                    }
                }
            }
        });
        let sample_rate = match init_rx.recv_timeout(Duration::from_secs(6)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(error)) => {
                let _ = capture_thread.join();
                return Err(error);
            }
            Err(_) => {
                shutdown.store(true, Ordering::SeqCst);
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!("stage=Initialize,timeoutMs=6000"));
            }
        };
        Ok(Self {
            consumer: Some(consumer),
            sample_rate,
            is_running,
            shutdown,
            capture_thread: Some(capture_thread),
            data_ready,
            err_signal,
        })
    }
    pub fn play(&self) -> Result<()> {
        self.is_running.store(true, Ordering::SeqCst);
        Ok(())
    }
    pub fn pause(&self) -> Result<()> {
        self.is_running.store(false, Ordering::SeqCst);
        Ok(())
    }
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }
    pub fn err_signal(&self) -> Arc<Mutex<Option<String>>> {
        self.err_signal.clone()
    }
}

impl Drop for MicrophoneStream {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}
