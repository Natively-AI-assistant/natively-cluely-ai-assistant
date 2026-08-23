/**
 * Joint dual-channel speech transition from the native tracker
 * (native-module/src/channel_state.rs), re-emitted by SystemAudioCapture and
 * MicrophoneCapture as the 'speech_edge' event. Mirrors napi's SpeechEdgeEvent.
 */
export type SpeechEdgeChannel = 'interviewer' | 'user';
export type JointSpeechState = 'neither' | 'interviewer_speaking' | 'user_speaking' | 'both';

export interface SpeechEdge {
    channel: SpeechEdgeChannel;
    speaking: boolean;
    joint: JointSpeechState;
    /** Epoch ms — the Date.now() timeline AppState stamps transcripts with. */
    atMs: number;
    /** ms since the OTHER channel's last edge; -1 when it has none yet. */
    msSinceOtherEdge: number;
    /** false on Windows (mic is RMS-only): user edges are weaker evidence. */
    userEdgesVadBacked: boolean;
}

/** Defensive normalisation of the napi payload (never throws on a malformed object). */
export function normalizeSpeechEdge(raw: any): SpeechEdge | null {
    if (!raw || typeof raw !== 'object') return null;
    const channel = raw.channel === 'user' ? 'user' : raw.channel === 'interviewer' ? 'interviewer' : null;
    if (!channel) return null;
    const joint: JointSpeechState =
        raw.joint === 'both' || raw.joint === 'user_speaking' || raw.joint === 'interviewer_speaking' ? raw.joint : 'neither';
    return {
        channel,
        speaking: Boolean(raw.speaking),
        joint,
        atMs: Number.isFinite(raw.atMs) ? Number(raw.atMs) : Date.now(),
        msSinceOtherEdge: Number.isFinite(raw.msSinceOtherEdge) ? Number(raw.msSinceOtherEdge) : -1,
        userEdgesVadBacked: raw.userEdgesVadBacked !== false,
    };
}
