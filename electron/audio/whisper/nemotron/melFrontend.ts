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
// nemotron-tensor-shapes.md). Of these 65 frames, 56 map 1:1 onto the 7
// encoder output steps via 8x subsampling (measured directly from
// encoder.onnx's real output shape [1,7,1024], confirmed in
// task-11-debug1-report.md §5); the remaining 9 (65-56=9, exactly
// genai_config.json's pre_encode_cache_size) are left-context consumed by
// the encoder's causal conv/attention layers but never directly producing a
// new output step.
export const N_FRAMES = 65;
// Task 11 fix1 round: how many of N_FRAMES are left-context ("pre-encode
// cache") vs how many are this chunk's own new content. Verified via the
// encoder's real output shape (see N_FRAMES's comment) — not config
// arithmetic alone.
export const PRE_ENCODE_CACHE_SIZE = 9;
export const NEW_FRAMES_PER_CHUNK = N_FRAMES - PRE_ENCODE_CACHE_SIZE; // 56

// Task 11 fix1 round: raw-PCM lookback (history) buffer size, in samples,
// that NemotronEngine must carry across chunk boundaries so the leading
// PRE_ENCODE_CACHE_SIZE frames of computeMelFrame's output are REAL mel
// frames from the tail of the previous chunk's audio, not synthetic
// zero-padding (the do_pad:true/min_num_frames:65 approach every prior
// round used). Value = 11 * HOP_LENGTH = 1760 samples (110ms), determined by
// DIRECT MEASUREMENT (not a trusted formula — see the fix1 report's
// "measure_lookback" script and task-11-fix1-report.md's Part A section for
// the full methodology), by comparing a local (lookback+chunk) do_pad:false
// spectrogram() call against a single continuous do_pad:false spectrogram()
// call over the ENTIRE real WAV fixture (ground truth) at increasing
// lookback sizes until the leading 9 frames became bit-identical (max abs
// diff dropped from single-digit log-mel units at 10*HOP to ~1e-6 float
// noise at 11*HOP, and stayed there through 20*HOP — the empirically
// measured, not derived, minimum). The underlying reason (confirmed, not
// guessed): spectrogram()'s center:true/pad_mode:'constant' zero-pads
// floor(N_FFT/2)=256 samples at the START of WHATEVER buffer it's given;
// a local frame's own 512-sample STFT window only avoids that fake padding
// once its start offset is >= 256 samples into the local buffer, i.e. at
// local frame index >= 2 (2*HOP_LENGTH=320 >= 256) — combined with needing
// the first 9 of those "safe" frames as real context, this requires the
// context slice to start at local frame index (lookback_samples/HOP - 9),
// which must be >= 2, i.e. lookback_samples >= 11*HOP_LENGTH. Exactly
// matches the measured boundary (10*HOP still measurably wrong: max diff
// 3.57 log-mel units; 11*HOP already at float noise: ~1e-6).
export const LOOKBACK_SAMPLES = 11 * HOP_LENGTH; // 1760

// A DISTINCT, smaller residual finding from the same measurement (documented
// here rather than silently dropped, per this investigation's own
// discipline): the VERY LAST of a chunk's 56 "new" frames has a real,
// measured discrepancy (~0.5-1.3 log-mel units max-abs-diff) against the
// true whole-utterance ground truth, REGARDLESS of how much leading lookback
// is supplied — because that frame's 512-sample center:true STFT window
// genuinely extends ~96 samples PAST the raw chunk boundary into audio that
// has not arrived yet at chunk-processing time (confirmed by the real HF
// `transformers` streaming reference script quoted in task-11-fix1-report.md,
// which explicitly waits for a few hundred extra samples of true lookahead
// before processing each steady chunk, for exactly this reason). This is a
// genuine, separate, right-context/lookahead requirement, NOT fixed by this
// round's leading-history change, and NOT something Part A's brief asked for
// — named here and in the fix1 report as a real, measured, still-open,
// lower-priority finding. Its effect is a much smaller residual imprecision
// on 1 of 65 frames per chunk, vs. today's status quo of ALL 9 leading
// frames plus much of the tail alignment being wrong.

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

const EMPTY_LOOKBACK = new Float32Array(0);
// The exact real digital-silence floor value spectrogram() itself would
// produce for a frame of pure-zero audio: mel power = 0, then
// `mel_offset + max(mel_floor, 0)` = `LOG_EPS + max(0,0)` = `LOG_EPS`, then
// `log_mel:'log'` -> `Math.log(LOG_EPS)` — read directly out of
// @huggingface/transformers' own spectrogram() source (src/utils/audio.js)
// rather than re-derived, so the leading zero-pad frames used below (when
// there is no real previous-chunk history yet) are bit-identical to what the
// SAME pipeline would compute for genuine silence, matching the precedent
// task-11-debug1-report.md §5a already established for padding frames.
const SILENCE_FLOOR_VALUE = Math.log(LOG_EPS);

/**
 * Computes the encoder's fixed N_FRAMES (65) audio_signal input for one
 * chunk, using REAL cross-chunk mel-frame history for the leading
 * PRE_ENCODE_CACHE_SIZE (9) frames instead of synthetic zero-padding.
 *
 * `lookback` is raw PCM (not mel frames) — Task 11 fix1's brief required a
 * raw-PCM history buffer specifically because STFT windowing needs real
 * overlapping samples, not post-hoc-stitched mel frames from two separately
 * padded/windowed computations (stitching would NOT reproduce what one
 * continuous computation over the same audio produces, since center=true
 * padding happens per spectrogram() call). `lookback.length` MUST be a
 * multiple of HOP_LENGTH (NemotronEngine always passes either an empty
 * buffer or exactly LOOKBACK_SAMPLES, both HOP_LENGTH-aligned) — this keeps
 * frame boundaries between `lookback` and `chunk` exactly aligned with what
 * a single continuous whole-utterance computation would produce.
 *
 * Algorithm (measured and verified against a real whole-utterance ground
 * truth computation — see LOOKBACK_SAMPLES' comment and task-11-fix1-report.md):
 * 1. Run ONE continuous spectrogram() call over [lookback][chunk], with
 *    do_pad:false and no forced min/max_num_frames — every resulting frame
 *    is real (computed from real audio), never synthetic.
 * 2. Drop the single LAST frame of that result — its window measurably
 *    extends past the end of real available audio into spectrogram()'s own
 *    end-of-buffer zero padding (the same "spurious extra frame" that made
 *    an isolated CHUNK_SAMPLES-only computation yield 57 organic frames
 *    instead of the true 56 new-content frames per chunk — task-11-debug1-
 *    report.md §3b's own correction).
 * 3. Take up to the last N_FRAMES (65) of what remains. If lookback is
 *    empty (the very first chunk after reset()), fewer than 65 real frames
 *    are available (56, after step 2) — the missing leading positions are
 *    filled with the real silence-floor value, matching "no real history
 *    exists yet" exactly as the brief specifies, not an arbitrary zero.
 */
export async function computeMelFrame(chunk: Float32Array, lookback: Float32Array = EMPTY_LOOKBACK): Promise<Float32Array> {
  if (chunk.length !== CHUNK_SAMPLES) {
    throw new Error(`computeMelFrame expects exactly ${CHUNK_SAMPLES} samples, got ${chunk.length}`);
  }
  if (lookback.length % HOP_LENGTH !== 0) {
    throw new Error(`computeMelFrame's lookback must be a multiple of HOP_LENGTH (${HOP_LENGTH}), got ${lookback.length}`);
  }
  await ensureInitialized();
  const combined = new Float32Array(lookback.length + chunk.length);
  combined.set(lookback, 0);
  combined.set(chunk, lookback.length);
  // frame_length: N_FFT (512), not WINDOW_LENGTH (400) — see fftWindow's
  // construction above (this library requires window.length === frame_length,
  // and fftWindow is already pre-padded to N_FFT to center the real 400-tap
  // Hann window within it, matching torch.stft's convention).
  const tensor = await spectrogramFn!(combined, fftWindow!, N_FFT, HOP_LENGTH, {
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
    // Task 11 fix1 round: NO min/max_num_frames, do_pad:false — every frame
    // computed here is real. The old N_FRAMES-forcing (min/max_num_frames:65,
    // do_pad:true) baked synthetic trailing zero frames into audio_signal;
    // that is exactly the bug this round fixes. See the function doc comment
    // above for how the real 65-frame array is now assembled instead.
    do_pad: false,
    // transpose: true → shape (n_frames, n_mels), matching the encoder's real
    // audio_signal shape [1, 65, 128] (time-major, mel-minor). The default
    // (transpose: false, mel-major) does NOT match — verified against Task
    // 1's recorded inputMetadata, not assumed.
    transpose: true,
  });

  const total = tensor.dims[0] as number;
  const data = tensor.data as Float32Array;
  // Step 2 above: drop the single spurious trailing frame.
  const usableTotal = total - 1;
  const sliceStart = Math.max(0, usableTotal - N_FRAMES);
  const numReal = usableTotal - sliceStart;
  const numZeroPad = N_FRAMES - numReal;

  const out = new Float32Array(N_FRAMES * N_MELS);
  if (numZeroPad > 0) {
    out.fill(SILENCE_FLOOR_VALUE, 0, numZeroPad * N_MELS);
  }
  out.set(data.subarray(sliceStart * N_MELS, (sliceStart + numReal) * N_MELS), numZeroPad * N_MELS);
  return out;
}
