//! Issue #710 probe: does opening the Windows microphone in communications
//! mode make Windows cancel the speaker echo?
//!
//! Natively opens the mic through cpal, which initializes WASAPI with no
//! stream category, so Windows applies its default processing and no echo
//! cancellation. A stream marked `AudioCategory_Communications` (set with
//! `IAudioClient2::SetClientProperties` before `Initialize`) gets the device's
//! communications processing, which on many laptops includes acoustic echo
//! cancellation. Whether it does on a given PC depends on the mic driver and
//! the Windows build, so this measures it instead of assuming.
//!
//! For each mode (default, then communications) it records the default mic and,
//! at the same time, what the speakers play (WASAPI loopback, the same signal
//! Natively transcribes as the meeting). With the tester silent and speech
//! playing, everything the mic picks up is echo, so:
//!
//!   echo coupling = mic level − speaker level, over the moments speech plays
//!
//! Lower is better; the drop from default to communications mode is the echo
//! the OS removed. It also lists the audio effects Windows reports on the mic
//! stream (echo cancellation, noise suppression…, Windows 11 only) and checks
//! whether opening a communications stream turned the speakers down (ducking).
//!
//! Usage (on the Windows PC, speech playing through the laptop speakers):
//!   cargo run --release -- [--seconds 20] [--mode both|default|comms]
//!                          [--role console|communications] [--allow-ducking]
//!                          [--out aec-probe-out]

#[cfg(not(windows))]
fn main() {
    eprintln!("win-aec-probe runs on Windows only: it opens the Windows microphone through WASAPI.");
    std::process::exit(2);
}

#[cfg(windows)]
fn main() {
    if let Err(e) = win::run() {
        eprintln!("\nerror: {e}");
        std::process::exit(1);
    }
}

/// Signal measurements. No Windows APIs, so the tests run on any OS.
#[allow(dead_code)]
mod analysis {
    pub const ANALYSIS_RATE: u32 = 8000;
    /// 100 ms blocks at the analysis rate.
    const BLOCK: usize = (ANALYSIS_RATE / 10) as usize;
    /// A speaker block counts as "playing" above this level.
    pub const ACTIVE_DBFS: f32 = -50.0;

    pub fn db(power: f64) -> f32 {
        (10.0 * power.max(1e-12).log10()) as f32
    }

    pub fn rms_dbfs(x: &[f32]) -> f32 {
        if x.is_empty() {
            return -120.0;
        }
        db(x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() / x.len() as f64)
    }

    pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
        if channels <= 1 {
            return interleaved.to_vec();
        }
        interleaved
            .chunks_exact(channels)
            .map(|f| f.iter().sum::<f32>() / channels as f32)
            .collect()
    }

    pub fn resample_linear(x: &[f32], from: u32, to: u32) -> Vec<f32> {
        if x.is_empty() || from == to {
            return x.to_vec();
        }
        let n = (x.len() as u64 * to as u64 / from as u64) as usize;
        let step = from as f64 / to as f64;
        (0..n)
            .map(|i| {
                let pos = i as f64 * step;
                let j = pos.floor() as usize;
                let frac = (pos - j as f64) as f32;
                let a = x[j.min(x.len() - 1)];
                let b = x[(j + 1).min(x.len() - 1)];
                a + (b - a) * frac
            })
            .collect()
    }

    pub struct Coupling {
        /// Mic level minus speaker level over blocks where the speakers play, dB.
        pub coupling_db: Option<f32>,
        /// Share of the run the speakers were playing, 0..1.
        pub active_share: f32,
        /// Mic level while the speakers were quiet (room noise + the tester), dBFS.
        pub mic_quiet_dbfs: Option<f32>,
    }

    /// `mic` and `speakers` are mono at the analysis rate.
    pub fn coupling(mic: &[f32], speakers: &[f32]) -> Coupling {
        let n = mic.len().min(speakers.len()) / BLOCK;
        let (mut mic_on, mut spk_on, mut mic_off) = (0f64, 0f64, 0f64);
        let (mut on, mut off) = (0usize, 0usize);
        let power = |s: &[f32]| s.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>();
        for b in 0..n {
            let r = b * BLOCK..(b + 1) * BLOCK;
            let sp = power(&speakers[r.clone()]);
            let mp = power(&mic[r]);
            if db(sp / BLOCK as f64) > ACTIVE_DBFS {
                spk_on += sp;
                mic_on += mp;
                on += 1;
            } else {
                mic_off += mp;
                off += 1;
            }
        }
        Coupling {
            coupling_db: (on > 0).then(|| db(mic_on) - db(spk_on)),
            active_share: if n == 0 { 0.0 } else { on as f32 / n as f32 },
            mic_quiet_dbfs: (off > 0).then(|| db(mic_off / (off * BLOCK) as f64)),
        }
    }

    pub struct Xcorr {
        /// Peak normalized cross-correlation, 0..1: how much of the mic is the speaker signal.
        pub peak: f32,
        /// Mic delay behind the speakers at the peak, ms.
        pub lag_ms: f32,
    }

    /// Normalized cross-correlation of mono signals at `rate`, mic lagging
    /// the speakers by `min_lag_ms..=max_lag_ms` (negative = mic leads).
    pub fn xcorr_peak(mic: &[f32], speakers: &[f32], rate: u32, min_lag_ms: i32, max_lag_ms: i32) -> Xcorr {
        let energy = |s: &[f32]| s.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>();
        let norm = (energy(mic) * energy(speakers)).sqrt();
        if norm <= 0.0 {
            return Xcorr { peak: 0.0, lag_ms: 0.0 };
        }
        let to_samples = |ms: i32| (ms as i64 * rate as i64 / 1000) as isize;
        let (mut best, mut best_lag) = (0f64, 0isize);
        for lag in to_samples(min_lag_ms)..=to_samples(max_lag_ms) {
            // mic[i] against speakers[i - lag]
            let start = lag.max(0) as usize;
            let end = (speakers.len() as isize + lag).min(mic.len() as isize).max(0) as usize;
            if start >= end {
                continue;
            }
            let mut acc = 0f64;
            for i in start..end {
                acc += mic[i] as f64 * speakers[(i as isize - lag) as usize] as f64;
            }
            let c = (acc / norm).abs();
            if c > best {
                best = c;
                best_lag = lag;
            }
        }
        Xcorr { peak: best as f32, lag_ms: best_lag as f32 * 1000.0 / rate as f32 }
    }

    /// 16-bit PCM WAV of interleaved float samples.
    pub fn wav_bytes(samples: &[f32], channels: u16, rate: u32) -> Vec<u8> {
        let data_len = (samples.len() * 2) as u32;
        let mut out = Vec::with_capacity(44 + data_len as usize);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for &s in samples {
            out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        out
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn noise(n: usize, seed: u32) -> Vec<f32> {
            let mut s = seed;
            (0..n)
                .map(|_| {
                    s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                    (s >> 8) as f32 / (1u32 << 24) as f32 - 0.5
                })
                .collect()
        }

        #[test]
        fn finds_the_echo_delay_and_strength() {
            let spk = noise(8000 * 4, 1);
            let delay = 400; // 50 ms
            let mut mic = vec![0.0; delay];
            mic.extend(spk.iter().map(|v| v * 0.1));
            mic.truncate(spk.len());
            let x = xcorr_peak(&mic, &spk, 8000, -100, 300);
            assert!((x.lag_ms - 50.0).abs() < 0.5, "lag {}", x.lag_ms);
            assert!(x.peak > 0.95, "peak {}", x.peak);
        }

        #[test]
        fn unrelated_signals_barely_correlate() {
            let x = xcorr_peak(&noise(8000 * 4, 1), &noise(8000 * 4, 2), 8000, -100, 300);
            assert!(x.peak < 0.05, "peak {}", x.peak);
        }

        #[test]
        fn coupling_is_the_level_gap_while_speakers_play() {
            let spk = noise(8000 * 2, 3);
            let mic: Vec<f32> = spk.iter().map(|v| v * 0.1).collect(); // −20 dB
            let c = coupling(&mic, &spk);
            assert!((c.coupling_db.unwrap() + 20.0).abs() < 0.01);
            assert_eq!(c.active_share, 1.0);
            assert!(c.mic_quiet_dbfs.is_none());
        }

        #[test]
        fn quiet_speakers_give_no_coupling() {
            let c = coupling(&noise(8000, 4), &vec![0.0; 8000]);
            assert!(c.coupling_db.is_none());
            assert_eq!(c.active_share, 0.0);
        }

        #[test]
        fn resample_and_mono() {
            assert_eq!(resample_linear(&vec![0.0; 48000], 48000, 8000).len(), 8000);
            assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        }

        #[test]
        fn wav_header_sizes() {
            let w = wav_bytes(&[0.0; 10], 2, 48000);
            assert_eq!(&w[0..4], b"RIFF");
            assert_eq!(w.len(), 44 + 20);
            assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()), 20);
        }
    }
}

#[cfg(windows)]
mod win {
    use crate::analysis::{self, ANALYSIS_RATE};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};
    use windows::core::{ComInterface, GUID};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{FALSE, TRUE};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::Media::KernelStreaming::*;
    use windows::Win32::Media::Multimedia::{KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT};
    use windows::Win32::System::Com::*;

    /// 1 s of WASAPI buffer, drained every 10 ms.
    const BUFFER_HNS: i64 = 10_000_000;

    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        Default,
        Comms,
    }

    impl Mode {
        fn label(self) -> &'static str {
            match self {
                Mode::Default => "default",
                Mode::Comms => "communications",
            }
        }
    }

    struct Args {
        seconds: u64,
        modes: Vec<Mode>,
        role: ERole,
        allow_ducking: bool,
        out: PathBuf,
    }

    fn parse_args() -> Result<Args, String> {
        let mut a = Args {
            seconds: 20,
            modes: vec![Mode::Default, Mode::Comms],
            role: eConsole,
            allow_ducking: false,
            out: PathBuf::from("aec-probe-out"),
        };
        let mut it = std::env::args().skip(1);
        while let Some(flag) = it.next() {
            let mut value = || it.next().ok_or_else(|| format!("{flag} needs a value"));
            match flag.as_str() {
                "--seconds" => {
                    a.seconds = value()?.parse().map_err(|_| "--seconds takes a number".to_string())?;
                    if a.seconds < 5 {
                        return Err("--seconds must be at least 5".into());
                    }
                }
                "--mode" => {
                    a.modes = match value()?.as_str() {
                        "both" => vec![Mode::Default, Mode::Comms],
                        "default" => vec![Mode::Default],
                        "comms" | "communications" => vec![Mode::Comms],
                        other => return Err(format!("unknown --mode {other} (both|default|comms)")),
                    }
                }
                "--role" => {
                    a.role = match value()?.as_str() {
                        "console" => eConsole,
                        "communications" | "comms" => eCommunications,
                        other => return Err(format!("unknown --role {other} (console|communications)")),
                    }
                }
                "--allow-ducking" => a.allow_ducking = true,
                "--out" => a.out = PathBuf::from(value()?),
                "-h" | "--help" => {
                    println!("win-aec-probe [--seconds 20] [--mode both|default|comms] [--role console|communications] [--allow-ducking] [--out DIR]");
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument {other}")),
            }
        }
        Ok(a)
    }

    #[derive(Clone, Copy)]
    enum Kind {
        F32,
        I16,
        I24,
        I32,
    }

    #[derive(Clone, Copy)]
    struct Fmt {
        channels: usize,
        rate: u32,
        kind: Kind,
    }

    impl Fmt {
        unsafe fn read(p: *const WAVEFORMATEX) -> Result<Fmt, String> {
            let f: WAVEFORMATEX = std::ptr::read_unaligned(p);
            let (tag, bits, channels, rate) = (f.wFormatTag as u32, f.wBitsPerSample, f.nChannels as usize, f.nSamplesPerSec);
            let float = if tag == WAVE_FORMAT_IEEE_FLOAT {
                true
            } else if tag == WAVE_FORMAT_PCM {
                false
            } else if tag == WAVE_FORMAT_EXTENSIBLE {
                let ext: WAVEFORMATEXTENSIBLE = std::ptr::read_unaligned(p as *const WAVEFORMATEXTENSIBLE);
                let sub: GUID = ext.SubFormat;
                if sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                    true
                } else if sub == KSDATAFORMAT_SUBTYPE_PCM {
                    false
                } else {
                    return Err(format!("unsupported sub-format {sub:?}"));
                }
            } else {
                return Err(format!("unsupported format tag {tag}"));
            };
            let kind = match (float, bits) {
                (true, 32) => Kind::F32,
                (false, 16) => Kind::I16,
                (false, 24) => Kind::I24,
                (false, 32) => Kind::I32,
                _ => return Err(format!("unsupported sample format: float={float} bits={bits}")),
            };
            Ok(Fmt { channels, rate, kind })
        }

        fn bytes_per_sample(&self) -> usize {
            match self.kind {
                Kind::F32 | Kind::I32 => 4,
                Kind::I16 => 2,
                Kind::I24 => 3,
            }
        }

        fn describe(&self) -> String {
            let k = match self.kind {
                Kind::F32 => "float32",
                Kind::I16 => "int16",
                Kind::I24 => "int24",
                Kind::I32 => "int32",
            };
            format!("{} Hz, {} ch, {k}", self.rate, self.channels)
        }

        fn decode(&self, bytes: &[u8], out: &mut Vec<f32>) {
            let n = self.bytes_per_sample();
            for s in bytes.chunks_exact(n) {
                out.push(match self.kind {
                    Kind::F32 => f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
                    Kind::I16 => i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0,
                    Kind::I24 => (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8_388_608.0,
                    Kind::I32 => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2_147_483_648.0,
                });
            }
        }
    }

    unsafe fn friendly_name(dev: &IMMDevice) -> String {
        let Ok(store) = dev.OpenPropertyStore(STGM_READ) else { return "(name unavailable)".into() };
        let Ok(value) = store.GetValue(&PKEY_Device_FriendlyName) else { return "(name unavailable)".into() };
        value.Anonymous.Anonymous.Anonymous.pwszVal.to_string().unwrap_or_else(|_| "(name unavailable)".into())
    }

    unsafe fn device_id(dev: &IMMDevice) -> String {
        match dev.GetId() {
            Ok(id) => {
                let s = id.to_string().unwrap_or_default();
                CoTaskMemFree(Some(id.0 as *const _));
                s
            }
            Err(_) => String::new(),
        }
    }

    fn effect_name(id: &GUID) -> String {
        let known = [
            (AUDIO_EFFECT_TYPE_ACOUSTIC_ECHO_CANCELLATION, "Acoustic echo cancellation"),
            (AUDIO_EFFECT_TYPE_NOISE_SUPPRESSION, "Noise suppression"),
            (AUDIO_EFFECT_TYPE_DEEP_NOISE_SUPPRESSION, "Deep noise suppression"),
            (AUDIO_EFFECT_TYPE_AUTOMATIC_GAIN_CONTROL, "Automatic gain control"),
            (AUDIO_EFFECT_TYPE_BEAMFORMING, "Beamforming"),
            (AUDIO_EFFECT_TYPE_FAR_FIELD_BEAMFORMING, "Far-field beamforming"),
            (AUDIO_EFFECT_TYPE_CONSTANT_TONE_REMOVAL, "Constant tone removal"),
            (AUDIO_EFFECT_TYPE_DYNAMIC_RANGE_COMPRESSION, "Dynamic range compression"),
            (AUDIO_EFFECT_TYPE_EQUALIZER, "Equalizer"),
            (AUDIO_EFFECT_TYPE_LOUDNESS_EQUALIZER, "Loudness equalizer"),
            (AUDIO_EFFECT_TYPE_ENVIRONMENTAL_EFFECTS, "Environmental effects"),
        ];
        known
            .iter()
            .find(|(g, _)| g == id)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| format!("{id:?}"))
    }

    struct Effect {
        name: String,
        is_aec: bool,
        on: bool,
        can_set: bool,
    }

    /// None when Windows can't report effects (IAudioEffectsManager is Windows 11 only).
    unsafe fn list_effects(client: &IAudioClient2) -> Option<Vec<Effect>> {
        let mgr: IAudioEffectsManager = client.GetService().ok()?;
        let mut p: *mut AUDIO_EFFECT = std::ptr::null_mut();
        let mut n = 0u32;
        mgr.GetAudioEffects(&mut p, &mut n).ok()?;
        let list = if p.is_null() {
            Vec::new()
        } else {
            std::slice::from_raw_parts(p, n as usize)
                .iter()
                .map(|e| Effect {
                    name: effect_name(&e.id),
                    is_aec: e.id == AUDIO_EFFECT_TYPE_ACOUSTIC_ECHO_CANCELLATION,
                    on: e.state == AUDIO_EFFECT_STATE_ON,
                    can_set: e.canSetState.as_bool(),
                })
                .collect()
        };
        if !p.is_null() {
            CoTaskMemFree(Some(p as *const _));
        }
        Some(list)
    }

    /// Drain every packet waiting in `cap`. Returns the frames read.
    unsafe fn drain(cap: &IAudioCaptureClient, fmt: &Fmt, out: &mut Vec<f32>) -> windows::core::Result<usize> {
        let mut total = 0usize;
        loop {
            if cap.GetNextPacketSize()? == 0 {
                return Ok(total);
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
            let samples = frames as usize * fmt.channels;
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                out.extend(std::iter::repeat_n(0.0, samples));
            } else {
                fmt.decode(std::slice::from_raw_parts(data, samples * fmt.bytes_per_sample()), out);
            }
            cap.ReleaseBuffer(frames)?;
            total += frames as usize;
        }
    }

    struct Run {
        mode: Mode,
        mic_fmt: Fmt,
        spk_fmt: Fmt,
        effects: Option<Vec<Effect>>,
        ducking_opt_out: Option<Result<(), String>>,
        mic: Vec<f32>,
        spk: Vec<f32>,
    }

    /// Prefixes a WASAPI error with the step that failed.
    fn ctx(what: &'static str) -> impl Fn(windows::core::Error) -> String {
        move |err| format!("{what}: {err}")
    }

    unsafe fn capture(mic_dev: &IMMDevice, spk_dev: &IMMDevice, mode: Mode, seconds: u64, allow_ducking: bool) -> Result<Run, String> {
        let e = ctx;

        // The microphone, in the mode under test.
        let mic_client: IAudioClient2 = mic_dev.Activate(CLSCTX_ALL, None).map_err(e("activate mic"))?;
        if mode == Mode::Comms {
            let props = AudioClientProperties {
                cbSize: std::mem::size_of::<AudioClientProperties>() as u32,
                bIsOffload: FALSE,
                eCategory: AudioCategory_Communications,
                Options: AUDCLNT_STREAMOPTIONS_NONE,
            };
            mic_client.SetClientProperties(&props).map_err(e("SetClientProperties(Communications)"))?;
        }
        let mic_fmt_ptr = mic_client.GetMixFormat().map_err(e("mic mix format"))?;
        let mic_fmt = Fmt::read(mic_fmt_ptr)?;
        let init = mic_client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, BUFFER_HNS, 0, mic_fmt_ptr, None);
        CoTaskMemFree(Some(mic_fmt_ptr as *const _));
        init.map_err(e("initialize mic"))?;

        let ducking_opt_out = (mode == Mode::Comms && !allow_ducking).then(|| {
            let session: Result<IAudioSessionControl, _> = mic_client.GetService();
            session
                .and_then(|s| s.cast::<IAudioSessionControl2>())
                .and_then(|s2| s2.SetDuckingPreference(TRUE))
                .map_err(|err| err.to_string())
        });
        let effects = list_effects(&mic_client);

        // What the speakers play: the reference the echo comes from.
        let spk_client: IAudioClient = spk_dev.Activate(CLSCTX_ALL, None).map_err(e("activate speakers"))?;
        let spk_fmt_ptr = spk_client.GetMixFormat().map_err(e("speaker mix format"))?;
        let spk_fmt = Fmt::read(spk_fmt_ptr)?;
        let init = spk_client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, BUFFER_HNS, 0, spk_fmt_ptr, None);
        CoTaskMemFree(Some(spk_fmt_ptr as *const _));
        init.map_err(e("initialize speaker loopback"))?;

        let mic_cap: IAudioCaptureClient = mic_client.GetService().map_err(e("mic capture client"))?;
        let spk_cap: IAudioCaptureClient = spk_client.GetService().map_err(e("loopback capture client"))?;

        let (mut mic, mut spk) = (Vec::new(), Vec::new());
        spk_client.Start().map_err(e("start loopback"))?;
        mic_client.Start().map_err(e("start mic"))?;
        let start = Instant::now();
        let total = Duration::from_secs(seconds);
        let mut last_tick = 0;
        while start.elapsed() < total {
            std::thread::sleep(Duration::from_millis(10));
            drain(&mic_cap, &mic_fmt, &mut mic).map_err(e("read mic"))?;
            let got = drain(&spk_cap, &spk_fmt, &mut spk).map_err(e("read loopback"))?;
            // Loopback sends nothing while nothing plays: pad, so both stay time-aligned.
            let expected = (start.elapsed().as_secs_f64() * spk_fmt.rate as f64) as usize;
            let have = spk.len() / spk_fmt.channels;
            if got == 0 && have + (spk_fmt.rate as usize / 20) < expected {
                spk.extend(std::iter::repeat_n(0.0, (expected - have) * spk_fmt.channels));
            }
            let tick = start.elapsed().as_secs();
            if tick != last_tick {
                last_tick = tick;
                print!("\r  recording {} … {tick}/{seconds} s", mode.label());
                let _ = std::io::stdout().flush();
            }
        }
        let _ = mic_client.Stop();
        let _ = spk_client.Stop();
        println!("\r  recording {} … done          ", mode.label());
        Ok(Run { mode, mic_fmt, spk_fmt, effects, ducking_opt_out, mic, spk })
    }

    struct Measured {
        mic_dbfs: f32,
        spk_dbfs: f32,
        coupling: analysis::Coupling,
        xcorr: analysis::Xcorr,
    }

    fn measure(r: &Run) -> Measured {
        let mic = analysis::resample_linear(&analysis::to_mono(&r.mic, r.mic_fmt.channels), r.mic_fmt.rate, ANALYSIS_RATE);
        let spk = analysis::resample_linear(&analysis::to_mono(&r.spk, r.spk_fmt.channels), r.spk_fmt.rate, ANALYSIS_RATE);
        Measured {
            mic_dbfs: analysis::rms_dbfs(&mic),
            spk_dbfs: analysis::rms_dbfs(&spk),
            coupling: analysis::coupling(&mic, &spk),
            xcorr: analysis::xcorr_peak(&mic, &spk, ANALYSIS_RATE, -100, 500),
        }
    }

    fn report(r: &Run, m: &Measured, out: &Path) {
        println!("\n=== {} mode ===", r.mode.label());
        println!("  mic format:            {}", r.mic_fmt.describe());
        println!("  speaker format:        {}", r.spk_fmt.describe());
        match &r.effects {
            None => println!("  effects on mic stream: not reported by Windows (needs Windows 11)"),
            Some(list) if list.is_empty() => println!("  effects on mic stream: none listed"),
            Some(list) => {
                println!("  effects on mic stream:");
                for fx in list {
                    println!(
                        "    - {:<28} {}{}",
                        fx.name,
                        if fx.on { "ON" } else { "off" },
                        if fx.can_set { " (app can toggle)" } else { "" }
                    );
                }
            }
        }
        if let Some(d) = &r.ducking_opt_out {
            match d {
                Ok(()) => println!("  ducking opt-out:       set"),
                Err(err) => println!("  ducking opt-out:       FAILED ({err})"),
            }
        }
        println!("  speaker level:         {:.1} dBFS", m.spk_dbfs);
        println!("  mic level:             {:.1} dBFS", m.mic_dbfs);
        println!("  speakers playing:      {:.0}% of the run", m.coupling.active_share * 100.0);
        match m.coupling.coupling_db {
            Some(c) => println!("  echo coupling:         {c:.1} dB   (mic vs speakers while speech plays; lower = less echo)"),
            None => println!("  echo coupling:         n/a (the speakers were quiet)"),
        }
        if let Some(q) = m.coupling.mic_quiet_dbfs {
            println!("  mic while speakers off: {q:.1} dBFS");
        }
        println!("  echo correlation:      {:.2} at {:.0} ms   (0 = none of the speaker signal in the mic)", m.xcorr.peak, m.xcorr.lag_ms);
        let mode = r.mode.label();
        for (name, data, fmt) in [("mic", &r.mic, &r.mic_fmt), ("speakers", &r.spk, &r.spk_fmt)] {
            let path = out.join(format!("{name}-{mode}.wav"));
            match std::fs::write(&path, analysis::wav_bytes(data, fmt.channels as u16, fmt.rate)) {
                Ok(()) => println!("  saved {}", path.display()),
                Err(err) => println!("  could not save {}: {err}", path.display()),
            }
        }
    }

    fn summarize(runs: &[(Run, Measured)]) {
        println!("\n=== Summary ===");
        let comms = runs.iter().find(|(r, _)| r.mode == Mode::Comms);
        let default = runs.iter().find(|(r, _)| r.mode == Mode::Default);

        if let Some((r, _)) = comms {
            let aec = r.effects.as_ref().map(|l| l.iter().find(|f| f.is_aec).map(|f| f.on));
            println!(
                "  Windows reports echo cancellation in communications mode: {}",
                match aec {
                    None => "unknown (effects list needs Windows 11)",
                    Some(None) => "NOT LISTED",
                    Some(Some(true)) => "ON",
                    Some(Some(false)) => "listed but OFF",
                }
            );
        }

        let (Some((_, d)), Some((_, c))) = (default, comms) else {
            println!("  Run with --mode both to compare default against communications mode.");
            return;
        };
        if d.coupling.active_share < 0.3 || c.coupling.active_share < 0.3 {
            println!("  The speakers were quiet for most of a run: play continuous speech and run again.");
            return;
        }
        if let (Some(dc), Some(cc)) = (d.coupling.coupling_db, c.coupling.coupling_db) {
            let reduction = dc - cc;
            println!("  echo coupling: default {dc:.1} dB → communications {cc:.1} dB  (reduction {reduction:.1} dB)");
            println!("  echo correlation: default {:.2} → communications {:.2}", d.xcorr.peak, c.xcorr.peak);
            println!(
                "  VERDICT: {}",
                if reduction >= 15.0 {
                    "communications mode removes most of the speaker echo on this PC."
                } else if reduction >= 6.0 {
                    "communications mode reduces the speaker echo, but only partly. Listen to the WAVs."
                } else {
                    "no meaningful echo reduction from communications mode on this PC."
                }
            );
        }
        if c.spk_dbfs < d.spk_dbfs - 6.0 {
            println!(
                "  WARNING: the speakers were {:.1} dB quieter during the communications run. Windows may have turned other audio down (ducking), or the video just got quieter.",
                d.spk_dbfs - c.spk_dbfs
            );
        }
    }

    pub fn run() -> Result<(), String> {
        let args = parse_args()?;
        std::fs::create_dir_all(&args.out).map_err(|err| format!("create {}: {err}", args.out.display()))?;

        println!("win-aec-probe (Natively issue #710)");
        if let Ok(o) = std::process::Command::new("cmd").args(["/C", "ver"]).output() {
            println!("  {}", String::from_utf8_lossy(&o.stdout).trim());
        }
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).map_err(|err| format!("COM init: {err}"))?;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|err| format!("device enumerator: {err}"))?;
            let mic_dev = enumerator.GetDefaultAudioEndpoint(eCapture, args.role).map_err(|err| format!("default microphone: {err}"))?;
            let spk_dev = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|err| format!("default speakers: {err}"))?;
            println!("  microphone: {}  [{}]", friendly_name(&mic_dev), device_id(&mic_dev));
            println!("  speakers:   {}  [{}]", friendly_name(&spk_dev), device_id(&spk_dev));
            if args.role == eConsole {
                if let Ok(comms_mic) = enumerator.GetDefaultAudioEndpoint(eCapture, eCommunications) {
                    if device_id(&comms_mic) != device_id(&mic_dev) {
                        println!("  note: the default COMMUNICATIONS mic is a different device: {}", friendly_name(&comms_mic));
                    }
                }
            }

            println!("\nPlay continuous speech (a YouTube talk or podcast) through these speakers at a normal");
            println!("listening volume. No headphones. Stay silent while it records. Press Enter to start.");
            let mut line = String::new();
            let _ = std::io::stdin().read_line(&mut line);

            let mut runs = Vec::new();
            for &mode in &args.modes {
                let run = capture(&mic_dev, &spk_dev, mode, args.seconds, args.allow_ducking)?;
                let measured = measure(&run);
                report(&run, &measured, &args.out);
                runs.push((run, measured));
                std::thread::sleep(Duration::from_millis(500));
            }
            summarize(&runs);
            println!("\nPaste everything above into issue #710. The WAVs in {} let you hear the difference.", args.out.display());
            CoUninitialize();
        }
        Ok(())
    }
}
