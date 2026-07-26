import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type MeetingRecordingChannel = 'system' | 'mic';

export interface MeetingAudioRecordingMetadata {
  path: string;
  format: 'wav';
  sampleRate: number;
  sizeBytes: number;
  durationMs: number;
}

interface ChannelState {
  tempPath: string;
  stream: fs.WriteStream;
  error: Error | null;
  nextSampleIndex: number;
  bytesWritten: number;
  discarded: boolean;
}

export const MEETING_RECORDING_SAMPLE_RATE = 24_000;
const PCM_BYTES_PER_SAMPLE = 2;
const MIX_CHUNK_BYTES = 64 * 1024;
const DELIVERY_JITTER_TOLERANCE_MS = 100;
const MAX_PENDING_WRITE_BYTES = 4 * 1024 * 1024;
const SAFE_MEETING_ID = /^[A-Za-z0-9_-]{1,128}$/;

const clampInt16 = (value: number): number => {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return Math.round(value);
};

export function resamplePcm16Mono(
  input: Buffer,
  inputSampleRate: number,
  outputSampleRate: number = MEETING_RECORDING_SAMPLE_RATE,
): Buffer {
  if (input.length === 0) return Buffer.alloc(0);
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error(`Invalid input sample rate: ${inputSampleRate}`);
  }

  const inputSamples = Math.floor(input.length / PCM_BYTES_PER_SAMPLE);
  if (inputSamples === 0) return Buffer.alloc(0);
  if (inputSampleRate === outputSampleRate) {
    return Buffer.from(input.subarray(0, inputSamples * PCM_BYTES_PER_SAMPLE));
  }

  const outputSamples = Math.max(1, Math.round(inputSamples * outputSampleRate / inputSampleRate));
  const output = Buffer.allocUnsafe(outputSamples * PCM_BYTES_PER_SAMPLE);
  const ratio = inputSampleRate / outputSampleRate;

  for (let i = 0; i < outputSamples; i++) {
    const sourceIndex = i * ratio;
    const i0 = Math.min(inputSamples - 1, Math.floor(sourceIndex));
    const i1 = Math.min(inputSamples - 1, i0 + 1);
    const frac = sourceIndex - i0;
    const s0 = input.readInt16LE(i0 * PCM_BYTES_PER_SAMPLE);
    const s1 = input.readInt16LE(i1 * PCM_BYTES_PER_SAMPLE);
    output.writeInt16LE(clampInt16(s0 + (s1 - s0) * frac), i * PCM_BYTES_PER_SAMPLE);
  }

  return output;
}

export function alignPcm16Chunk(
  chunk: Buffer,
  desiredStartSample: number,
  nextSampleIndex: number,
): { output: Buffer; nextSampleIndex: number; paddingSamples: number; trimmedSamples: number } {
  const chunkSamples = Math.floor(chunk.length / PCM_BYTES_PER_SAMPLE);
  const safeDesiredStart = Math.max(0, desiredStartSample);
  const safeNext = Math.max(0, nextSampleIndex);

  if (chunkSamples === 0) {
    return { output: Buffer.alloc(0), nextSampleIndex: safeNext, paddingSamples: 0, trimmedSamples: 0 };
  }

  let trimmedSamples = 0;
  let chunkStartByte = 0;
  if (safeDesiredStart < safeNext) {
    trimmedSamples = Math.min(chunkSamples, safeNext - safeDesiredStart);
    chunkStartByte = trimmedSamples * PCM_BYTES_PER_SAMPLE;
  }

  const remaining = chunk.subarray(chunkStartByte, chunkSamples * PCM_BYTES_PER_SAMPLE);
  const effectiveStart = Math.max(safeDesiredStart, safeNext);
  const paddingSamples = Math.max(0, effectiveStart - safeNext);
  const padding = paddingSamples > 0 ? Buffer.alloc(paddingSamples * PCM_BYTES_PER_SAMPLE) : Buffer.alloc(0);
  const output = padding.length > 0 ? Buffer.concat([padding, remaining]) : Buffer.from(remaining);

  return {
    output,
    nextSampleIndex: safeNext + Math.floor(output.length / PCM_BYTES_PER_SAMPLE),
    paddingSamples,
    trimmedSamples,
  };
}

export function mixPcm16Mono(systemPcm?: Buffer | null, micPcm?: Buffer | null): Buffer {
  const systemSamples = systemPcm ? Math.floor(systemPcm.length / PCM_BYTES_PER_SAMPLE) : 0;
  const micSamples = micPcm ? Math.floor(micPcm.length / PCM_BYTES_PER_SAMPLE) : 0;
  const outputSamples = Math.max(systemSamples, micSamples);
  const output = Buffer.alloc(outputSamples * PCM_BYTES_PER_SAMPLE);

  for (let i = 0; i < outputSamples; i++) {
    const systemSample = systemPcm && i < systemSamples ? systemPcm.readInt16LE(i * PCM_BYTES_PER_SAMPLE) : 0;
    const micSample = micPcm && i < micSamples ? micPcm.readInt16LE(i * PCM_BYTES_PER_SAMPLE) : 0;
    const activeChannels = (i < systemSamples ? 1 : 0) + (i < micSamples ? 1 : 0);
    const gain = activeChannels > 1 ? 0.5 : 1;
    output.writeInt16LE(clampInt16((systemSample + micSample) * gain), i * PCM_BYTES_PER_SAMPLE);
  }

  return output;
}

export function createWavHeader(
  pcmDataBytes: number,
  sampleRate: number = MEETING_RECORDING_SAMPLE_RATE,
  channels: number = 1,
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * PCM_BYTES_PER_SAMPLE;
  const blockAlign = channels * PCM_BYTES_PER_SAMPLE;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmDataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmDataBytes, 40);

  return header;
}

export class AudioMeetingRecorder {
  private readonly recordingsDir: string;
  private readonly tempDir: string;
  private readonly outputSampleRate: number;
  private startTimeMs = 0;
  private active = false;
  private finalizing = false;
  private channels: Record<MeetingRecordingChannel, ChannelState> | null = null;

  constructor(userDataPath: string, outputSampleRate: number = MEETING_RECORDING_SAMPLE_RATE) {
    this.recordingsDir = path.join(userDataPath, 'recordings');
    this.tempDir = path.join(this.recordingsDir, '.tmp');
    this.outputSampleRate = outputSampleRate;
  }

  public start(startTimeMs: number = Date.now()): void {
    this.discard();
    fs.mkdirSync(this.tempDir, { recursive: true });
    const sessionId = crypto.randomUUID();
    this.startTimeMs = startTimeMs;
    this.active = true;
    this.finalizing = false;
    this.channels = {
      system: this.createChannelState(sessionId, 'system'),
      mic: this.createChannelState(sessionId, 'mic'),
    };
    console.log(`[AudioMeetingRecorder] Started temp recording session ${sessionId}`);
  }

  public addChunk(
    channel: MeetingRecordingChannel,
    chunk: Buffer,
    inputSampleRate: number,
    capturedAtMs: number = Date.now(),
  ): void {
    if (!this.active || this.finalizing || !this.channels) return;
    const state = this.channels[channel];
    if (state.error || chunk.length === 0) return;

    try {
      const resampled = resamplePcm16Mono(chunk, inputSampleRate, this.outputSampleRate);
      if (resampled.length === 0) return;

      const offsetMs = Math.max(0, capturedAtMs - this.startTimeMs);
      const clockStartSample = Math.round(offsetMs * this.outputSampleRate / 1000);
      const gapSamples = clockStartSample - state.nextSampleIndex;
      const gapThresholdSamples = Math.round(DELIVERY_JITTER_TOLERANCE_MS * this.outputSampleRate / 1000);
      const desiredStartSample = state.nextSampleIndex === 0 || gapSamples > gapThresholdSamples
        ? Math.max(state.nextSampleIndex, clockStartSample)
        : state.nextSampleIndex;
      const aligned = alignPcm16Chunk(resampled, desiredStartSample, state.nextSampleIndex);
      if (aligned.output.length === 0) {
        state.nextSampleIndex = aligned.nextSampleIndex;
        return;
      }

      if (state.stream.writableLength + aligned.output.length > MAX_PENDING_WRITE_BYTES) {
        throw new Error(`Recording write buffer exceeded ${MAX_PENDING_WRITE_BYTES} bytes`);
      }
      state.stream.write(aligned.output);
      state.nextSampleIndex = aligned.nextSampleIndex;
      state.bytesWritten += aligned.output.length;
    } catch (error) {
      state.error = error instanceof Error ? error : new Error(String(error));
      console.error(`[AudioMeetingRecorder] Failed to append ${channel} chunk:`, error);
    }
  }

  public async finalize(meetingId: string): Promise<MeetingAudioRecordingMetadata | null> {
    if (!this.channels || this.finalizing) return null;
    if (!SAFE_MEETING_ID.test(meetingId)) {
      this.discard();
      console.error('[AudioMeetingRecorder] Refusing unsafe meeting ID for recording filename');
      return null;
    }
    this.active = false;
    this.finalizing = true;

    const channels = this.channels;
    this.channels = null;
    let pendingPath: string | null = null;
    let mixedTempPath: string | null = null;

    try {
      const closeResults = await Promise.allSettled(Object.values(channels).map((state) => this.closeStream(state)));
      const closeFailure = closeResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (closeFailure) throw closeFailure.reason;
      const failedChannel = Object.values(channels).find((state) => state.error);
      if (failedChannel?.error) throw failedChannel.error;
      if (!Object.values(channels).some((state) => state.bytesWritten > 0)) {
        await this.cleanupChannelTemps(channels);
        return null;
      }

      fs.mkdirSync(this.recordingsDir, { recursive: true });
      const recordingId = crypto.randomUUID();
      pendingPath = path.join(this.recordingsDir, `${meetingId}-${recordingId}.publish-pending.wav`);
      mixedTempPath = path.join(this.tempDir, `${recordingId}-mixed.wav`);
      const mixedPcmBytes = await this.mixChannelsToWav(channels, mixedTempPath);
      if (mixedPcmBytes === 0) {
        await this.cleanupChannelTemps(channels);
        return null;
      }

      // Move the completed WAV into a recoverable publication state before it
      // is associated with SQLite. The meeting ID and random recording ID in
      // this filename let startup repair a crash between this rename and the
      // database update without treating the complete audio as an orphan.
      await fs.promises.rename(mixedTempPath, pendingPath);
      mixedTempPath = null;
      await this.cleanupChannelTemps(channels);
      const stat = await fs.promises.stat(pendingPath);
      const durationMs = Math.round((mixedPcmBytes / PCM_BYTES_PER_SAMPLE) * 1000 / this.outputSampleRate);
      console.log('[AudioMeetingRecorder] Prepared mixed meeting recording for durable publication');
      return {
        path: pendingPath,
        format: 'wav',
        sampleRate: this.outputSampleRate,
        sizeBytes: stat.size,
        durationMs,
      };
    } catch (error) {
      console.error('[AudioMeetingRecorder] Failed to finalize recording:', error);
      if (pendingPath) {
        await fs.promises.unlink(pendingPath).catch(() => {});
      }
      if (mixedTempPath) {
        await fs.promises.unlink(mixedTempPath).catch(() => {});
      }
      await this.cleanupChannelTemps(channels).catch(() => {});
      return null;
    } finally {
      this.finalizing = false;
      this.startTimeMs = 0;
    }
  }

  public discard(): void {
    if (!this.channels) {
      this.active = false;
      this.finalizing = false;
      this.startTimeMs = 0;
      return;
    }

    const channels = this.channels;
    this.channels = null;
    this.active = false;
    this.finalizing = false;
    this.startTimeMs = 0;

    for (const state of Object.values(channels)) {
      state.discarded = true;
      const cleanup = () => {
        fs.promises.unlink(state.tempPath).catch((error: any) => {
          if (error?.code !== 'ENOENT') {
            console.error('[AudioMeetingRecorder] Failed to discard temp recording:', error);
          }
        });
      };
      if (!state.stream.closed) state.stream.once('close', cleanup);
      try { state.stream.destroy(); } catch {}
      cleanup();
    }
  }

  private createChannelState(sessionId: string, channel: MeetingRecordingChannel): ChannelState {
    const tempPath = path.join(this.tempDir, `${sessionId}-${channel}.pcm`);
    const stream = fs.createWriteStream(tempPath, { flags: 'w', mode: 0o600 });
    const state: ChannelState = { tempPath, stream, error: null, nextSampleIndex: 0, bytesWritten: 0, discarded: false };
    stream.on('error', (error) => {
      state.error = error;
      if (!state.discarded) {
        console.error(`[AudioMeetingRecorder] ${channel} recording stream failed:`, error);
      }
    });
    return state;
  }

  private closeStream(state: ChannelState): Promise<void> {
    const stream = state.stream;
    if (state.error) {
      if (stream.closed) return Promise.reject(state.error);
      const error = state.error;
      return new Promise((_resolve, reject) => {
        stream.once('close', () => reject(error));
        stream.destroy();
      });
    }
    if (stream.writableFinished || stream.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        stream.removeListener('error', onError);
        stream.removeListener('finish', onFinish);
      };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onFinish = () => { cleanup(); state.error ? reject(state.error) : resolve(); };
      stream.once('error', onError);
      stream.once('finish', onFinish);
      stream.end();
    });
  }

  private async mixChannelsToWav(
    channels: Record<MeetingRecordingChannel, ChannelState>,
    finalPath: string,
  ): Promise<number> {
    const outputBytes = Math.max(channels.system.bytesWritten, channels.mic.bytesWritten);
    if (outputBytes === 0) return 0;
    if (outputBytes > 0xffffffff - 36) throw new Error('Meeting recording exceeds the WAV file size limit');

    const [systemFile, micFile, outputFile] = await Promise.all([
      channels.system.bytesWritten > 0 ? fs.promises.open(channels.system.tempPath, 'r') : null,
      channels.mic.bytesWritten > 0 ? fs.promises.open(channels.mic.tempPath, 'r') : null,
      fs.promises.open(finalPath, 'w', 0o600),
    ]);

    try {
      await this.writeAll(outputFile, createWavHeader(outputBytes, this.outputSampleRate, 1), 0);
      for (let offset = 0; offset < outputBytes; offset += MIX_CHUNK_BYTES) {
        const chunkBytes = Math.min(MIX_CHUNK_BYTES, outputBytes - offset);
        const [systemPcm, micPcm] = await Promise.all([
          this.readPcmChunk(systemFile, channels.system.bytesWritten, offset, chunkBytes),
          this.readPcmChunk(micFile, channels.mic.bytesWritten, offset, chunkBytes),
        ]);
        await this.writeAll(outputFile, mixPcm16Mono(systemPcm, micPcm), 44 + offset);
      }
    } finally {
      await Promise.all([systemFile?.close(), micFile?.close(), outputFile.close()]);
    }

    return outputBytes;
  }

  private async readPcmChunk(
    file: fs.promises.FileHandle | null,
    totalBytes: number,
    offset: number,
    requestedBytes: number,
  ): Promise<Buffer | null> {
    const bytesToRead = Math.min(requestedBytes, Math.max(0, totalBytes - offset));
    if (!file || bytesToRead === 0) return null;
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, offset);
    const evenBytesRead = bytesRead - (bytesRead % PCM_BYTES_PER_SAMPLE);
    return evenBytesRead > 0 ? buffer.subarray(0, evenBytesRead) : null;
  }

  private async writeAll(file: fs.promises.FileHandle, buffer: Buffer, position: number): Promise<void> {
    let written = 0;
    while (written < buffer.length) {
      const result = await file.write(buffer, written, buffer.length - written, position + written);
      if (result.bytesWritten <= 0) throw new Error('Failed to write meeting recording');
      written += result.bytesWritten;
    }
  }

  private async cleanupChannelTemps(channels: Record<MeetingRecordingChannel, ChannelState>): Promise<void> {
    await Promise.all(Object.values(channels).map(async (state) => {
      try { await fs.promises.unlink(state.tempPath); } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }));
  }
}
