export type AudioWarningAction =
  | { type: 'external'; url: string; pane: 'microphone' | 'screen' }
  | { type: 'mic-privacy' }
  | { type: 'settings-tab'; tab: 'audio' };

export function audioWarningAction(w: {
  platform: string;
  kind: string;
  channel?: string;
  titleKey?: string;
  message?: string;
}): AudioWarningAction;
