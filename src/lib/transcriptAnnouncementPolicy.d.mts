export type TranscriptAnnouncementSpeaker = 'interviewer' | 'user';
export type TranscriptAnnouncementChannelStatus =
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'awaiting-audio';

export interface TranscriptAnnouncementChannel {
  status: TranscriptAnnouncementChannelStatus;
  error?: string;
  provider?: string;
}

export interface TranscriptAnnouncementFinal {
  id: string;
  speaker: TranscriptAnnouncementSpeaker;
  text: string;
}

export interface TranscriptAnnouncementInput {
  resetKey: number;
  finals: TranscriptAnnouncementFinal[];
  channels: Record<
    TranscriptAnnouncementSpeaker,
    TranscriptAnnouncementChannel
  >;
  activePartialSpeakers: readonly TranscriptAnnouncementSpeaker[];
}

export interface TranscriptAnnouncementState {
  resetKey: number;
  initialized: boolean;
  channelSignatures: Record<TranscriptAnnouncementSpeaker, string>;
  knownFinalIds: string[];
  activePartialSpeakerSignature: string;
  text: string;
  revision: number;
}

export declare const TRANSCRIPT_SPEAKER_LABELS: Readonly<
  Record<TranscriptAnnouncementSpeaker, string>
>;

export declare const TRANSCRIPT_STATUS_LABELS: Readonly<
  Record<TranscriptAnnouncementChannelStatus, string>
>;

export declare function createTranscriptAnnouncementState(
  resetKey?: number,
): TranscriptAnnouncementState;

export declare function reduceTranscriptAnnouncement(
  state: TranscriptAnnouncementState,
  input: TranscriptAnnouncementInput,
): TranscriptAnnouncementState;
