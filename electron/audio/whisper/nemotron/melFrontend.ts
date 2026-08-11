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
// This export's REAL log-epsilon, ground-truth-verified against THREE
// independent sources during Task 11's debug1 follow-up (no prior task had
// read any of these beyond genai_config.json's vocab_size/blank_id/
// max_symbols_per_step): (1) genai_config.json's `log_eps` field on the real
// HF repo, (2) a third-party reference numpy/onnxruntime streaming engine
// for this exact export (github.com/codavidgarcia/nemotron-3.5-asr-streaming-onnx,
// `LOG_ZERO_GUARD = 2**-24`, used as `log(mel + LOG_ZERO_GUARD)`), and (3) the
// REAL HuggingFace `transformers` source this export was traced to
// (`transformers/models/nemotron_asr_streaming/feature_extraction_nemotron_asr_streaming.py`,
// `LOG_ZERO_GUARD_VALUE = 2**-24`, `mel_spec = torch.log(mel_spec + LOG_ZERO_GUARD_VALUE)`).
// Previously this constant was sourced from a DIFFERENT, unrelated config
// file (audio_processor_config.json's `log_zero_guard_value: 1e-10`) — not
// what this export's preprocessing was calibrated against (~580x magnitude
// difference). 5.96046448e-08 == 2**-24, the float16 machine epsilon.
export const LOG_EPS = 5.96046448e-08;
export const CHUNK_SAMPLES = 8960;
// The encoder's audio_signal input has a FIXED shape [1, 65, 128] — verified
// via Task 1's real inputMetadata recording (docs/superpowers/plans/
// nemotron-tensor-shapes.md), not derived from the STFT frame-count formula.
// spectrogram()'s min/max_num_frames + do_pad force this exactly, whatever
// the organic frame count from center=true constant-padding works out to.
// Empirically (CHUNK_SAMPLES=8960, hop=160, center=true, frame_length=N_FFT
// per the window-centering fix above): the organic frame count is 56 — this
// cleanly matches genai_config.json's own numbers (N_FRAMES(65) -
// pre_encode_cache_size(9) = 56), unlike the pre-fix framing's 57, which
// didn't. 9 of the 65 output frames are still synthetic do_pad zero-padding,
// not real audio carried from the previous chunk — this is Lead 2's still-
// open finding (see Task 11 debug1 report): genai_config.json's
// `pre_encode_cache_size: 9` strongly suggests those 9 frames should be REAL
// mel features from the tail of the previous chunk, not synthetic padding —
// not implemented here (would require making computeMelFrame chunk-history-
// aware), named as the next concrete step if the fixes actually applied here
// don't resolve the go/no-go gate failure.
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
  // Window centering: ground-truth-verified against the real HF source
  // (Task 11 debug1 follow-up) — `torch.stft(waveform, n_fft=512,
  // win_length=400, window=torch.hann_window(400), center=True)` CENTERS the
  // 400-sample Hann window inside the 512-sample FFT analysis frame (the
  // window occupies samples [56, 456) of each 512-sample frame, with 56
  // zeros on each side — this is standard torch.stft behavior for
  // win_length < n_fft, independently confirmed by the third-party reference
  // engine's own numpy replica: `pad = (N_FFT - WIN_LENGTH) // 2;
  // window = np.pad(hann, (pad, N_FFT - WIN_LENGTH - pad))`).
  // This library's spectrogram() requires `window.length === frame_length`
  // (it throws otherwise) and left-aligns whatever window it's given within
  // the fft_length buffer — so to get torch's centered placement, the window
  // itself must already be pre-padded to N_FFT length, and N_FFT (not
  // WINDOW_LENGTH) must be passed as the `frame_length` argument.
  // Previously this called `hanning(WINDOW_LENGTH)` with `frame_length:
  // WINDOW_LENGTH`, which left-aligns the real 400-sample window at the
  // START of each 512-sample analysis frame (zeros at samples [400,512) only)
  // — a real, previously-unverified time-alignment divergence from torch.stft,
  // independently cross-validated by frame-count arithmetic: computing this
  // way from an isolated CHUNK_SAMPLES=8960 sample chunk yields exactly 56
  // organic (non-padded) frames, matching genai_config.json's implied
  // steady-state frame count (subsampling_factor=8 × 7 encoder lookahead
  // frames = 56, i.e. N_FRAMES(65) - pre_encode_cache_size(9) = 56) —
  // whereas the old WINDOW_LENGTH-based framing produced 57, which did not
  // cleanly match any of genai_config.json's own numbers.
  const rawWindow = hanning(WINDOW_LENGTH);
  const windowPad = Math.floor((N_FFT - WINDOW_LENGTH) / 2);
  fftWindow = new Float64Array(N_FFT);
  fftWindow.set(rawWindow, windowPad);
  // norm + mel_scale: ground-truth-verified against the real HF source
  // (feature_extraction_nemotron_asr_streaming.py, Task 11 debug1 follow-up):
  // `librosa.filters.mel(sr=..., n_fft=..., n_mels=..., fmin=0.0,
  // fmax=sampling_rate/2, norm="slaney")` — librosa's default mel scale
  // (no htk=True passed) is the Slaney formula, AND norm="slaney" area
  // normalization is applied. The previous 'htk' + norm:null here was an
  // unverified guess (the code comment said so explicitly) and was wrong on
  // both axes, not just one.
  melFilters = mel_filter_bank(
    N_FFT / 2 + 1,
    N_MELS,
    FMIN,
    FMAX,
    SAMPLE_RATE,
    'slaney',   // norm
    'slaney',   // mel_scale
  );
  spectrogramFn = spectrogram;
}

export async function computeMelFrame(pcm: Float32Array): Promise<Float32Array> {
  if (pcm.length !== CHUNK_SAMPLES) {
    throw new Error(`computeMelFrame expects exactly ${CHUNK_SAMPLES} samples, got ${pcm.length}`);
  }
  await ensureInitialized();
  // frame_length: N_FFT (512), not WINDOW_LENGTH (400) — see fftWindow's
  // construction above (this library requires window.length === frame_length,
  // and fftWindow is already pre-padded to N_FFT to center the real 400-tap
  // Hann window within it, matching torch.stft's convention).
  const tensor = await spectrogramFn!(pcm, fftWindow!, N_FFT, HOP_LENGTH, {
    fft_length: N_FFT,
    power: 2.0,               // mag_power: 2.0 in audio_processor_config.json
    center: true,              // matches "center": true
    // pad_mode: ground-truth-verified 'constant' (zero-pad), NOT 'reflect' —
    // the real HF source calls `torch.stft(..., pad_mode="constant", center=center)`.
    // 'reflect' was an unverified guess (audio_processor_config.json/genai_config.json
    // never actually specify pad_mode; Task 11 debug1 follow-up traced the real
    // value from HF's feature_extraction_nemotron_asr_streaming.py source instead).
    pad_mode: 'constant',
    preemphasis: PREEMPHASIS,
    mel_filters: melFilters!,
    // mel_floor/mel_offset: ground-truth-verified against the real HF source
    // (Task 11 debug1 follow-up) as `torch.log(mel_spec + LOG_ZERO_GUARD_VALUE)`
    // — an ADD applied before the log, not a clamp. This library's spectrogram()
    // computes `mel_offset + max(mel_floor, x)`; mel power values are always
    // >= 0 (squared FFT magnitudes times non-negative mel filter weights), so
    // `mel_floor: 0` makes `max(0, x) === x` a no-op, and `mel_offset: LOG_EPS`
    // reproduces `x + LOG_EPS` exactly — the real formula. The previous
    // `mel_floor: MEL_FLOOR` (clamp-based) was a different function from the
    // real "add" formula, confirmed via task-11-report.md's own diagnostic
    // (observed mel minimum was exactly the clamped floor value, evidence the
    // clamp — not the add — was what actually ran).
    mel_floor: 0,
    mel_offset: LOG_EPS,
    log_mel: 'log',            // natural log, matching `torch.log(...)`
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
