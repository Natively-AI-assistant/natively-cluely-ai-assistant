use anyhow::Result;
use ca::aggregate_device_keys as agg_keys;
use cidre::{api, arc, av, cat, cf, core_audio as ca, ns, objc, os};
use cidre::objc::Obj as _;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

fn strip_audio_suffix(s: &str) -> &str {
    s.strip_suffix(":output")
        .or_else(|| s.strip_suffix(":input"))
        .unwrap_or(s)
}

struct Ctx {
    format: arc::R<av::AudioFormat>,
    producer: HeapProd<f32>,
    channels: u32,
    /// Index of the tap's buffer in the aggregate's input list: the output
    /// device's own input streams come first (verified 2026-10-21: BlackHole 2ch
    /// and 16ch put the tap at 1, built-in speakers at 0).
    tap_index: usize,
    current_sample_rate: Arc<AtomicU32>,
}

/// Device id that forces the macOS 14.2 global-tap path on any macOS that
/// supports it. Only the native A/B harness passes it; the app never does.
pub const GLOBAL_TAP_DEVICE_ID: &str = "tap-global";

/// How the process tap is built on this macOS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TapMode {
    /// macOS 14.4+: -[CATapDescription initExcludingProcesses:andDeviceUID:withStream:],
    /// an aggregate clocked by the output device.
    DeviceBound,
    /// macOS 14.2 and 14.3: a plain -init plus the 14.2 properties (every process,
    /// mono mixdown), in an aggregate that holds only the tap. This is what
    /// Interview Coder's audiotee helper ships for 14.2+. Before it these
    /// versions went straight to ScreenCaptureKit, which needs the Screen
    /// Recording permission: a user who had only allowed system audio got none.
    Global,
}

fn tap_mode(at_least_14_4: bool, at_least_14_2: bool, force_global: bool) -> Option<TapMode> {
    if at_least_14_4 && !force_global {
        Some(TapMode::DeviceBound)
    } else if at_least_14_2 {
        Some(TapMode::Global)
    } else {
        None
    }
}

fn os_at_least(major: isize, minor: isize) -> bool {
    ns::ProcessInfo::current().is_os_at_least_version(api::OsVersion { major, minor, patch: 0 })
}

fn responds(obj: &ca::TapDesc, sel: &std::ffi::CStr) -> bool {
    obj.responds_to_sel(unsafe { objc::sel_reg_name(sel.as_ptr()) })
}

/// The 14.2 global tap. Every selector is checked first: calling one this
/// macOS lacks raises an Objective-C exception that kills the app before the
/// ScreenCaptureKit fallback can run (issue #249).
fn global_tap_desc() -> Result<arc::R<ca::TapDesc>> {
    let mut desc = ca::TapDesc::new();
    for sel in [c"setProcesses:", c"setExclusive:", c"setMono:", c"setMixdown:"] {
        if !responds(&desc, sel) {
            return Err(anyhow::anyhow!(
                "CoreAudio global tap unavailable (CATapDescription lacks {})",
                sel.to_string_lossy()
            ));
        }
    }
    // Exclusive with an empty list: every process except none.
    desc.set_processes(&ns::Array::new());
    desc.set_exclusive(true);
    desc.set_mono(true);
    desc.set_mixdown(true);
    if responds(&desc, c"setPrivate:") {
        desc.set_private(true);
    }
    // Mute behavior is left at its default (unmuted); its setter is the 14.4 API.
    Ok(desc)
}

pub struct SpeakerInput {
    tap: ca::TapGuard,
    device: Option<ca::hardware::StartedDevice<ca::AggregateDevice>>,
    _ctx: Box<Ctx>,
    consumer: Option<HeapCons<f32>>,
    current_sample_rate: Arc<AtomicU32>,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        // 0. Gate on macOS 14.4+. -[CATapDescription initExcludingProcesses:andDeviceUID:withStream:]
        // was introduced in macOS 14.4 (Sonoma). The class itself exists from 14.2, so
        // [CATapDescription alloc] succeeds on 14.2/14.3 but invoking this initializer there
        // throws `unrecognized selector` and tears down the process before our Err can trigger
        // the SCK fallback in macos.rs. See issue #249.
        // 14.2 and 14.3 build the global tap instead (TapMode::Global).
        let force_global = device_id.as_deref() == Some(GLOBAL_TAP_DEVICE_ID);
        let Some(mode) = tap_mode(os_at_least(14, 4), os_at_least(14, 2), force_global) else {
            return Err(anyhow::anyhow!("CoreAudio process tap requires macOS 14.2+"));
        };
        println!("[CoreAudioTap] Tap mode: {:?}", mode);
        let device_id = if force_global { None } else { device_id };

        // 1. Find the target output device
        let output_device = match device_id {
            Some(ref uid) if !uid.is_empty() && uid != "default" => {
                let requested_uid = strip_audio_suffix(uid);
                let devices = ca::System::devices()?;
                match devices.into_iter().find(|d| {
                    d.uid()
                        .map(|u| strip_audio_suffix(&u.to_string()).eq_ignore_ascii_case(requested_uid))
                        .unwrap_or(false)
                }) {
                    Some(device) => device,
                    None => {
                        println!(
                            "[CoreAudioTap] Requested output UID '{}' not found; falling back to default output device",
                            uid
                        );
                        ca::System::default_output_device()?
                    }
                }
            }
            _ => ca::System::default_output_device()?,
        };

        let output_uid = output_device.uid()?;
        println!("[CoreAudioTap] Target device UID: {}", output_uid);
        let output_uid_ns = ns::String::with_str(&output_uid.to_string());

        // 2. Create a device-scoped tap with explicit mute behavior.
        // Binding the tap to the output UID avoids the aggregate device starting
        // successfully while the tap itself only receives zero-filled buffers.
        // Apple's default is Unmuted but some macOS versions have shipped with
        // inconsistent defaults — set it explicitly to match AudioCap reference.
        let tap_desc = match mode {
            TapMode::DeviceBound => {
                let mut tap_desc = ca::TapDesc::alloc().init_excluding_processes_and_device(
                    &ns::Array::new(),
                    &output_uid_ns,
                    0,
                );
                tap_desc.set_mono(true);
                tap_desc.set_mixdown(true);
                // -[CATapDescription setMuteBehavior:] shipped in the same macOS 14.4 release as
                // the device-bound init above. Don't split this from TapMode::DeviceBound.
                tap_desc.set_mute_behavior(ca::TapMuteBehavior::Unmuted);
                tap_desc
            }
            TapMode::Global => global_tap_desc()?,
        };
        let tap = tap_desc.create_process_tap()?;
        println!("[CoreAudioTap] Tap created: {:?}", tap.uid());

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid().unwrap().as_type_ref()],
        );

        // 3. Create aggregate device descriptor.
        // CoreAudio only accepts `main_sub_device` when the same UID is also present in
        // `sub_device_list`; otherwise HAL silently leaves the main sub-device empty
        // and the tap can start without producing input buffers.
        let agg_name = cf::String::from_str("NativelySystemAudioTap");
        let agg_uid = cf::Uuid::new().to_cf_string();

        let sub_device = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[output_uid.as_type_ref()],
        );
        let sub_device_arr = cf::ArrayOf::from_slice(&[sub_device.as_ref()]);
        let sub_tap_arr = cf::ArrayOf::from_slice(&[sub_tap.as_ref()]);

        let agg_desc = match mode {
            TapMode::DeviceBound => cf::DictionaryOf::with_keys_values(
                &[
                    agg_keys::is_private(),
                    agg_keys::is_stacked(),
                    agg_keys::tap_auto_start(),
                    agg_keys::name(),
                    agg_keys::main_sub_device(),
                    agg_keys::uid(),
                    agg_keys::sub_device_list(),
                    agg_keys::tap_list(),
                ],
                &[
                    cf::Boolean::value_true().as_type_ref(),
                    cf::Boolean::value_false().as_type_ref(),
                    cf::Boolean::value_true().as_type_ref(),
                    agg_name.as_type_ref(),
                    output_uid.as_type_ref(),
                    agg_uid.as_type_ref(),
                    sub_device_arr.as_type_ref(),
                    sub_tap_arr.as_type_ref(),
                ],
            ),
            // The tap alone, no physical device (audiotee's layout): nothing to
            // clock against, and no headset microphone stream in front of it.
            TapMode::Global => cf::DictionaryOf::with_keys_values(
                &[
                    agg_keys::is_private(),
                    agg_keys::is_stacked(),
                    agg_keys::tap_auto_start(),
                    agg_keys::name(),
                    agg_keys::uid(),
                    agg_keys::tap_list(),
                ],
                &[
                    cf::Boolean::value_true().as_type_ref(),
                    cf::Boolean::value_false().as_type_ref(),
                    cf::Boolean::value_true().as_type_ref(),
                    agg_name.as_type_ref(),
                    agg_uid.as_type_ref(),
                    sub_tap_arr.as_type_ref(),
                ],
            ),
        };

        let asbd = tap
            .asbd()
            .map_err(|_| anyhow::anyhow!("Failed to get ASBD from tap"))?;
        let format = av::AudioFormat::with_asbd(&asbd).unwrap();
        let channels = asbd.channels_per_frame;
        println!(
            "[CoreAudioTap] Format: {}Hz, {}ch",
            asbd.sample_rate, channels
        );

        let buffer_size = 1024 * 128;
        let rb = HeapRb::<f32>::new(buffer_size);
        let (producer, consumer) = rb.split();

        let current_sample_rate = Arc::new(AtomicU32::new(asbd.sample_rate as u32));

        // The aggregate lists the output device's own input streams before the
        // tap. A USB headset or AirPods in call mode has a microphone stream
        // there; built-in speakers have none.
        let tap_index = match mode {
            TapMode::DeviceBound => output_device
                .input_stream_cfg()
                .map(|cfg| cfg.number_buffers())
                .unwrap_or(0),
            TapMode::Global => 0,
        };
        println!("[CoreAudioTap] Output device input streams: {} (tap buffer index {})", tap_index, tap_index);

        let mut ctx = Box::new(Ctx {
            format,
            producer,
            channels,
            tap_index,
            current_sample_rate: current_sample_rate.clone(),
        });

        let agg_device = ca::AggregateDevice::with_desc(&agg_desc)?;

        let proc_id = agg_device.create_io_proc_id(proc, Some(&mut *ctx))?;
        let started_device = ca::device_start(agg_device, Some(proc_id))?;
        println!("[CoreAudioTap] Aggregate device started successfully");

        // We now return the fully started device inside Ok.
        // If anything above fails, it yields an Err(), triggering SCK fallback smoothly!
        Ok(Self {
            tap,
            device: Some(started_device),
            _ctx: ctx,
            consumer: Some(consumer),
            current_sample_rate,
        })
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        Ok(SpeakerStream {
            consumer: self.consumer,
            _device: self.device,
            _ctx: self._ctx,
            _tap: self.tap,
            current_sample_rate: self.current_sample_rate,
        })
    }
}

extern "C" fn proc(
    _device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    ctx: Option<&mut Ctx>,
) -> os::Status {
    let ctx = ctx.unwrap();

    // BUGFIX: Do NOT overwrite with the overall aggregate device actual_sample_rate().
    // The macOS Global Process Tap forces the actual input_data buffer to operate strictly
    // at the ASBD format rate (usually 48000Hz). Telling JS the clock is running at 16k/24kHz
    // (AirPods HFP) causes STT to process 48kHz arrays at 24kHz speed (deep demom voice).
    // The ASBD format is the ONLY source of truth for the buffer layout!
    ctx.current_sample_rate
        .store(ctx.format.absd().sample_rate as u32, Ordering::Release);

    // The aggregate's input is the output device's own input streams FIRST, then
    // the tap. Reading buffers[0] only worked while the output device had no input
    // (built-in speakers). On a USB headset, AirPods in call mode or any device
    // with a microphone, buffers[0] is that microphone: the "system audio" channel
    // heard the user, the far side was never transcribed.
    let Some(tap_buffer) = tap_buffer(input_data, ctx.tap_index, ctx.channels) else {
        return os::Status::NO_ERR;
    };

    if ctx.format.common_format() == av::audio::CommonFormat::PcmF32 {
        let byte_count = tap_buffer.data_bytes_size as usize;
        let float_count = byte_count / std::mem::size_of::<f32>();

        if float_count > 0 && !tap_buffer.data.is_null() {
            let data =
                unsafe { std::slice::from_raw_parts(tap_buffer.data as *const f32, float_count) };

            let actual_ch = tap_buffer.number_channels.max(1);

            push_audio(ctx, data, actual_ch);
        }
    }

    os::Status::NO_ERR
}

/// The tap's buffer in the aggregate device's input list. Expected at
/// `tap_index` (the output device's input stream count) with the tap's channel
/// count; if the layout ever differs, the last buffer with that channel count.
/// None rather than a guess: a wrong pick would transcribe the user's own mic
/// as the other side.
fn tap_buffer(
    input_data: &cat::AudioBufList<1>,
    tap_index: usize,
    tap_channels: u32,
) -> Option<&cat::AudioBuf> {
    let count = input_data.number_buffers as usize;
    if count == 0 {
        return None;
    }
    // `AudioBufList<1>` declares one entry; CoreAudio writes `number_buffers`.
    let buffers = unsafe { std::slice::from_raw_parts(input_data.buffers.as_ptr(), count) };
    let want = tap_channels.max(1);
    match buffers.get(tap_index) {
        Some(b) if b.number_channels == want => Some(b),
        _ => buffers.iter().rev().find(|b| b.number_channels == want),
    }
}

#[inline(always)]
fn push_audio(ctx: &mut Ctx, data: &[f32], channels: u32) {
    if channels <= 1 {
        let _pushed = ctx.producer.push_slice(data);
    } else {
        let ch = channels as usize;
        let frame_count = data.len() / ch;
        for i in 0..frame_count {
            let base = i * ch;
            let mut sum: f32 = 0.0;
            for c in 0..ch {
                sum += data[base + c];
            }
            let mono = sum / channels as f32;
            let _ = ctx.producer.try_push(mono);
        }
    }
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    _device: Option<ca::hardware::StartedDevice<ca::AggregateDevice>>,
    _ctx: Box<Ctx>,
    _tap: ca::TapGuard,
    current_sample_rate: Arc<AtomicU32>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.current_sample_rate.load(Ordering::Acquire)
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    pub fn backend_name(&self) -> &'static str {
        "coreaudio"
    }

    /// Pause the aggregate device without destroying it.
    /// Allows fast restart without the 1-second audio mute.
    /// NOTE: This is a one-way operation for CoreAudio — resume() is not supported.
    pub fn pause(&mut self) {
        self._device = None;
        println!("[CoreAudioTap] Device paused (aggregate device preserved in HAL)");
    }

    /// Resume is not supported for CoreAudio aggregate devices — they must be fully recreated.
    /// Callers should detect this and recreate the SpeakerInput/SpeakerStream.
    pub fn resume(&mut self) -> Result<()> {
        if self._device.is_none() {
            println!(
                "[CoreAudioTap] Resume not supported — aggregate device needs full recreation"
            );
            return Err(anyhow::anyhow!(
                "CoreAudio aggregate device resume not supported — recreate required"
            ));
        }
        Ok(())
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        // `_device` is stopped when dropped — either by explicit `pause()` (which sets it to None)
        // or when `SpeakerStream` itself is destroyed. No explicit teardown needed.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buf(channels: u32, data: &mut [f32]) -> cat::AudioBuf {
        cat::AudioBuf {
            number_channels: channels,
            data_bytes_size: (data.len() * std::mem::size_of::<f32>()) as u32,
            data: data.as_mut_ptr() as *mut u8,
        }
    }

    /// An output device with a microphone (USB headset, AirPods in call mode)
    /// puts its own input first; the tap must still be the buffer we read.
    #[test]
    fn tap_buffer_skips_the_output_devices_own_input_streams() {
        let mut mic = [0.5f32; 8];
        let mut tap = [0.25f32; 4];
        let list = cat::AudioBufList::<2> {
            number_buffers: 2,
            buffers: [buf(2, &mut mic), buf(1, &mut tap)],
        };
        let as_one = unsafe { &*(&list as *const cat::AudioBufList<2> as *const cat::AudioBufList<1>) };
        let chosen = tap_buffer(as_one, 1, 1).expect("a buffer");
        assert_eq!(chosen.number_channels, 1);
        assert_eq!(chosen.data, tap.as_mut_ptr() as *mut u8);
    }

    /// Output-only device (built-in speakers): the tap is the only buffer.
    #[test]
    fn tap_buffer_is_the_only_buffer_on_an_output_only_device() {
        let mut tap = [0.25f32; 4];
        let list = cat::AudioBufList::<1> { number_buffers: 1, buffers: [buf(1, &mut tap)] };
        assert_eq!(tap_buffer(&list, 0, 1).expect("a buffer").data, tap.as_mut_ptr() as *mut u8);
        let empty = cat::AudioBufList::<1> { number_buffers: 0, buffers: [buf(1, &mut tap)] };
        assert!(tap_buffer(&empty, 0, 1).is_none());
    }

    /// A stale index (layout changed after setup) still finds the tap by its
    /// channel count, and never falls back to a buffer that is not the tap.
    #[test]
    fn tap_buffer_never_returns_the_microphone_stream() {
        let mut mic = [0.5f32; 8];
        let mut tap = [0.25f32; 4];
        let list = cat::AudioBufList::<2> {
            number_buffers: 2,
            buffers: [buf(1, &mut tap), buf(2, &mut mic)],
        };
        let as_one = unsafe { &*(&list as *const cat::AudioBufList<2> as *const cat::AudioBufList<1>) };
        assert_eq!(tap_buffer(as_one, 1, 1).expect("the tap").data, tap.as_mut_ptr() as *mut u8);
        let only_mic = cat::AudioBufList::<1> { number_buffers: 1, buffers: [buf(2, &mut mic)] };
        assert!(tap_buffer(&only_mic, 0, 1).is_none());
    }

    /// Regression test for issue #249: pins the runtime version-gate contract.
    /// `OsVersion::at_least()` resolves via `__isPlatformVersionAtLeast`, so this also proves
    /// that the C entrypoint is linked and the compile-time `cidre::api` surface used by
    /// `SpeakerInput::new` is wired correctly. Test host is macOS 14.4+ (Darwin 25.x).
    #[test]
    fn tap_mode_device_bound_from_14_4_global_on_14_2_and_14_3_none_below() {
        assert_eq!(tap_mode(true, true, false), Some(TapMode::DeviceBound));
        assert_eq!(tap_mode(false, true, false), Some(TapMode::Global));
        assert_eq!(tap_mode(false, false, false), None);
        // The harness can force the 14.2 path on a newer macOS, never below 14.2.
        assert_eq!(tap_mode(true, true, true), Some(TapMode::Global));
        assert_eq!(tap_mode(false, false, true), None);
    }

    #[test]
    fn os_version_gate_resolves_macos_14_4_on_modern_hosts() {
        // 14.4 must be reported true on a modern host (14.4+). If this flips, the gate is broken.
        assert!(
            api::OsVersion {
                major: 14,
                minor: 4,
                patch: 0
            }
            .at_least(),
            "macOS 14.4 should report at_least() == true on a >=14.4 host"
        );
    }

    /// Inverse direction: a fictitious far-future macOS must report false. Proves we
    /// aren't accidentally short-circuiting to always-true.
    #[test]
    fn os_version_gate_rejects_future_version() {
        assert!(
            !api::OsVersion {
                major: 99,
                minor: 0,
                patch: 0
            }
            .at_least(),
            "macOS 99.0 must not report at_least() == true"
        );
    }

    /// Same contract via ProcessInfo (the API actually called from SpeakerInput::new).
    /// Locks in that the cidre selector binding matches Foundation's
    /// -[NSProcessInfo isOperatingSystemAtLeastVersion:] on this host.
    #[test]
    fn process_info_is_os_at_least_14_4_on_modern_hosts() {
        let pi = ns::ProcessInfo::current();
        assert!(
            pi.is_os_at_least_version(api::OsVersion {
                major: 14,
                minor: 4,
                patch: 0
            }),
            "ProcessInfo.isOperatingSystemAtLeastVersion(14.4) must be true on a >=14.4 host"
        );
        assert!(
            !pi.is_os_at_least_version(api::OsVersion {
                major: 99,
                minor: 0,
                patch: 0
            }),
            "ProcessInfo.isOperatingSystemAtLeastVersion(99.0) must be false"
        );
    }
}
