/**
 * Converts a Buffer containing Int16LE PCM samples at any input sample rate
 * to a Float32Array at 16 kHz using linear interpolation.
 * No external dependencies required.
 */
export function resampleToF32(chunk: Buffer, inputSampleRate: number): Float32Array {
  const TARGET_RATE = 16000;

  // Parse Int16LE samples from the buffer
  const inputSamples = chunk.byteLength / 2; // 2 bytes per Int16 sample
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
