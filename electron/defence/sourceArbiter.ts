import type { DefenceConfig } from './config';
import type { WindowsAudioSegment, WindowsAudioSourceType } from './windowsAudioCapture';

export type SourceDecisionReason = 'allowed' | 'scenario-disabled' | 'process-priority' | 'echo-duplicate' | 'local-user-speech' | 'transcript-duplicate';
export interface SourceDecision { allowStt: boolean; allowQuestion: boolean; reason: SourceDecisionReason; echoDuplicateSuppressed?: boolean; userAnswerSuppressed?: boolean }

interface RecentRemote { segment: WindowsAudioSegment; transcript?: string }

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function transcriptSimilarity(left: string, right: string): number {
  const a = [...normalizedText(left)]; const b = [...normalizedText(right)];
  if (!a.length || !b.length) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

export function audioFingerprintSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length < 3 || right.length < 3) return 0;
  const count = Math.min(64, Math.max(8, Math.min(left.length, right.length)));
  const resample = (values: readonly number[]) => Array.from({ length: count }, (_, index) => values[Math.min(values.length - 1, Math.floor(index * values.length / count))]);
  const a = resample(left); const b = resample(right);
  let dot = 0; let normA = 0; let normB = 0;
  for (let index = 0; index < count; index++) { const x = a[index]; const y = b[index]; dot += x * y; normA += x * x; normB += y * y; }
  return normA > 0 && normB > 0 ? Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB))) : 0;
}

/**
 * Arbitrates independent process-loopback and microphone streams before STT.
 * It never mixes PCM and keeps process audio authoritative when both clocks
 * report activity in the configured overlap window.
 */
export class SourceArbiter {
  private scenario: DefenceConfig['input']['scenario'];
  private recentRemote: RecentRemote[] = [];
  private counters = { echoDuplicatesSuppressed: 0, localUserSpeechSuppressed: 0, processSttRequests: 0, microphoneSttRequests: 0 };

  constructor(private config: DefenceConfig['input']) { this.scenario = config.scenario; }

  setScenario(scenario: DefenceConfig['input']['scenario']): void { this.scenario = scenario; }
  getScenario(): DefenceConfig['input']['scenario'] { return this.scenario; }

  decideAudio(segment: WindowsAudioSegment, final: boolean): SourceDecision {
    this.prune(segment.qpcEndMs);
    if (segment.sourceType === 'remote-process') {
      this.recentRemote.push({ segment });
      if (this.scenario === 'in-person-defence') return { allowStt: false, allowQuestion: false, reason: 'scenario-disabled' };
      this.counters.processSttRequests++;
      return { allowStt: true, allowQuestion: true, reason: 'allowed' };
    }

    const overlapping = this.recentRemote.filter(item => this.overlaps(item.segment, segment));
    const echo = overlapping.some(item => audioFingerprintSimilarity(item.segment.energyFingerprint, segment.energyFingerprint) >= 0.72);
    if (echo) {
      this.counters.echoDuplicatesSuppressed++;
      return { allowStt: false, allowQuestion: false, reason: 'echo-duplicate', echoDuplicateSuppressed: true };
    }
    if (this.scenario === 'remote-interview') {
      this.counters.localUserSpeechSuppressed++;
      return { allowStt: false, allowQuestion: false, reason: 'local-user-speech', userAnswerSuppressed: true };
    }
    if (this.scenario === 'hybrid' && overlapping.length) return { allowStt: false, allowQuestion: false, reason: 'process-priority' };
    this.counters.microphoneSttRequests++;
    return { allowStt: true, allowQuestion: true, reason: 'allowed' };
  }

  rememberTranscript(sourceType: WindowsAudioSourceType, segment: WindowsAudioSegment, transcript: string): SourceDecision {
    if (sourceType === 'remote-process') {
      const entry = [...this.recentRemote].reverse().find(item => item.segment.sourceId === segment.sourceId && item.segment.qpcEndMs === segment.qpcEndMs);
      if (entry) entry.transcript = transcript;
      return { allowStt: true, allowQuestion: this.scenario !== 'in-person-defence', reason: 'allowed' };
    }
    const duplicate = this.recentRemote.some(item => item.transcript && this.overlaps(item.segment, segment)
      && transcriptSimilarity(item.transcript, transcript) >= this.config.dualSource.transcriptSimilarity);
    if (duplicate) {
      this.counters.echoDuplicatesSuppressed++;
      return { allowStt: true, allowQuestion: false, reason: 'transcript-duplicate', echoDuplicateSuppressed: true };
    }
    return { allowStt: true, allowQuestion: this.scenario !== 'remote-interview', reason: 'allowed' };
  }

  getDiagnostics(): Readonly<typeof this.counters> { return { ...this.counters }; }

  private overlaps(remote: WindowsAudioSegment, microphone: WindowsAudioSegment): boolean {
    const window = this.config.dualSource.overlapWindowMs;
    return microphone.qpcStartMs <= remote.qpcEndMs + window && microphone.qpcEndMs >= remote.qpcStartMs - window;
  }
  private prune(now: number): void { const cutoff = now - Math.max(5_000, this.config.dualSource.overlapWindowMs * 4); this.recentRemote = this.recentRemote.filter(item => item.segment.qpcEndMs >= cutoff); }
}
