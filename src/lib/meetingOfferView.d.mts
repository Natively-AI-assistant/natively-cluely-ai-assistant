export interface MeetingOfferLike {
    id: string;
    title: string | null;
    app: string;
    body: string;
    autoStartAt: number | null;
}
export function offerHeadline(offer: MeetingOfferLike): string;
export function offerSecondsLeft(offer: MeetingOfferLike | null | undefined, nowMs: number): number | null;
