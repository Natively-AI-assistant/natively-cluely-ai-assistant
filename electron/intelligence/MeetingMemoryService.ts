// electron/intelligence/MeetingMemoryService.ts
//
// Spec Phase 10 — Meeting Memory System (MeetingMemoryService + MeetingInsightExtractor).
//
// HONEST STATUS: persistence already exists (electron/MeetingPersistence.ts saves the
// meeting row + transcript + summary_json; electron/services/post-call/PostCallWorkflow.ts
// adds heuristic action items / follow-up / coaching; electron/rag/RAGManager.ts embeds
// chunks). What was MISSING (per the Phase 1 NOT-FOUND map): first-class structured
// EXTRACTION of entities / topics / decisions / questions as data, and a single service
// that turns a finished transcript into the spec's structured MeetingRecord.
//
// This module adds exactly that, as a PURE, DETERMINISTIC, no-LLM extractor (so it can
// run in the post-meeting background without competing with the live answer path or a
// model). It does NOT change the live persistence flow — a caller (Phase 19 rollout,
// behind meeting_memory_v2_enabled) can call buildMeetingRecord() after a meeting ends
// to enrich what's stored. Reuses the question/decision/action patterns already proven
// in TranscriptPreprocessor.

export interface MeetingTranscriptSegment {
  speaker: string;
  text: string;
  timestamp?: number;
}

export interface MeetingInsights {
  topics: string[];
  questionsAsked: string[];
  decisions: string[];
  actionItems: string[];
  /** Risks/blockers raised ("Risk: …", "blocker", "concern", "may exceed budget"). */
  risks: string[];
  entities: string[];
  skillsDiscussed: string[];
  companiesDiscussed: string[];
}

export interface MeetingRecord extends MeetingInsights {
  meetingId: string;
  mode?: string;
  startedAt?: number;
  endedAt?: number;
  participants: string[];
  cleanTranscript: string;
  /** Coarse 0..1 quality signal (length/structure) — not a model judgment. */
  sourceQuality: number;
}

// Reuse the patterns proven in electron/rag/TranscriptPreprocessor.ts, PLUS the natural
// meeting phrasings the original set missed (task Phase 9, bug #4): a "Decision:" / "Action:" /
// "Risk:" LABEL prefix, and ownership phrasing ("Mark owns X", "Anu will do Y by Friday").
const QUESTION_PATTERNS = [/\?\s*$/, /^(what|who|when|where|why|how|can|could|would|should|is|are|do|does|did)\b/i];
const DECISION_PATTERNS = [
  /\b(decided|agreed|confirmed|approved|let'?s go with|we'?ll do|going with|we will|final decision)\b/i,
  /^\s*decision\b\s*[:\-]/i,                 // "Decision: beta launches next Tuesday"
  /\b(launch(?:es|ing)?|ship(?:s|ping)?|go(?:ing)? live)\b.*\b(next|on|by)\b/i, // "beta launches next Tuesday"
];
const ACTION_PATTERNS = [
  /\b(will|going to|need to|have to|must|action item|to[- ]?do|follow[- ]?up)\b/i,
  /^\s*(action|todo|to[- ]?do|task)\b\s*[:\-]/i,    // "Action: …", "TODO: …"
  /\b(owns?|owner|responsible for|on the hook for|takes? (?:on|over)|assigned to)\b/i, // "Mark owns Redis migration"
  /\b\w+\b\s+(?:will|to)\s+\w+.*\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|tomorrow|next week|\w+day)\b/i,
];
// Risks / blockers / concerns raised in the meeting.
const RISK_PATTERNS = [
  /^\s*(risk|blocker|concern|issue)\b\s*[:\-]/i,    // "Risk: Deepgram cost may exceed budget"
  /\b(risk|blocker|blocked by|concern(?:ed)?|may (?:exceed|slip|overrun|miss)|might (?:exceed|slip|fail)|over budget|behind schedule|won'?t (?:make|hit))\b/i,
];

// Lightweight tech-skill lexicon for skillsDiscussed (generic; not user-specific).
const SKILL_LEXICON = /\b(python|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|sql|nosql|redis|postgres(?:ql)?|mongodb|kafka|docker|kubernetes|aws|gcp|azure|graphql|rest|grpc|tensorflow|pytorch|spark|hadoop|terraform|microservices?|system design|scalability|caching|sharding|load balanc\w+|machine learning|ml|deep learning)\b/gi;

const STOP_ENTITY = new Set([
  'the', 'this', 'that', 'these', 'those', 'have', 'has', 'had', 'tell', 'what', 'when',
  'where', 'which', 'who', 'why', 'how', 'and', 'but', 'for', 'are', 'was', 'were', 'can',
  'could', 'would', 'should', 'will', 'did', 'does', 'your', 'you', 'our', 'they', 'their',
  'with', 'about', 'into', 'from', 'okay', 'yes', 'sure', 'right', 'well', 'let', 'give',
  'sorry', 'thanks', 'hello', 'maybe', 'just', 'really', 'actually', 'basically',
]);

const FILLER = new Set(['uh', 'um', 'ah', 'hmm', 'er', 'erm', 'like', 'you know', 'i mean']);

const hasAny = (text: string, patterns: RegExp[]) => patterns.some((p) => p.test(text));
const dedupe = (arr: string[]) => [...new Set(arr.map((s) => s.trim()).filter(Boolean))];

function cleanLine(text: string): string {
  return (text || '')
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1') // de-stutter
    .split(/\s+/)
    .filter((w) => !FILLER.has(w.toLowerCase().replace(/[.,!?;:]/g, '')))
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

/**
 * Deterministic meeting insight extractor. Pure, no LLM, no IO, never throws. Caps
 * everything so a huge transcript can't blow up memory.
 */
export class MeetingInsightExtractor {
  extract(segments: MeetingTranscriptSegment[], max = 20): MeetingInsights {
    const empty: MeetingInsights = {
      topics: [], questionsAsked: [], decisions: [], actionItems: [], risks: [], entities: [], skillsDiscussed: [], companiesDiscussed: [],
    };
    try {
      if (!Array.isArray(segments) || segments.length === 0) return empty;
      const questions: string[] = [];
      const decisions: string[] = [];
      const actions: string[] = [];
      const risks: string[] = [];
      const entities: string[] = [];
      const skills: string[] = [];
      const seenEnt = new Set<string>();

      for (const seg of segments) {
        const raw = (seg?.text || '').trim();
        if (!raw) continue;
        const line = cleanLine(raw);
        if (!line) continue;

        // Risk is checked FIRST and is exclusive — a "Risk: …" line is not also an
        // action just because it contains "may exceed". Decision/action are not mutually
        // exclusive of each other (an agreed action is both), matching prior behavior.
        const isRisk = hasAny(line, RISK_PATTERNS);
        if (isRisk) risks.push(line);
        if (hasAny(line, QUESTION_PATTERNS) && line.length > 8) questions.push(line);
        if (!isRisk && hasAny(line, DECISION_PATTERNS)) decisions.push(line);
        if (!isRisk && hasAny(line, ACTION_PATTERNS) && line.length > 8) actions.push(line);

        // Skills (generic lexicon).
        let m: RegExpExecArray | null;
        SKILL_LEXICON.lastIndex = 0;
        while ((m = SKILL_LEXICON.exec(line)) !== null) skills.push(m[0].toLowerCase());

        // Entities (capitalized multi-char tokens, deduped, stop-word filtered).
        for (const tok of line.match(/\b[A-Z][a-zA-Z0-9+.&-]{2,}\b/g) || []) {
          const key = tok.toLowerCase();
          if (STOP_ENTITY.has(key) || seenEnt.has(key)) continue;
          seenEnt.add(key);
          entities.push(tok);
        }
      }

      // Topics = the most frequent skill terms + top entities (coarse, deterministic).
      const skillCounts = new Map<string, number>();
      for (const s of skills) skillCounts.set(s, (skillCounts.get(s) || 0) + 1);
      const topSkills = [...skillCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 8);
      const topics = dedupe([...topSkills, ...entities.slice(0, 8)]).slice(0, max);

      // companiesDiscussed = entities that look org-like (>=2 words or known suffixes).
      const companies = dedupe(entities.filter((e) => /\b(Inc|LLC|Corp|Technologies|Labs|Systems|AI|Software)\b/i.test(e))).slice(0, max);

      return {
        topics,
        questionsAsked: dedupe(questions).slice(0, max),
        decisions: dedupe(decisions).slice(0, max),
        actionItems: dedupe(actions).slice(0, max),
        risks: dedupe(risks).slice(0, max),
        entities: dedupe(entities).slice(0, max),
        skillsDiscussed: dedupe(topSkills).slice(0, max),
        companiesDiscussed: companies,
      };
    } catch {
      return empty;
    }
  }
}

export interface BuildMeetingRecordInput {
  meetingId: string;
  segments: MeetingTranscriptSegment[];
  mode?: string;
  startedAt?: number;
  endedAt?: number;
}

/**
 * MeetingMemoryService — turns a finished transcript into the spec's structured
 * MeetingRecord. Pure + deterministic; the post-meeting background path can call this
 * without blocking or competing with live answering. Never throws.
 */
export class MeetingMemoryService {
  private readonly extractor = new MeetingInsightExtractor();

  buildMeetingRecord(input: BuildMeetingRecordInput): MeetingRecord {
    const segments = Array.isArray(input.segments) ? input.segments : [];
    const insights = this.extractor.extract(segments);

    const participants = dedupe(segments.map((s) => (s?.speaker || '').trim()).filter(Boolean));
    const cleanTranscript = segments
      .map((s) => { const t = cleanLine(s?.text || ''); return t ? `${s.speaker || 'speaker'}: ${t}` : ''; })
      .filter(Boolean)
      .join('\n');

    // Coarse source quality: more turns + presence of structure → higher.
    const turns = segments.length;
    const structureScore = (insights.questionsAsked.length > 0 ? 0.3 : 0) + (insights.decisions.length > 0 ? 0.2 : 0) + (insights.actionItems.length > 0 ? 0.2 : 0) + (insights.risks.length > 0 ? 0.1 : 0);
    const sourceQuality = Math.max(0, Math.min(1, Math.min(turns / 20, 0.3) + structureScore));

    return {
      meetingId: input.meetingId,
      mode: input.mode,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      participants,
      cleanTranscript,
      sourceQuality,
      ...insights,
    };
  }
}
