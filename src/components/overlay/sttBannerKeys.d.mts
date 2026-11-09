export type SttChannelStatus = 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio' | 'preparing';
export function sttStoppedKey(user: SttChannelStatus, interviewer: SttChannelStatus): string;
export function sttReconnectingKey(user: SttChannelStatus, interviewer: SttChannelStatus): string;
export function forgetSettledSttOutages(dismissed: readonly string[], user: SttChannelStatus, interviewer: SttChannelStatus): readonly string[];
