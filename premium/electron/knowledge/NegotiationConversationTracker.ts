import { NegotiationPhase, NegotiationState, OfferEvent, OfferState } from './types';

/**
 * Escape characters that have special meaning inside XML/HTML attribute values and
 * element content. Applied to every user-derived string (STT transcripts, recruiter
 * utterances) before they are interpolated into the LLM system prompt XML block.
 * This prevents prompt-injection via adversarial audio input.
 */
export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, ' ')    // collapse newlines — no multi-line escapes in single-line context
    .replace(/\r/g, ' ');
}

/** Maximum number of characters accepted from a single STT utterance before truncation. */
const MAX_UTTERANCE_LENGTH = 500;

const SALARY_PATTERNS = [
  /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)[k]?/gi,
  /(\d{2,3})[k]\b/gi,
  /between\s+(\d{2,3})[k]?\s+and\s+(\d{2,3})[k]?/gi,
  /(\d{2,3})[k]?\s+(?:base|salary|comp|compensation|package)/gi,
  /budget\s+(?:is|tops?|caps?)\s+(?:at\s+)?(?:out\s+at\s+)?(\d{2,3})[k]?/gi,
  /(?:offer(?:ing)?)\s+(?:is\s+|of\s+)?(\d{2,3})[k]?/gi,
];

const PUSHBACK_SIGNALS = ['above our', 'beyond our', 'out of range', "can't go higher", "can't go above", 'budget is fixed', 'budget tops', 'best we can do', 'highest we can go'];
const REJECTION_SIGNALS = ['not possible', "won't work", 'no flexibility', 'take it or leave', 'final offer', 'non-negotiable'];
const ACCEPTANCE_SIGNALS = ['that works', "i'll get that approved", 'let me send that', 'we can do that', 'let me confirm', 'i can approve'];
const BENEFITS_SIGNALS = ['signing bonus', 'sign-on', 'equity', 'stock', 'rsu', 'options', 'pto', 'vacation days', 'remote', 'work from home', 'wfh', 'flexible'];
const VAGUE_SIGNALS = ['competitive', 'above market', 'market rate', 'industry standard', 'in line with', 'within range'];
const SALARY_CONTEXT_WORDS = ['targeting', 'asking', 'looking for', 'expect', 'want', 'need', 'require', 'range'];

function normalizeAmount(raw: string): number {
  const clean = raw.replace(/[$,\s]/g, '');
  const num = parseFloat(clean);
  return num < 1000 ? num * 1000 : num;
}

// Explicit comp keywords that, in an INTERVIEWER turn, indicate the recruiter
// has put compensation on the table. Kept tight (no ambiguous tokens like
// "worth"/"number") so a transcript scan doesn't false-trigger on non-comp talk.
const COMP_KEYWORD_RE =
  /\b(salary|compensation|comp package|total comp|base pay|base salary|ctc|remuneration|signing bonus|sign-on|joining bonus|equity grant|stock options?|rsus?|pay range|salary range|expected (?:salary|comp|compensation|ctc)|how much (?:are|do) you (?:want|expect|looking)|what are your (?:salary |comp )?expectations|number you(?:'re| are) (?:looking|expecting)|budget for (?:this|the) (?:role|position))\b/i;

/**
 * Phase 1 transcript hint: does this text (an INTERVIEWER turn) raise
 * compensation? True when it contains a recognizable salary amount ($/Nk) OR an
 * explicit comp keyword. Shared by the live tracker and the orchestrator's
 * transcript-aware intent routing so both use one definition of "comp evidence".
 *
 * Deliberately conservative — only call this on interviewer turns (not the
 * candidate's own typed question, which is classified separately).
 */
export function textHasCompEvidence(text: string): boolean {
  if (!text) return false;
  const t = text.substring(0, MAX_UTTERANCE_LENGTH);
  if (COMP_KEYWORD_RE.test(t)) return true;
  for (const pattern of SALARY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(t)) !== null) {
      const raws = match[2] ? [match[1], match[2]] : [match[1] || match[0]];
      for (const raw of raws) {
        if (!raw) continue;
        const amount = normalizeAmount(raw);
        if (amount >= 20000 && amount <= 5000000) return true;
      }
    }
  }
  return false;
}

export class NegotiationConversationTracker {
  private state: NegotiationState;

  constructor() { this.state = this.initialState(); }

  private initialState(): NegotiationState {
    return {
      phase: 'INACTIVE',
      offers: { latestRecruiterAmount: null, latestRecruiterCurrency: 'USD', trajectory: 'first', allEvents: [] },
      userTarget: null,
      pushbackCount: 0,
      benefitsMentioned: [],
      vagueOfferDetected: false,
      silenceTimerActive: false,
      lastRecruiterSignal: null,
    };
  }

  addRecruiterUtterance(text: string): void {
    // Defensive cap: prevents runaway regex cost on unusually long or garbled STT output
    text = text.substring(0, MAX_UTTERANCE_LENGTH);

    // Fix 9: activate PROBE first, before any other processing
    if (this.state.phase === 'INACTIVE') {
      this.state.phase = 'PROBE';
    }

    const lower = text.toLowerCase();
    const amounts = this.extractAmounts(text);

    for (const amount of amounts) {
      const event: OfferEvent = { speaker: 'recruiter', amount, currency: 'USD', offerType: 'base', raw: text.substring(0, 100), timestamp: Date.now(), isVague: false };
      this.state.offers.allEvents.push(event);
      const prev = this.state.offers.latestRecruiterAmount;
      this.state.offers.latestRecruiterAmount = amount;
      this.state.offers.trajectory = prev === null ? 'first' : amount > prev ? 'rising' : amount < prev ? 'falling' : 'flat';
      this.transitionPhase('ANCHOR', 'new_offer');
      this.state.lastRecruiterSignal = 'offer';
    }

    if (PUSHBACK_SIGNALS.some(s => lower.includes(s))) {
      this.state.pushbackCount++;
      this.state.lastRecruiterSignal = 'pushback';
      this.transitionPhase('HOLD');
      if (this.state.pushbackCount >= 2) this.transitionPhase('PIVOT_BENEFITS');
    } else if (REJECTION_SIGNALS.some(s => lower.includes(s))) {
      this.state.lastRecruiterSignal = 'rejection';
      this.transitionPhase('PIVOT_BENEFITS');
    } else if (ACCEPTANCE_SIGNALS.some(s => lower.includes(s))) {
      this.state.lastRecruiterSignal = 'acceptance';
      this.transitionPhase('CLOSE');
    }

    for (const signal of BENEFITS_SIGNALS) {
      if (lower.includes(signal) && !this.state.benefitsMentioned.includes(signal)) {
        this.state.benefitsMentioned.push(signal);
        this.state.lastRecruiterSignal = 'benefits';
      }
    }

    if (VAGUE_SIGNALS.some(s => lower.includes(s)) && amounts.length === 0) {
      this.state.vagueOfferDetected = true;
      this.state.lastRecruiterSignal = 'vague';
    }
  }

  addUserUtterance(text: string): void {
    // Defensive cap: mirrors addRecruiterUtterance — prevents regex cost on long input
    text = text.substring(0, MAX_UTTERANCE_LENGTH);

    // Fix 4: only trigger silence timer when active AND salary context present
    const lower = text.toLowerCase();
    const hasSalaryContext = SALARY_CONTEXT_WORDS.some(w => lower.includes(w));
    const amounts = this.extractAmounts(text);

    if (this.isActive() && amounts.length > 0 && hasSalaryContext) {
      this.state.silenceTimerActive = true;
      if (this.state.userTarget === null) {
        this.state.userTarget = amounts[0];
      }
      const event: OfferEvent = { speaker: 'user', amount: amounts[0], currency: 'USD', offerType: 'base', raw: text.substring(0, 100), timestamp: Date.now(), isVague: false };
      this.state.offers.allEvents.push(event);
      if (this.state.phase === 'ANCHOR') this.transitionPhase('COUNTER');
    } else {
      this.state.silenceTimerActive = false;
    }
  }

  clearSilenceTimer(): void { this.state.silenceTimerActive = false; }

  // Deep copy — callers must not be able to mutate internal coaching history
  getState(): NegotiationState {
    return {
      ...this.state,
      offers: {
        ...this.state.offers,
        // Each OfferEvent is spread so callers cannot corrupt coaching history
        // by mutating a returned event (e.g. e.raw = '...')
        allEvents: this.state.offers.allEvents.map(e => ({ ...e })),
      },
      benefitsMentioned: [...this.state.benefitsMentioned],
    };
  }

  isActive(): boolean { return this.state.phase !== 'INACTIVE'; }
  /**
   * A compensation exchange is actually under way: an amount or a vague offer
   * was heard, or the thread moved past PROBE. isActive() is true from the
   * FIRST recruiter utterance of any kind (addRecruiterUtterance enters PROBE
   * unconditionally), so it cannot tell "we are negotiating" from "the recruiter
   * said hello" — see KnowledgeOrchestrator's intent classification.
   */
  isNegotiating(): boolean {
    const s = this.state;
    return (s.phase !== 'INACTIVE' && s.phase !== 'PROBE')
      || s.offers.allEvents.length > 0
      || s.vagueOfferDetected;
  }
  reset(): void { this.state = this.initialState(); }
  setUserTarget(amount: number): void { this.state.userTarget = amount; }

  getStateXML(): string {
    const s = this.state;
    const offerHistory = s.offers.allEvents
      .map(e => `  - ${e.speaker === 'recruiter' ? 'Recruiter' : 'You'}: ${e.currency} ${(e.amount / 1000).toFixed(0)}k ("${escapeXml(e.raw.substring(0, 60))}")`)
      .join('\n');
    return `<live_negotiation_state>
Phase: ${s.phase}
Their latest offer: ${s.offers.latestRecruiterAmount ? `${s.offers.latestRecruiterCurrency} ${s.offers.latestRecruiterAmount.toLocaleString()}` : 'Not stated yet'}
Your target: ${s.userTarget ? `${s.offers.latestRecruiterCurrency} ${s.userTarget.toLocaleString()}` : 'Not stated yet'}
Pushback count: ${s.pushbackCount}
Benefits mentioned: ${s.benefitsMentioned.length > 0 ? s.benefitsMentioned.join(', ') : 'None'}
Vague offer: ${s.vagueOfferDetected}
Last recruiter signal: ${s.lastRecruiterSignal || 'none'}
Offer history:
${offerHistory || '  (no offers yet)'}
</live_negotiation_state>`;
  }

  private extractAmounts(text: string): number[] {
    const amounts: number[] = [];
    const seen = new Set<number>();
    for (const pattern of SALARY_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        // When a pattern has two capture groups (e.g. "between X and Y"), extract both
        const raws = match[2] ? [match[1], match[2]] : [match[1] || match[0]];
        for (const raw of raws) {
          if (!raw) continue;
          const amount = normalizeAmount(raw);
          if (amount >= 20000 && amount <= 5000000 && !seen.has(amount)) {
            seen.add(amount);
            amounts.push(amount);
          }
        }
      }
    }
    return amounts;
  }

  // Fix 5: allow re-anchoring from HOLD/PIVOT_BENEFITS on new offer
  private transitionPhase(to: NegotiationPhase, trigger?: 'new_offer'): void {
    if (this.state.phase === 'CLOSE') return;
    if (trigger === 'new_offer' && (this.state.phase === 'HOLD' || this.state.phase === 'PIVOT_BENEFITS')) {
      this.state.phase = 'COUNTER';
      return;
    }
    const order: NegotiationPhase[] = ['INACTIVE', 'PROBE', 'ANCHOR', 'COUNTER', 'HOLD', 'PIVOT_BENEFITS', 'CLOSE'];
    const currentIdx = order.indexOf(this.state.phase);
    const targetIdx = order.indexOf(to);
    if (targetIdx > currentIdx) this.state.phase = to;
  }
}
