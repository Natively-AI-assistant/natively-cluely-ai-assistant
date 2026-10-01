// src/lib/cards/outcomeLatch.mjs
//
// One showing, one outcome (toaster policy Phase 2). A card can fire several
// callbacks while it closes — a primary action and then the component's own
// close — so only the first definite outcome of a showing reaches the card
// ledger. A showing that ends with no outcome (the app took the card away,
// e.g. the Trial ended card opened) records nothing: an interruption is not a
// strike.

/**
 * @param {(card: string, outcome: string, meta?: object) => void} record
 */
export function createShowingRecorder(record) {
  let card = null;
  let settled = true;
  return {
    /** A card became the active one: record the showing once. */
    start(nextCard) {
      if (card === nextCard && !settled) return;
      card = nextCard;
      settled = false;
      record(nextCard, 'shown');
    },
    /** The first definite outcome of the current showing; later ones are ignored. */
    outcome(outcome, meta) {
      if (card === null || settled) return;
      settled = true;
      if (meta) record(card, outcome, meta);
      else record(card, outcome);
    },
    /** The showing ended (unmounted) without an outcome: nothing is recorded. */
    end() {
      settled = true;
    },
  };
}
