import {
  NegotiationScript,
  StructuredResume,
  ActiveJD,
  CompanyDossier,
  GenerateContentFn,
} from './types';
import {
  NEGOTIATION_SCRIPT_PROMPT,
  NEGOTIATION_INTENT_PROMPT,
  LIVE_COACHING_PROMPT,
} from './prompts';
import { generateJSON, fillTemplate } from './llmInvoker';

export type NegotiationPhase =
  | 'idle'
  | 'opening_offer_made'
  | 'counter_pending'
  | 'closing'
  | 'resolved';

export interface NegotiationState {
  phase: NegotiationPhase;
  theirOffer: number | null;
  yourTarget: number | null;
  currency: string | null;
  recentUtterances: string[]; // last ~6
  startedAt: number | null;
  lastUpdatedAt: number | null;
}

export interface LiveCoachingResponse {
  tacticalNote: string;
  exactScript: string;
  phase: string;
  theirOffer: number | null;
  yourTarget: number | null;
  currency: string;
  showSilenceTimer: boolean;
}

const MAX_UTTERANCE_HISTORY = 8;

export class NegotiationTracker {
  private state: NegotiationState = {
    phase: 'idle',
    theirOffer: null,
    yourTarget: null,
    currency: null,
    recentUtterances: [],
    startedAt: null,
    lastUpdatedAt: null,
  };

  // Quick regex pre-classifier — avoids spamming LLM on every recruiter sentence
  static readonly EXPECTATION_RE = /\b(salary expectation|expectations|comp expectations|what.+looking|what.+want|compensation range|target compensation|range you|salary range)\b/i;
  static readonly OFFER_RE = /\b(prepared to offer|offer of|extending an offer|happy to offer|offer is|base of|base salary of|comp package|total comp|annual base|will pay)\b/i;
  static readonly COUNTER_RE = /\b(can come up to|stretch to|that.s our (best|ceiling|max|top)|we can do|we can offer up to|maximum we|top of (our|the) range|our (highest|best)|absolute (max|ceiling))\b/i;
  static readonly CLOSING_RE = /\b(move forward|accept|deal|agree to|finalize|sign|written offer|formal offer|when can you start|ready to commit)\b/i;

  isActive(): boolean {
    return this.state.phase !== 'idle' && this.state.phase !== 'resolved';
  }

  getState(): NegotiationState {
    return { ...this.state, recentUtterances: [...this.state.recentUtterances] };
  }

  reset(): void {
    this.state = {
      phase: 'idle',
      theirOffer: null,
      yourTarget: null,
      currency: null,
      recentUtterances: [],
      startedAt: null,
      lastUpdatedAt: null,
    };
  }

  recordUtterance(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.state.recentUtterances.push(trimmed);
    if (this.state.recentUtterances.length > MAX_UTTERANCE_HISTORY) {
      this.state.recentUtterances.shift();
    }
    this.state.lastUpdatedAt = Date.now();
    if (this.state.startedAt === null) this.state.startedAt = this.state.lastUpdatedAt;
  }

  /** Best-effort regex-based phase advance. Numbers are extracted via a salary regex. */
  advancePhaseByRegex(text: string): boolean {
    const lower = text.toLowerCase();
    const amount = extractSalaryAmount(text);
    let advanced = false;

    if (NegotiationTracker.EXPECTATION_RE.test(lower) && this.state.phase === 'idle') {
      this.state.phase = 'opening_offer_made';
      advanced = true;
    }
    if (NegotiationTracker.OFFER_RE.test(lower)) {
      this.state.phase = 'counter_pending';
      if (amount !== null) this.state.theirOffer = amount;
      advanced = true;
    }
    if (NegotiationTracker.COUNTER_RE.test(lower) && this.state.phase === 'counter_pending') {
      if (amount !== null) this.state.theirOffer = amount;
      advanced = true;
    }
    if (NegotiationTracker.CLOSING_RE.test(lower)) {
      this.state.phase = 'closing';
      advanced = true;
    }

    if (advanced) this.state.lastUpdatedAt = Date.now();
    return advanced;
  }

  setTarget(amount: number, currency: string): void {
    this.state.yourTarget = amount;
    this.state.currency = currency;
  }
}

function extractSalaryAmount(text: string): number | null {
  // Match: "180k", "$180,000", "180000", "180 000"
  const kMatch = text.match(/\$?\s*(\d{2,3}(?:[\.,]\d{1,3})?)\s*[kK]\b/);
  if (kMatch) return Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
  const dMatch = text.match(/\$\s*(\d{2,3}(?:[, ]?\d{3})+)/);
  if (dMatch) return parseInt(dMatch[1].replace(/[, ]/g, ''), 10);
  const plainMatch = text.match(/\b(\d{5,7})\b/);
  if (plainMatch) {
    const n = parseInt(plainMatch[1], 10);
    if (n >= 30000 && n <= 2000000) return n;
  }
  return null;
}

export interface NegotiationIntent {
  intent: 'asking_expectations' | 'making_offer' | 'counter' | 'closing' | 'other';
  amount: number | null;
  currency: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export async function classifyNegotiationIntent(
  generateFn: GenerateContentFn,
  utterance: string
): Promise<NegotiationIntent | null> {
  if (!utterance.trim()) return null;
  try {
    return await generateJSON<NegotiationIntent>(
      generateFn,
      fillTemplate(NEGOTIATION_INTENT_PROMPT, { UTTERANCE: utterance.slice(0, 1500) })
    );
  } catch (e: any) {
    console.warn('[NegotiationCoach] intent classification failed:', e?.message);
    return null;
  }
}

export async function generateScript(
  generateFn: GenerateContentFn,
  resume: StructuredResume,
  jd: ActiveJD,
  dossier: CompanyDossier | null
): Promise<NegotiationScript> {
  const resumeSummary = JSON.stringify({
    current_role: resume.current_role,
    total_experience_years: resume.total_experience_years,
    skills: (resume.skills ?? []).slice(0, 20),
    top_experiences: (resume.experiences ?? []).slice(0, 3).map(e => ({
      title: e.title,
      organization: e.organization,
      duration_months: e.duration_months,
    })),
  }, null, 2);

  const jdSummary = JSON.stringify({
    title: jd.title,
    company: jd.company,
    level: jd.level,
    location: jd.location,
    compensation_hint: jd.compensation_hint,
    technologies: jd.technologies,
    min_years_experience: jd.min_years_experience,
  }, null, 2);

  const dossierSnippet = dossier
    ? JSON.stringify({
        salary_estimates: dossier.salary_estimates ?? [],
        interview_difficulty: dossier.interview_difficulty,
      }, null, 2)
    : 'null';

  return await generateJSON<NegotiationScript>(
    generateFn,
    fillTemplate(NEGOTIATION_SCRIPT_PROMPT, {
      COMPANY: jd.company || 'the company',
      RESUME_SUMMARY: resumeSummary,
      JD_SUMMARY: jdSummary,
      DOSSIER_SNIPPET: dossierSnippet,
    })
  );
}

export async function generateLiveCoaching(
  generateFn: GenerateContentFn,
  state: NegotiationState,
  script: NegotiationScript | null
): Promise<LiveCoachingResponse | null> {
  if (!script) return null;
  try {
    return await generateJSON<LiveCoachingResponse>(
      generateFn,
      fillTemplate(LIVE_COACHING_PROMPT, {
        TRACKER_STATE: JSON.stringify(state, null, 2),
        SCRIPT: JSON.stringify(script, null, 2),
        RECENT_UTTERANCES: state.recentUtterances.join('\n'),
      })
    );
  } catch (e: any) {
    console.warn('[NegotiationCoach] live coaching failed:', e?.message);
    return null;
  }
}
