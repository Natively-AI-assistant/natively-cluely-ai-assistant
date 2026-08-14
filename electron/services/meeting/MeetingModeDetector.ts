// MeetingModeDetector.ts (Phase 10)
// Lightweight, deterministic mode detection from the first minutes of a transcript plus
// optional calendar metadata. It NEVER switches the live mode — it only produces a
// suggestion stored in summary.mode.detected* so the UI can offer "regenerate as <mode>".
//
// Pure (no I/O). Keyword/signal scoring; returns the best ModeTemplateType + a 0..1
// confidence. Ties and weak signals → low confidence → general.

import type { TranscriptSegment } from '../../SessionTracker';

export type DetectableTemplateType =
  | 'general'
  | 'sales'
  | 'recruiting'
  | 'team-meet'
  | 'looking-for-work'
  | 'technical-interview'
  | 'lecture';

export interface ModeDetectionInput {
  transcript: TranscriptSegment[];
  calendarTitle?: string;
  calendarDescription?: string;
  participants?: string[];
  // Only the first N ms of transcript are weighted (defaults to 5 min).
  openingWindowMs?: number;
}

export interface ModeDetectionResult {
  templateType: DetectableTemplateType;
  confidence: number; // 0..1
  scores: Record<DetectableTemplateType, number>;
  signals: string[];
}

// Weighted keyword signals per mode. Word-boundary matched, case-insensitive.
const SIGNALS: Record<Exclude<DetectableTemplateType, 'general'>, Array<{ re: RegExp; w: number; label: string }>> = {
  sales: [
    { re: /\b(pricing|price|quote|discount)\b/i, w: 2, label: 'pricing' },
    { re: /\b(demo|trial|pilot|poc|proof of concept)\b/i, w: 2, label: 'demo/pilot' },
    { re: /\b(budget|procurement|contract|proposal|sow)\b/i, w: 2, label: 'budget/procurement' },
    { re: /\b(objection|competitor|roi|use case|stakeholder)\b/i, w: 1, label: 'sales discovery' },
    { re: /\b(close|deal|renewal|upsell|expansion)\b/i, w: 1, label: 'deal' },
  ],
  recruiting: [
    { re: /\b(candidate|applicant|resume|cv|portfolio)\b/i, w: 2, label: 'candidate' },
    { re: /\b(role|position|opening|req|hiring)\b/i, w: 1, label: 'role' },
    { re: /\b(compensation|salary|notice period|start date|relocat)\b/i, w: 2, label: 'comp/logistics' },
    { re: /\b(screen|interview stage|reference check|offer)\b/i, w: 1, label: 'interview stage' },
    { re: /\b(years of experience|background|strengths|concerns)\b/i, w: 1, label: 'evaluation' },
  ],
  'technical-interview': [
    { re: /\b(algorithm|complexity|big o|o\(n\)|time complexity)\b/i, w: 2, label: 'complexity' },
    { re: /\b(leetcode|coding|whiteboard|implement|function|array|hash map|linked list)\b/i, w: 2, label: 'coding' },
    { re: /\b(system design|scal(e|ability)|throughput|latency|database schema)\b/i, w: 2, label: 'system design' },
    { re: /\b(edge case|test case|brute force|optimi[sz]e|refactor)\b/i, w: 1, label: 'problem solving' },
  ],
  lecture: [
    { re: /\b(lecture|chapter|syllabus|exam|quiz|homework|assignment)\b/i, w: 2, label: 'course' },
    { re: /\b(theorem|formula|equation|definition|proof|derivation)\b/i, w: 2, label: 'academic' },
    { re: /\b(professor|instructor|today we'?ll cover|in this class|textbook)\b/i, w: 2, label: 'classroom' },
    { re: /\b(memorize|study|concept|example problem)\b/i, w: 1, label: 'study' },
  ],
  'team-meet': [
    { re: /\b(sprint|standup|stand-up|backlog|roadmap|retro|retrospective)\b/i, w: 2, label: 'agile' },
    { re: /\b(blocker|blocked|dependency|ticket|jira|pull request|deploy|release)\b/i, w: 2, label: 'delivery' },
    { re: /\b(action item|owner|next step|status update|since last sync)\b/i, w: 1, label: 'sync' },
    { re: /\b(team|we shipped|in progress|on track|at risk)\b/i, w: 1, label: 'team status' },
  ],
  'looking-for-work': [
    { re: /\b(tell me about yourself|why do you want|your experience|walk me through)\b/i, w: 2, label: 'interviewee' },
    { re: /\b(this role|the team|the company|the position|interview process)\b/i, w: 1, label: 'opportunity' },
    { re: /\b(my background|i worked on|i led|i built|my strengths)\b/i, w: 2, label: 'self-presentation' },
  ],
};

const TITLE_HINTS: Array<{ re: RegExp; type: DetectableTemplateType; w: number }> = [
  { re: /\b(sales|demo|discovery|pipeline|prospect)\b/i, type: 'sales', w: 3 },
  { re: /\b(interview|screen|candidate|recruit)\b/i, type: 'recruiting', w: 2 },
  { re: /\b(standup|stand-up|sprint|sync|retro|planning|1:1|one on one|team)\b/i, type: 'team-meet', w: 3 },
  { re: /\b(lecture|class|seminar|course|tutorial)\b/i, type: 'lecture', w: 3 },
  { re: /\b(coding|technical|system design|whiteboard)\b/i, type: 'technical-interview', w: 3 },
];

function emptyScores(): Record<DetectableTemplateType, number> {
  return { general: 0, sales: 0, recruiting: 0, 'team-meet': 0, 'looking-for-work': 0, 'technical-interview': 0, lecture: 0 };
}

export class MeetingModeDetector {
  detect(input: ModeDetectionInput): ModeDetectionResult {
    const windowMs = input.openingWindowMs ?? 5 * 60 * 1000;
    const scores = emptyScores();
    const signals: string[] = [];

    const segments = Array.isArray(input.transcript) ? input.transcript : [];
    const firstTs = segments.find(s => s.timestamp > 0)?.timestamp ?? 0;
    const openingText = segments
      .filter(s => !firstTs || s.timestamp === 0 || s.timestamp - firstTs <= windowMs)
      .map(s => s.text || '')
      .join('\n');
    const fullText = segments.map(s => s.text || '').join('\n');

    // Transcript signals: opening window weighted 2x, rest 1x.
    for (const [type, sigs] of Object.entries(SIGNALS) as Array<[Exclude<DetectableTemplateType, 'general'>, typeof SIGNALS['sales']]>) {
      for (const sig of sigs) {
        const inOpening = sig.re.test(openingText);
        const inFull = sig.re.test(fullText);
        if (inOpening) { scores[type] += sig.w * 2; signals.push(`${type}:${sig.label}`); }
        else if (inFull) { scores[type] += sig.w; signals.push(`${type}:${sig.label}`); }
      }
    }

    // Calendar title/description hints.
    const titleText = `${input.calendarTitle || ''} ${input.calendarDescription || ''}`;
    if (titleText.trim()) {
      for (const hint of TITLE_HINTS) {
        if (hint.re.test(titleText)) { scores[hint.type] += hint.w; signals.push(`title:${hint.type}`); }
      }
    }

    // Pick the best non-general score.
    let best: DetectableTemplateType = 'general';
    let bestScore = 0;
    let secondScore = 0;
    for (const [type, score] of Object.entries(scores) as Array<[DetectableTemplateType, number]>) {
      if (type === 'general') continue;
      if (score > bestScore) { secondScore = bestScore; bestScore = score; best = type; }
      else if (score > secondScore) { secondScore = score; }
    }

    // Confidence: needs a clear winner with enough absolute signal.
    // margin = lead over runner-up; normalize against a target of ~8 points.
    if (bestScore < 3) {
      return { templateType: 'general', confidence: 0, scores, signals: dedupe(signals) };
    }
    const margin = bestScore - secondScore;
    const confidence = clamp01((bestScore / 12) * 0.6 + (margin / 8) * 0.4);

    return { templateType: best, confidence: round2(confidence), scores, signals: dedupe(signals) };
  }
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function dedupe(arr: string[]): string[] { return [...new Set(arr)]; }
