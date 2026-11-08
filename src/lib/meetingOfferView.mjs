// What the launcher's "meeting detected" notice shows for an offer from main
// (electron/services/meetingDetection/meetingOffer.ts). Pure, for the tests.

/** The calendar event's title when one is on, else "<App> call". */
export function offerHeadline(offer) {
    const title = typeof offer?.title === 'string' ? offer.title.trim() : '';
    if (title) return title;
    return `${offer?.app || 'Meeting'} call`;
}

/** Whole seconds until the automatic start (never below 0), or null when it is off. */
export function offerSecondsLeft(offer, nowMs) {
    if (!offer || typeof offer.autoStartAt !== 'number') return null;
    return Math.max(0, Math.ceil((offer.autoStartAt - nowMs) / 1000));
}
