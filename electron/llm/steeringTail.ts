// electron/llm/steeringTail.ts
//
// Live session D (2026-08-23), press 1: the interviewer said "Hey Even, good
// to meet you." and the suggested reply was "Hey, great to meet you too.
// Thanks for taking the time to chat today. Where would you like to start?"
// — a ChatGPT-style HOST closer. In an interview or meeting the OTHER side
// sets the agenda; the candidate greeting back and then steering the
// conversation reads wrong every time.
//
// Two layers fix it: a prompt rule in the spoken-voice contract (the other
// side leads), and this deterministic repair for the turns where the model
// slips anyway. The strip is deliberately narrow — it fires only on
// SMALL-TALK turns (greeting / pleasantry, short), and only removes a
// TRAILING question that matches a known steering shape. A substantive
// answer that legitimately ends in a question is never touched, because
// substantive turns never enter this path.

import { SOCIAL_PLEASANTRY } from './questionShapes';
import { splitGistLine, GIST_MARKER } from './promptSystemV2';

/** Greeting shapes SOCIAL_PLEASANTRY deliberately does not cover (it is a
 *  commute/weather/how-are-you list). "Hey Even, good to meet you." was the
 *  live reported turn. */
const GREETING_RE = /\b(good|great|nice|pleasure) to (meet|see) you\b|\bgood (morning|afternoon|evening)\b|^\s*(hey|hi|hello)\b/i;

const SMALL_TALK_MAX_WORDS = 12;

/** True when the pressed turn is small talk: a short greeting or pleasantry. */
export function isSmallTalkTurn(question: string | null | undefined): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  if (q.split(/\s+/).filter(Boolean).length > SMALL_TALK_MAX_WORDS) return false;
  return GREETING_RE.test(q) || SOCIAL_PLEASANTRY.test(q);
}

/** Host-style steering closers. Each must match a WHOLE trailing sentence. */
const STEERING_TAIL_RES: RegExp[] = [
  /^where would you like to (?:start|begin|kick (?:things )?off)\b[^.?!]*\?$/i,
  /^what would you like to (?:discuss|cover|talk about|start with|dive into|focus on|go over)\b[^.?!]*\?$/i,
  /^(?:so,?\s+)?what(?:'s| is) on (?:your|the) agenda\b[^.?!]*\?$/i,
  /^how can I help\b[^.?!]*\?$/i,
  /^what can I (?:do for you|help you with)\b[^.?!]*\?$/i,
  /^shall we (?:get started|start|begin|dive in|jump in)\b[^.?!]*\?$/i,
  /^(?:is there\s+)?any(?:thing|where) (?:specific\s+)?you(?:'d| would) like (?:me\s+)?to (?:start|begin|cover|focus)\b[^.?!]*\?$/i,
];

export interface SteeringTailResult {
  text: string;
  repaired: boolean;
}

/**
 * Remove a trailing steering question from a small-talk reply. Runs at most
 * twice (a slip occasionally stacks two closers); keeps the original when
 * stripping would empty the answer.
 */
export function stripSteeringTail(answer: string): SteeringTailResult {
  const original = String(answer ?? '');
  const trimmed = original.trim();
  if (!trimmed || trimmed.startsWith('```')) return { text: original, repaired: false };

  // Code-review 2026-08-23: a trailing [[GIST]] line made this a NO-OP — the
  // gist line became the "last sentence", matched no steering shape, and the
  // closer shipped on every >40-word small-talk reply (the prompt contract
  // mandates a gist there). Split the gist off first, strip the closer from
  // the BODY, then reattach the gist on its own line (splitGistLine only
  // honors a marker that starts a line, so it must never be joined inline).
  const { body, gist } = splitGistLine(trimmed);
  let t = body.trim();
  if (!t) return { text: original, repaired: false };

  let repaired = false;
  for (let pass = 0; pass < 2; pass++) {
    const sentences = t.split(/(?<=[.!?…])\s+/);
    const last = (sentences[sentences.length - 1] || '').trim();
    if (!STEERING_TAIL_RES.some((re) => re.test(last))) break;
    const rest = sentences.slice(0, -1).join(' ').trim();
    if (!rest) break; // the whole reply was the steering question — fail open
    t = rest;
    repaired = true;
  }
  if (!repaired) return { text: original, repaired: false };
  return { text: gist ? `${t}\n${GIST_MARKER} ${gist}` : t, repaired: true };
}
