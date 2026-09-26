use super::normalize_device_name;
use crate::audio_config::RING_BUFFER_SAMPLES;
use crate::windows_audio::{decode_sample, downmix_to_mono};
use anyhow::Result;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use wasapi::{get_default_device, DeviceCollection, Direction, ShareMode, WaveFormat};

const MAX_CONSECUTIVE_READ_FAILURES: u32 = 5;

struct ComGuard;

impl ComGuard {
    fn initialize() -> Result<Self> {
        wasapi::initialize_mta()
            .map_err(|e| anyhow::anyhow!("failed to initialize COM on capture thread: {}", e))?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        wasapi::deinitialize();
    }
}

fn resolve_input_device(device_id: Option<&str>) -> Result<wasapi::Device> {
    let requested_id = device_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && !id.eq_ignore_ascii_case("default"));

    let Some(requested_id) = requested_id else {
        return get_default_device(&Direction::Capture)
            .map_err(|e| anyhow::anyhow!("No default input device: {}", e));
    };

    let collection = DeviceCollection::new(&Direction::Capture)
        .map_err(|e| anyhow::anyhow!("Failed to enumerate input devices: {}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| anyhow::anyhow!("Failed to count input devices: {}", e))?;
    let normalized_request = normalize_device_name(requested_id);
    let mut best: Option<(u8, wasapi::Device, String)> = None;
    let mut available = Vec::new();

    for index in 0..count {
        let Ok(device) = collection.get_device_at_index(index) else {
            continue;
        };
        let id = device.get_id().unwrap_or_default();
        let name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "<unknown input>".to_string());
        available.push(name.clone());

        let tier = if id == requested_id || name == requested_id {
            Some(0)
        } else if id.eq_ignore_ascii_case(requested_id) || name.eq_ignore_ascii_case(requested_id) {
            Some(1)
        } else if normalize_device_name(&name) == normalized_request {
            Some(2)
        } else {
            None
        };

        if let Some(tier) = tier {
            if best
                .as_ref()
                .map(|(current, _, _)| tier < *current)
                .unwrap_or(true)
            {
                best = Some((tier, device, name));
                if tier == 0 {
                    break;
                }
            }
        }
    }

    if let Some((tier, device, matched_name)) = best {
        let label = match tier {
            0 => "exact",
            1 => "case-insensitive",
            _ => "fuzzy",
        };
        println!(
            "[Microphone] Using {} match for input device: requested='{}' matched='{}'",
            label, requested_id, matched_name
        );
        return Ok(device);
    }

    Err(anyhow::anyhow!(
        "Input device '{}' not found. Available devices: {}",
        requested_id,
        available.join(", ")
    ))
}

pub struct WindowsInputStream {
    running: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
}

impl WindowsInputStream {
    pub fn new(
        device_id: Option<String>,
        running: Arc<AtomicBool>,
        data_ready: Arc<(Mutex<bool>, Condvar)>,
        err_signal: Arc<Mutex<Option<String>>>,
    ) -> Result<(Self, HeapCons<f32>, u32)> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_for_thread = shutdown.clone();
        let running_for_thread = running.clone();
        let (init_tx, init_rx) = mpsc::channel();

        let capture_thread = thread::spawn(move || {
            if let Err(error) = capture_loop(
                device_id,
                producer,
                running_for_thread,
                shutdown_for_thread,
                data_ready,
                err_signal,
                init_tx.clone(),
            ) {
                let _ = init_tx.send(Err(error));
            }
        });

        let sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(sample_rate)) => sample_rate,
            Ok(Err(error)) => {
                shutdown.store(true, Ordering::SeqCst);
                let _ = capture_thread.join();
                return Err(error);
            }
            Err(_) => {
                shutdown.store(true, Ordering::SeqCst);
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!(
                    "WASAPI microphone initialization timed out after 5s"
                ));
            }
        };

        Ok((
            Self {
                running,
                shutdown,
                capture_thread: Some(capture_thread),
            },
            consumer,
            sample_rate,
        ))
    }

    pub fn play(&self) -> Result<()> {
        self.running.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        self.running.store(false, Ordering::SeqCst);
        Ok(())
    }
}

impl Drop for WindowsInputStream {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}

fn capture_loop(
    device_id: Option<String>,
    mut producer: HeapProd<f32>,
    running: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    err_signal: Arc<Mutex<Option<String>>>,
    init_tx: mpsc::Sender<Result<u32>>,
) -> Result<()> {
    let _com = ComGuard::initialize()?;
    let device = resolve_input_device(device_id.as_deref())?;
    let device_name = device.get_friendlyname().unwrap_or_default();
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| anyhow::anyhow!("Failed to get WASAPI audio client: {}", e))?;
    let device_format: WaveFormat = audio_client
        .get_mixformat()
        .map_err(|e| anyhow::anyhow!("Failed to get WASAPI mix format: {}", e))?;
    let sample_rate = device_format.get_samplespersec();
    let channels = device_format.get_nchannels() as usize;
    let bytes_per_frame = device_format.get_blockalign() as usize;
    let bits_per_sample = device_format.get_bitspersample();
    let sample_type = device_format
        .get_subformat()
        .map_err(|e| anyhow::anyhow!("Unsupported WASAPI subformat: {}", e))?;

    if channels == 0 || bytes_per_frame == 0 || bytes_per_frame % channels != 0 {
        return Err(anyhow::anyhow!(
            "Unsupported WASAPI mix format: {} channels, {} bytes/frame",
            channels,
            bytes_per_frame
        ));
    }
    if decode_sample(
        &vec![0; bytes_per_frame / channels],
        sample_type,
        bits_per_sample,
    )
    .is_none()
    {
        return Err(anyhow::anyhow!(
            "Unsupported WASAPI mix format: {:?}, {} bits",
            sample_type,
            bits_per_sample
        ));
    }

    let (_default_period, minimum_period) = audio_client
        .get_periods()
        .map_err(|e| anyhow::anyhow!("Failed to get WASAPI device periods: {}", e))?;
    audio_client
        .initialize_client(
            &device_format,
            minimum_period,
            &Direction::Capture,
            &ShareMode::Shared,
            false,
        )
        .map_err(|e| anyhow::anyhow!("Failed to initialize WASAPI microphone: {}", e))?;
    let event = audio_client
        .set_get_eventhandle()
        .map_err(|e| anyhow::anyhow!("Failed to create WASAPI microphone event: {}", e))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| anyhow::anyhow!("Failed to get WASAPI capture client: {}", e))?;
    audio_client
        .start_stream()
        .map_err(|e| anyhow::anyhow!("Failed to start WASAPI microphone: {}", e))?;

    println!(
        "[Microphone] Device: {}, Rate: {}Hz, Channels: {}, Format: {:?}/{}-bit",
        device_name, sample_rate, channels, sample_type, bits_per_sample
    );
    let _ = init_tx.send(Ok(sample_rate));

    let mut consecutive_read_failures = 0;
    while !shutdown.load(Ordering::SeqCst) {
        if event.wait_for_event(250).is_err() {
            continue;
        }

        let mut bytes = VecDeque::new();
        if let Err(error) = capture_client.read_from_device_to_deque(bytes_per_frame, &mut bytes) {
            consecutive_read_failures += 1;
            if consecutive_read_failures >= MAX_CONSECUTIVE_READ_FAILURES {
                if let Ok(mut slot) = err_signal.lock() {
                    if slot.is_none() {
                        *slot = Some(format!(
                            "WASAPI microphone read failed {} times: {}",
                            consecutive_read_failures, error
                        ));
                    }
                }
                break;
            }
            continue;
        }
        consecutive_read_failures = 0;

        if !running.load(Ordering::Relaxed) || bytes.is_empty() {
            continue;
        }
        let samples = downmix_to_mono(
            bytes,
            bytes_per_frame,
            channels,
            sample_type,
            bits_per_sample,
        );
        if samples.is_empty() {
            continue;
        }

        let _ = producer.push_slice(&samples);
        let (lock, cvar) = &*data_ready;
        if let Ok(mut ready) = lock.lock() {
            *ready = true;
            cvar.notify_one();
        }
    }

    let _ = audio_client.stop_stream();
    Ok(())
}
