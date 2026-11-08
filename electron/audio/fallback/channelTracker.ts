// TypeScript port of native-module/src/channel_state.rs for the renderer capture
// fallback: one tracker shared by the fallback mic and system monitors, turning
// per-channel speech edges into the joint 'speech_edge' payload the wrappers
// normalise with speechEdge.ts. The fallback mic is RMS-only, so its user edges
// are reported as not VAD-backed, as on the native Windows path.

export type FallbackChannel = 'interviewer' | 'user';

export interface FallbackSpeechEdgeEvent {
  channel: FallbackChannel;
  speaking: boolean;
  joint: 'neither' | 'interviewer_speaking' | 'user_speaking' | 'both';
  atMs: number;
  msSinceOtherEdge: number;
  userEdgesVadBacked: boolean;
}

export class ChannelTracker {
  private speaking: Record<FallbackChannel, boolean> = { interviewer: false, user: false };
  private lastEdge: Record<FallbackChannel, number | null> = { interviewer: null, user: null };

  constructor(private readonly userEdgesVadBacked: boolean) {}

  onEdge(channel: FallbackChannel, speaking: boolean, nowMs: number): FallbackSpeechEdgeEvent | null {
    if (this.speaking[channel] === speaking) return null;
    this.speaking[channel] = speaking;
    this.lastEdge[channel] = nowMs;
    const other = this.lastEdge[channel === 'user' ? 'interviewer' : 'user'];
    const i = this.speaking.interviewer;
    const u = this.speaking.user;
    return {
      channel,
      speaking,
      joint: i && u ? 'both' : i ? 'interviewer_speaking' : u ? 'user_speaking' : 'neither',
      atMs: nowMs,
      msSinceOtherEdge: other === null ? -1 : Math.max(0, nowMs - other),
      userEdgesVadBacked: this.userEdgesVadBacked,
    };
  }
}

// On globalThis for the reason captureHost.ts gives: the mic and system
// wrappers are bundled apart, and both channels must share one tracker.
const TRACKER_KEY = Symbol.for('natively.audioFallback.channelTracker');
type TrackerGlobal = { [TRACKER_KEY]?: ChannelTracker };

export function sharedFallbackTracker(): ChannelTracker {
  const g = globalThis as TrackerGlobal;
  g[TRACKER_KEY] ??= new ChannelTracker(false);
  return g[TRACKER_KEY];
}
