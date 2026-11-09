export interface AudioWarning {
  kind: 'screen-recording-permission' | 'audio-capture-failure';
  message: string;
  channel?: 'system' | 'mic';
  titleKey?: string;
  terminal?: boolean;
  stuck?: boolean;
  /** false: real audio on the channel says nothing about this warning. */
  clearsOnRecovery?: boolean;
}

export type HeldAudioWarning<W extends AudioWarning = AudioWarning> = W & { at: number };

export interface AudioWarningState<W extends AudioWarning = AudioWarning> {
  slots: { mic?: HeldAudioWarning<W>; system?: HeldAudioWarning<W> };
  seq: number;
  advisories: readonly string[];
}

export const EMPTY_AUDIO_WARNINGS: AudioWarningState<any>;
export function audioWarningSeverity(w: AudioWarning | null | undefined): 0 | 1 | 2 | 3;
export function offerAudioWarning<W extends AudioWarning>(state: AudioWarningState<W>, w: W): AudioWarningState<W>;
export function shownAudioWarning<W extends AudioWarning>(state: AudioWarningState<W>): HeldAudioWarning<W> | null;
export function clearAudioWarning<W extends AudioWarning>(
  state: AudioWarningState<W>,
  channel: 'mic' | 'system',
  matches?: (w: W) => boolean,
): AudioWarningState<W>;
export function dismissShownAudioWarning<W extends AudioWarning>(state: AudioWarningState<W>): AudioWarningState<W>;
export function resetAudioWarnings(): AudioWarningState<any>;
