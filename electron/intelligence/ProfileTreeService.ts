// electron/intelligence/ProfileTreeService.ts
//
// Spec Phase 2 — the canonical, deterministic "Profile Tree" read API. The spec
// asks for ProfileTreeService.getIdentity()/getProjects()/getExperience()/
// getSkills()/getEducation()/getRoleFit()/getCompactIdentityBlock()/
// getInterviewIntro().
//
// THIS IS A FACADE, NOT A REWRITE. Natively already selects source-aware profile
// evidence via electron/llm/manualProfileIntelligence.ts (`selectManualProfileEvidence`),
// the same selector used by live manual-chat/WTA JIT paths. This service DELEGATES
// to that selector with canonical question phrasing, then returns the compact JIT
// prompt that a provider must answer from. It does not render final prose.
// The output is therefore aligned with the product's single evidence source of truth.
//
// Why a class with per-instance profile (not module functions): it structurally
// guarantees the spec's privacy/isolation requirement. An instance built for Bob
// holds ONLY Bob's facts and has no reference to anyone else's — cross-user leakage
// is impossible by construction, not by a runtime check. (See privacy-isolation
// test: Bob's ProfileTreeService can never surface Alice's project.)
//
// Determinism guarantees required by the spec acceptance criteria:
//   • identity/intro/projects/experience/skills/education answer from structure,
//   • NEVER "I am Natively" (assistant-meta asks bail; these methods ask candidate
//     questions, so they always answer AS the candidate),
//   • NEVER "I don't know" when a profile exists (returns the grounded string, or
//     null only when that specific facet is genuinely absent from the profile).

import {
  selectManualProfileEvidence,
  profileFactsReady,
  isAssistantIdentityQuestion,
  type StructuredProfileFacts,
  type StructuredJobFacts,
} from '../llm/manualProfileIntelligence';
import { buildProfileJitPrompt } from '../llm/ProfileJitPromptBuilder';

type MaybeStructured<T> = T | null | undefined;

/** Minimal structured-document shape (mirrors profileAnswerBackend's orchestrator). */
interface StructuredDocument<T> {
  structured_data?: MaybeStructured<T>;
}

export interface ProfileTreeSource {
  activeResume?: StructuredDocument<StructuredProfileFacts> | null;
  activeJD?: StructuredDocument<StructuredJobFacts> | null;
}

export interface ProfileIdentityResult {
  /** The candidate's name, or null when no profile/name is loaded. */
  name: string | null;
  /** Deterministic first-person identity answer ("My name is X."), or null. */
  answer: string | null;
  /** Whether a usable candidate profile is loaded at all. */
  available: boolean;
}

// Canonical phrasings — each is the simplest, unqualified question that routes to
// the intended branch of selectManualProfileEvidence. (Verified against
// NAME_PATTERNS / INTRO_PATTERNS / EXPERIENCE_PATTERNS / PROJECT_PATTERNS /
// SKILL_PATTERNS / EDUCATION_PATTERNS / JD_FIT_PATTERNS in manualProfileIntelligence.)
const Q = {
  name: 'what is your name',
  intro: 'introduce yourself',
  background: 'walk me through your background',
  projects: 'what are your projects',
  experience: 'what is your experience',
  skills: 'what are your skills',
  education: 'what is your education',
  roleFit: 'how am I a fit for this role',
  bestProject: 'tell me about your best project',
} as const;

/** Modes whose answers are spoken in the CANDIDATE/user voice (first person). In
 *  these modes a candidate question must never be answered as the assistant. */
const CANDIDATE_VOICE_MODES = new Set([
  'technical-interview', 'looking-for-work', 'general', 'recruiting',
]);

export interface CandidatePerspectiveVerdict {
  /** True when the answer to this query must speak AS the candidate/user. */
  expectCandidateVoice: boolean;
  /** True when an "I am Natively / an AI assistant" answer is a LEAK here. */
  assistantIdentityWouldLeak: boolean;
  /** True when the query legitimately asks about the app/assistant itself. */
  isAppIdentityQuestion: boolean;
  reason: string;
}

/**
 * Read-only deterministic Profile Tree over one loaded profile (+ optional JD).
 * Every getter delegates to the live fast-path formatter; none invent facts.
 */
export class ProfileTreeService {
  private readonly profile: MaybeStructured<StructuredProfileFacts>;
  private readonly jd: MaybeStructured<StructuredJobFacts>;

  constructor(
    profile: MaybeStructured<StructuredProfileFacts>,
    jobDescription?: MaybeStructured<StructuredJobFacts>,
  ) {
    this.profile = profile ?? null;
    this.jd = jobDescription ?? null;
  }

  /** Build from the live KnowledgeOrchestrator-shaped source (activeResume/activeJD). */
  static fromSource(source?: ProfileTreeSource | null): ProfileTreeService {
    return new ProfileTreeService(
      source?.activeResume?.structured_data ?? null,
      source?.activeJD?.structured_data ?? null,
    );
  }

  /** True when a usable candidate profile (name/experience/projects/skills/education) is loaded. */
  isReady(): boolean {
    return profileFactsReady(this.profile);
  }

  /**
   * Build a compact JIT prompt for the canonical profile question. This service
   * no longer returns deterministic final prose; callers must pass this prompt to
   * a provider when a user-visible answer is needed.
   */
  private answer(question: string): string | null {
    try {
      const evidence = selectManualProfileEvidence({
        question,
        profile: this.profile,
        jobDescription: this.jd,
        source: 'what_to_answer',
      });
      if (!evidence) return null;
      return buildProfileJitPrompt({
        question,
        answerType: evidence.answerType,
        answerShape: evidence.answerShape,
        sourceOwner: evidence.sourceOwner,
        evidence,
        maxAnswerWords: 90,
      }).userPrompt;
    } catch {
      return null;
    }
  }

  /**
   * Stable identity. Returns the name (read directly from structure) and the
   * deterministic first-person identity answer. `available` reflects whether ANY
   * profile is loaded so a caller can distinguish "no profile" from "no name".
   */
  getIdentity(): ProfileIdentityResult {
    return {
      name: this.readName(),
      answer: this.answer(Q.name),
      available: this.isReady(),
    };
  }

  /** "Introduce yourself" — grounded first-person interview intro. */
  getInterviewIntro(): string | null {
    return this.answer(Q.intro);
  }

  /** "Walk me through your background" — experience-arc framing of the intro. */
  getBackground(): string | null {
    return this.answer(Q.background);
  }

  /** Project listing (deterministic structured pack). */
  getProjects(): string | null {
    return this.answer(Q.projects);
  }

  /** Experience listing. */
  getExperience(): string | null {
    return this.answer(Q.experience);
  }

  /** Skills listing (handles flat + categorized skill shapes). */
  getSkills(): string | null {
    return this.answer(Q.skills);
  }

  /** Education listing. */
  getEducation(): string | null {
    return this.answer(Q.education);
  }

  /**
   * JD fit — combines profile + the active JD (skill/experience matching).
   * Returns null only when there is no usable profile evidence at all (no
   * anchors match). When a JD-fit question is asked WITHOUT a JD loaded, this
   * still returns a JIT prompt grounded in the candidate's own skills/
   * experience/projects (never fabricated JD facts — the prompt simply omits
   * any <target_job_evidence> section and hints the model to answer from
   * profile evidence only). (docstring corrected 2026-07-11: the previous
   * "returns null when no JD is loaded" claim no longer matched
   * selectManualProfileEvidence's JD_FIT_PATTERNS fallback branch.)
   */
  getRoleFit(): string | null {
    return this.answer(Q.roleFit);
  }

  /**
   * A compact identity block for prompt grounding: name + the one-line quick intro.
   * Deterministic, content-bounded. Returns null when no profile is loaded.
   */
  getCompactIdentityBlock(): string | null {
    if (!this.isReady()) return null;
    const name = this.readName();
    const quick = this.answer('give me a quick intro');
    if (quick) return quick;
    // No experience to build an intro from, but a name exists → minimal block.
    return name ? `My name is ${name}.` : null;
  }

  /**
   * The candidate's single best/flagship project (resumes lead with it). Routes
   * through the deterministic single-project fast path ("best project"). Returns
   * null when no project is loaded.
   */
  getBestProject(): string | null {
    return this.answer(Q.bestProject);
  }

  /**
   * CANDIDATE PERSPECTIVE GUARD (prompt Phase 4). Given the active mode and the
   * user query, decide whether the answer must speak AS the candidate — and
   * therefore whether an "I am Natively / an AI assistant" answer would be a LEAK.
   *
   * This is the deterministic gate that prevents the headline bug ("introduce
   * yourself → I'm Natively"). It does NOT generate text; a caller uses the verdict
   * to (a) prefer the deterministic ProfileTree answer, and (b) reject/repair any
   * model output that self-identifies as the assistant in a candidate-voice context.
   *
   * Static (no profile needed) so any layer can consult it cheaply. Genuine app
   * questions ("are you an AI?", "what is Natively?") are exempt — there the
   * assistant identity is the correct answer.
   */
  static getCandidatePerspectiveGuard(mode: string | undefined, query: string): CandidatePerspectiveVerdict {
    const isAppIdentityQuestion = (() => {
      try { return isAssistantIdentityQuestion(query); } catch { return false; }
    })();
    const modeId = (mode || '').trim();
    // A candidate-voice mode, OR an unknown/empty mode where the question itself is a
    // candidate-identity ask (interview-prep default), expects candidate voice.
    const candidateMode = CANDIDATE_VOICE_MODES.has(modeId) || modeId === '';
    const expectCandidateVoice = candidateMode && !isAppIdentityQuestion;
    return {
      expectCandidateVoice,
      assistantIdentityWouldLeak: expectCandidateVoice,
      isAppIdentityQuestion,
      reason: isAppIdentityQuestion
        ? 'app_identity_question_exempt'
        : expectCandidateVoice
          ? `candidate_voice_mode:${modeId || 'default'}`
          : `non_candidate_mode:${modeId || 'unknown'}`,
    };
  }

  /** Instance convenience: guard for this service's typical interview context. */
  candidatePerspectiveGuard(mode: string | undefined, query: string): CandidatePerspectiveVerdict {
    return ProfileTreeService.getCandidatePerspectiveGuard(mode, query);
  }

  /**
   * Read the candidate name directly from structured fields. This is field access
   * (identity.name | name | personal.name), not answer logic — it mirrors the
   * file-local `profileName` in manualProfileIntelligence, which isn't exported.
   * Kept to the same three fields so it can never disagree with the answer path.
   */
  private readName(): string | null {
    const p = this.profile as
      | { identity?: { name?: unknown }; name?: unknown; personal?: { name?: unknown } }
      | null
      | undefined;
    if (!p) return null;
    const candidates = [p.identity?.name, p.name, p.personal?.name];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return null;
  }
}
