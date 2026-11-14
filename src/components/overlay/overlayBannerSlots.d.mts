export type OverlayBannerId =
  | 'audio-error'
  | 'stt-error'
  | 'stt-not-configured'
  | 'audio-stuck'
  | 'stt-warning'
  | 'ambient-mic'
  | 'trial'
  | 'auto-answer-access'
  | 'auto-stop'
  | 'last-time'
  | 'capture-fallback'
  | 'refusal-retry'
  | 'stealth-permission'
  | 'hotkey-conflict'
  | 'audio-advisory';

export const OVERLAY_BANNER_CAP: number;
export const OVERLAY_BANNER_PRIORITY: readonly OverlayBannerId[];
export function pickOverlayBanners(wanted: Partial<Record<OverlayBannerId, boolean>>, cap?: number): Set<OverlayBannerId>;
export function audioBannerId(severity: 0 | 1 | 2 | 3, standsInForStop?: boolean): 'audio-error' | 'audio-stuck' | 'audio-advisory';
