// electron/llm/smallTalk.ts
//
// Is this line ONLY small talk or call logistics? ("How are you doing today,
// did you find the place okay?", "Can you hear me okay?", "Shall we get
// started?")
//
// Used to skip the answer generations that start BEFORE anyone has decided the
// line needs an answer: the interim speculation and the Auto Answer prefetch.
// The replay (pipeline forensics 2026-11-13, F-LAT-08, P2-s04) spent four
// answer-sized calls on that opening pleasantry and showed none of them. The
// judge still rules on the line; if it says answer, the answer simply starts
// without the head start, which costs nothing on a two-word reply.
//
// Deliberately narrow: EVERY sentence has to be small talk. A line that also
// carries a real ask ("Can you hear me? Great, tell me about your last
// project.") is not small talk.

// Each core must be the WHOLE sentence: only a lead-in ("so", "okay") before
// it and a short qualifier ("today", "okay") after it. "How are you handling
// retries?" and "Are you ready to walk me through the design?" are asks.
const LEAD = String.raw`^(?:(?:so|and|okay|ok|well|hey|hi|alright|great|um+|uh+)[,\s]+)*`;
const TAIL = String.raw`(?:[\s,]+(?:today|this (?:morning|afternoon|evening)|okay|ok|alright|all right|fine|now|then|guys|everyone|everybody|all|there|so far|again|good (?:morning|afternoon|evening)|morning|hi|hello|hey|welcome|thanks|thank you))*[\s?.!,]*$`;
const CORES = [
  // greetings and thanks
  String.raw`(?:hi|hello|hey|good (?:morning|afternoon|evening)|morning|afternoon|welcome(?: (?:everyone|everybody|aboard|back))?|thanks?(?: you)?(?: (?:so much|for (?:joining|coming|having me|your time)))?|nice (?:to )?(?:meet|see) you|great to (?:meet|see) you|pleasure to meet you)`,
  // how are you / how is it going
  String.raw`how(?: are|['’]re) (?:you|things|we|you all|y['’]?all)(?: doing| going)?`,
  String.raw`how(?:['’]s| is| has) (?:it going|your (?:day|morning|week|weekend)(?: going| been)?|everything|the weather|life)`,
  String.raw`(?:did|do) you (?:find (?:the|this|our) (?:place|office|room|link|building)|have (?:a )?(?:good|nice|great) (?:weekend|trip|day|morning))`,
  // can you hear / see me
  String.raw`(?:can|could) (?:you|everyone|everybody|y['’]?all) (?:hear|see) (?:me|us|my (?:screen|audio|video)|the screen|this|that|it)(?: (?:alright|all right|clearly|well))?`,
  String.raw`am i (?:audible|on mute|muted|coming through|breaking up|frozen)`,
  String.raw`(?:is|was) (?:my|the) (?:audio|mic|microphone|sound|video|screen|connection|camera) (?:okay|ok|working|clear|better|good|coming through)`,
  String.raw`(?:is|was) (?:that|this|it) (?:better|clearer|okay|ok)`,
  // getting started
  String.raw`(?:shall|should|can) we (?:start|begin|get started|kick (?:it )?off)`,
  String.raw`are (?:you|we|everyone|everybody) (?:ready|all set|good to go|here|there)`,
  String.raw`are we (?:recording|live)`,
];
const SMALL_TALK_SENTENCE = new RegExp(`${LEAD}(?:${CORES.join('|')})${TAIL}`, 'i');

/** Fillers that may stand alone between small-talk sentences. */
const FILLER_ONLY = /^(?:ok(?:ay)?|right|great|cool|good|perfect|awesome|alright|so|yeah|yes|sure|um+|uh+|hmm+|mm+)[\s,.!]*$/i;

/** True when every sentence of `text` is small talk or call logistics. */
export function isOnlySmallTalk(text: unknown): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  const sentences = t
    .split(/(?<=[.?!])\s+|,\s+(?=(?:and |so )?(?:did|do|can|could|are|is|how|shall|should|am)\b)/i)
    .map((s) => s.replace(/^(?:and|so|okay|ok|well|oh)[,\s]+/i, '').trim())
    .filter(Boolean);
  if (!sentences.length) return false;
  let sawSmallTalk = false;
  for (const s of sentences) {
    if (FILLER_ONLY.test(s)) continue;
    if (!SMALL_TALK_SENTENCE.test(s)) return false;
    sawSmallTalk = true;
  }
  return sawSmallTalk;
}
