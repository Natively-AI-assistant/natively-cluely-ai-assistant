export type CornerNoticeId = 'meeting_offer' | 'update' | 'quota' | 'trial_meter' | 'hindsight' | 'provider_notice';

export interface CornerSlot {
  request(id: CornerNoticeId): void;
  release(id: CornerNoticeId): void;
  holder(): CornerNoticeId | null;
  subscribe(listener: () => void): () => void;
}

export declare const CORNER_PRIORITY: readonly CornerNoticeId[];
export function createCornerSlot(order?: readonly CornerNoticeId[]): CornerSlot;
export declare const cornerSlot: CornerSlot;
