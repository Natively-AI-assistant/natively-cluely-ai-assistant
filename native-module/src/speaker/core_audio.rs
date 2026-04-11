use anyhow::Result;
use ca::aggregate_device_keys as agg_keys;
use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

struct Ctx {
    format: arc::R<av::AudioFormat>,
    producer: HeapProd<f32>,
    channels: u32,
    current_sample_rate: Arc<AtomicU32>,
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
        // 1. Find the target output device
        let output_device = match device_id {
            Some(ref uid) if !uid.is_empty() && uid != "default" => {
                let devices = ca::System::devices()?;
                devices
                    .into_iter()
                    .find(|d| d.uid().map(|u| u.to_string() == *uid).unwrap_or(false))
                    .unwrap_or(ca::System::default_output_device()?)
            }
            _ => ca::System::default_output_device()?,
        };

        let output_uid = output_device.uid()?;
        println!("[CoreAudioTap] Target device UID: {}", output_uid);

        // 2. Create global tap
        let sub_device = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[output_uid.as_type_ref()],
        );

        let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_desc.create_process_tap()?;
        println!("[CoreAudioTap] Tap created: {:?}", tap.uid());

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid().unwrap().as_type_ref()],
        );

        // 3. Create aggregate device descriptor
        let agg_name = cf::String::from_str("NativelySystemAudioTap");
        let agg_uid = cf::Uuid::new().to_cf_string();

        // Assign arrays to variables first to prevent temporary lifetime drops
        let sub_device_arr = cf::ArrayOf::from_slice(&[sub_device.as_ref()]);
        let sub_tap_arr = cf::ArrayOf::from_slice(&[sub_tap.as_ref()]);

        let agg_desc = cf::DictionaryOf::with_keys_values(
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
                // FIX: Add missing .as_type_ref() calls so all array elements are identical &cf::Type
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false().as_type_ref(),
                cf::Boolean::value_true().as_type_ref(),
                agg_name.as_type_ref(),
                output_uid.as_type_ref(),
                agg_uid.as_type_ref(),
                sub_device_arr.as_type_ref(),
                sub_tap_arr.as_type_ref(),
            ],
        );

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

        let mut ctx = Box::new(Ctx {
            format,
            producer,
            channels,
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

    pub fn stream(self) -> SpeakerStream {
        SpeakerStream {
            consumer: self.consumer,
            _device: self.device,
            _ctx: self._ctx,
            _tap: self.tap,
            current_sample_rate: self.current_sample_rate,
        }
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

    let _channels = ctx.channels;

    if let Some(view) = av::AudioPcmBuf::with_buf_list_no_copy(&ctx.format, input_data, None) {
        if let Some(data) = view.data_f32_at(0) {
            let buffer_channels = input_data.buffers[0].number_channels;
            let actual_ch = if buffer_channels > 1 {
                buffer_channels
            } else {
                2
            };
            push_audio(ctx, data, actual_ch);
        }
    } else if ctx.format.common_format() == av::audio::CommonFormat::PcmF32 {
        let first_buffer = &input_data.buffers[0];
        let byte_count = first_buffer.data_bytes_size as usize;
        let float_count = byte_count / std::mem::size_of::<f32>();

        if float_count > 0 && !first_buffer.data.is_null() {
            let data =
                unsafe { std::slice::from_raw_parts(first_buffer.data as *const f32, float_count) };

            // BUGFIX: macOS CoreAudio Tap notoriously ignores mono ASBD requests
            // and secretly returns interleaved stereo (L,R,L,R).
            let buffer_channels = first_buffer.number_channels;
            let actual_ch = if buffer_channels > 1 {
                buffer_channels
            } else {
                2
            };

            push_audio(ctx, data, actual_ch);
        }
    }

    os::Status::NO_ERR
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
