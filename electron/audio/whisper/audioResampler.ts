/**
 * Converts a Buffer containing Int16LE PCM samples at any input sample rate
 * to a Float32Array at 16 kHz using linear interpolation.
 * No external dependencies required.
 */
export function resampleToF32(chunk: Buffer, inputSampleRate: number): Float32Array {
  const TARGET_RATE = 16000;

  // Parse Int16LE samples from the buffer
  // 2 bytes per Int16 sample. Capture always delivers whole samples; a stray
  // trailing byte is ignored rather than making the length fractional, which
  // would throw out of the caller's audio callback.
  const inputSamples = Math.floor(chunk.byteLength / 2);
  const input = new Float32Array(inputSamples);
  for (let i = 0; i < inputSamples; i++) {
    // Normalize Int16 to [-1, 1]
    input[i] = chunk.readInt16LE(i * 2) / 32768.0;
  }

  if (inputSampleRate === TARGET_RATE) {
    return input;
  }

  const ratio = inputSampleRate / TARGET_RATE;
  const outputLength = Math.round(inputSamples / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = input[srcIdx] ?? 0;
    const s1 = input[srcIdx + 1] ?? s0;
    output[i] = s0 + frac * (s1 - s0);
  }

  return output;
}

/**
 * Raises a quiet segment to a 0.5 peak (never lowers one; at most 30x).
 * Moonshine reads the raw waveform and Whisper's log-mel features carry the
 * level too, so a -30 dB voice is heard worse than the same voice at normal
 * level (2026-11-18, Moonshine Tiny one-pass, quiet JFK: 1 word wrong at
 * -30 dB, none at the restored level). The cap keeps the noise that clears the
 * VAD from being raised into something that looks like speech.
 */
export function normalizeGain(audio: Float32Array, targetPeak = 0.5, maxGain = 30): Float32Array {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const a = Math.abs(audio[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0 || peak >= targetPeak) return audio;
  const gain = Math.min(maxGain, targetPeak / peak);
  const out = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) out[i] = audio[i] * gain;
  return out;
}
