// Mel-spectrogram frontend for Nemotron 3.5 ASR. Delegates the STFT + mel
// filterbank math to @huggingface/transformers' spectrogram()/mel_filter_bank()
// (src/utils/audio.js) — the same implementation WhisperFeatureExtractor uses —
// rather than hand-rolling an FFT. Params verified against this export's
// audio_processor_config.json (recorded in the design doc): do not change
// without re-verifying against that file; a mismatch produces confidently-wrong
// transcriptions with no error thrown.
//
// NOT reproduced: audio_processor_config.json's `dither: 1e-05` (a tiny random
// perturbation added before windowing, primarily a training-time regularizer).
// spectrogram() has no dither parameter. Omitting it is a deliberate, tiny
// deviation — if Task 11's real-WAV integration test shows a real accuracy
// problem, revisit by adding dither manually before calling spectrogram(), but
// don't pre-emptively build that without evidence it's needed.
//
// Load strategy: @huggingface/transformers is ESM-only in this project's
// packaged-Electron runtime path (see whisperWorker.ts's `loadTransformers()`
// for the established rationale — electron/tsconfig.json compiles with
// `module: CommonJS`, which rewrites a static top-level `import` into
// `require(...)`). We follow that exact precedent here — loading the package
// via a real dynamic `import()` hidden behind `new Function(...)` so
// TypeScript never sees (and never rewrites) the import expression — rather
// than diverging per-module on how this one package gets loaded.
import type { Tensor } from '@huggingface/transformers';

export const SAMPLE_RATE = 16000;
export const N_FFT = 512;
export const HOP_LENGTH = 160;
export const WINDOW_LENGTH = 400;
export const N_MELS = 128;
export const FMIN = 0;
export const FMAX = 8000;
export const PREEMPHASIS = 0.97;
export const MEL_FLOOR = 1e-10;
export const CHUNK_SAMPLES = 8960;
// The encoder's audio_signal input has a FIXED shape [1, 65, 128] — verified
// via Task 1's real inputMetadata recording (docs/superpowers/plans/
// nemotron-tensor-shapes.md), not derived from the STFT frame-count formula.
// spectrogram()'s min/max_num_frames + do_pad force this exactly, whatever
// the organic frame count from center=true reflect-padding works out to.
// Empirically (CHUNK_SAMPLES=8960, hop=160, center=true): the organic frame
// count is 57, so 8 of the 65 output frames are synthetic do_pad padding, not
// real audio — a likely first place to look if Task 11's real-WAV test shows
// degraded accuracy near the end of a chunk.
export const N_FRAMES = 65;

type SpectrogramFn = (
  waveform: Float32Array | Float64Array,
  window: Float32Array | Float64Array,
  frame_length: number,
  hop_length: number,
  options?: Record<string, unknown>,
) => Promise<Tensor>;

interface TransformersAudioExports {
  hanning: (m: number) => Float64Array;
  mel_filter_bank: (
    num_frequency_bins: number,
    num_mel_filters: number,
    min_frequency: number,
    max_frequency: number,
    sampling_rate: number,
    norm?: string | null,
    mel_scale?: string,
  ) => number[][];
  spectrogram: SpectrogramFn;
}

// Loads @huggingface/transformers via a real dynamic import() at runtime.
// Using new Function prevents TypeScript from rewriting import() → require()
// in the CommonJS output, which would fail because the package is ESM-only.
async function loadTransformers(): Promise<TransformersAudioExports> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

// Lazily initialized on first use (module load must not eagerly require the
// ESM-only package — see loadTransformers() above), then cached: the Hanning
// window and mel filter bank are pure functions of the constants above, so
// there is no reason to recompute them per chunk.
let fftWindow: Float64Array | null = null;
let melFilters: number[][] | null = null;
let spectrogramFn: SpectrogramFn | null = null;

async function ensureInitialized(): Promise<void> {
  if (spectrogramFn) return;
  const { hanning, mel_filter_bank, spectrogram } = await loadTransformers();
  fftWindow = hanning(WINDOW_LENGTH);
  melFilters = mel_filter_bank(
    N_FFT / 2 + 1,
    N_MELS,
    FMIN,
    FMAX,
    SAMPLE_RATE,
    null,       // norm — NeMo's default filterbank is unnormalized ("slaney" would
                // change energy scaling; verify against Task 11's real-WAV output
                // if transcription quality looks off, don't assume this is right)
    'htk',      // mel_scale — NeMo uses the HTK mel formula, not Slaney's
  );
  spectrogramFn = spectrogram;
}

export async function computeMelFrame(pcm: Float32Array): Promise<Float32Array> {
  if (pcm.length !== CHUNK_SAMPLES) {
    throw new Error(`computeMelFrame expects exactly ${CHUNK_SAMPLES} samples, got ${pcm.length}`);
  }
  await ensureInitialized();
  const tensor = await spectrogramFn!(pcm, fftWindow!, WINDOW_LENGTH, HOP_LENGTH, {
    fft_length: N_FFT,
    power: 2.0,               // mag_power: 2.0 in audio_processor_config.json
    center: true,              // matches "center": true
    pad_mode: 'reflect',
    preemphasis: PREEMPHASIS,
    mel_filters: melFilters!,
    mel_floor: MEL_FLOOR,       // log_zero_guard_value: 1e-10
    log_mel: 'log',            // natural log, matching log_zero_guard_type: "add" + ln
    min_num_frames: N_FRAMES,  // force exactly 65 frames — the encoder's audio_signal
    max_num_frames: N_FRAMES,  // input shape is fixed, not variable with center-padding math
    do_pad: true,
    // transpose: true → shape (n_frames, n_mels) = (65, 128), matching the
    // encoder's real audio_signal shape [1, 65, 128] (time-major, mel-minor).
    // The default (transpose: false, mel-major) does NOT match — verified
    // against Task 1's recorded inputMetadata, not assumed.
    transpose: true,
  });
  return tensor.data as Float32Array;
}
