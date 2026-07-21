// MeetingSummaryV3.ts
// Canonical, spec-aligned schema for Natively post-meeting notes (Phase 5).
//
// This is the single source of truth for the MeetingSummaryV3 shape and its runtime
// validation/repair. It deliberately uses a hand-written validator (no new dependency)
// that mirrors the repo's existing defensive-coercion convention. The validator never
// throws and always returns a usable result or a clear `ok:false` so the caller can fall
// back safely.
//
// Privacy: this module only shapes/validates data. It performs no I/O, no telemetry, and
// no network calls. Evidence quotes live only inside the note object (stored locally).

export type Confidence = 'high' | 'medium' | 'low';

export type SummaryStatus =
  | 'queued'
  | 'chunking'
  | 'summarizing_chunks'
  | 'reducing'
  | 'validating'
  | 'completed'
  | 'failed';

export type SummaryStrategy = 'direct' | 'map_reduce' | 'long_context' | 'fallback';

export interface EvidenceRef {
  speakerId?: string;
  speakerName?: string;
  timestampMs?: number;
  quote?: string;
  segmentId?: string;
}

export interface NoteBullet {
  id?: string;
  text: string;
  evidence?: EvidenceRef[];
  confidence?: Confidence;
}

export interface MeetingNoteSection {
  id: string;
  title: string;
  bullets: NoteBullet[];
  order: number;
}

export interface DecisionItem {
  id?: string;
  text: string;
  owner?: string;
  timestampMs?: number;
  evidence?: EvidenceRef[];
  confidence: Confidence;
}

export interface ActionItem {
  id?: string;
  text: string;
  owner?: string;
  deadline?: string;
  sourceTimestampMs?: number;
  explicitness: 'explicit' | 'inferred';
  evidence?: EvidenceRef[];
  confidence: Confidence;
  status?: 'open' | 'done' | 'deferred';
}

export interface QuestionItem {
  id?: string;
  text: string;
  owner?: string;
  status: 'open' | 'answered' | 'deferred';
  evidence?: EvidenceRef[];
  confidence?: Confidence;
}

export interface RiskItem {
  id?: string;
  text: string;
  severity: 'low' | 'medium' | 'high';
  evidence?: EvidenceRef[];
  confidence?: Confidence;
}

export type FollowUpDraftType =
  | 'email'
  | 'slack'
  | 'project_update'
  | 'crm_note'
  | 'study_notes'
  | 'interview_feedback';

export type FollowUpTone = 'professional' | 'warm' | 'concise' | 'friendly';

export interface FollowUpDraft {
  type: FollowUpDraftType;
  subject?: string;
  body: string;
  tone: FollowUpTone;
  basedOnActionItemIds?: string[];
  basedOnDecisionIds?: string[];
}

export type TimelineItemType = 'topic_shift' | 'decision' | 'action_item' | 'risk' | 'question';

export interface TimelineItem {
  id?: string;
  timestampMs?: number;
  title: string;
  description?: string;
  type: TimelineItemType;
  evidence?: EvidenceRef[];
}

export interface PersonMention {
  speakerId?: string;
  name?: string;
  role?: string;
  organization?: string;
  mentions?: number;
  confidence?: Confidence;
}

export interface SourceQuality {
  transcriptCoverage: number; // 0..1
  speakerQuality: 'good' | 'mixed' | 'poor';
  actionItemConfidence: Confidence;
  warnings: string[];
}

// Per-meeting map of canonical speaker id → user-assigned display name.
// e.g. { "speaker_1": "John from Client", "speaker_2": "Sarah, PM" }
// "me" is reserved for the local user and is renameable too.
export type SpeakerLabelMap = Record<string, string>;

export interface MeetingSummaryModeMeta {
  selectedModeId?: string;
  selectedModeName?: string;
  selectedTemplateType?: string;
  detectedModeId?: string;
  detectedModeName?: string;
  detectedConfidence?: number;
  summaryModeUsed?: string;
}

export interface MeetingSummaryGenerationMeta {
  strategy: SummaryStrategy;
  provider?: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  chunkCount?: number;
  warnings: string[];
}

// Render/back-compat helper block (additive; not part of the strict spec but kept so the
// UI can render typed blocks and copy/export without re-deriving structure).
export type NoteBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string; evidence?: EvidenceRef[] }
  | { type: 'action'; item: ActionItem }
  | { type: 'decision'; item: DecisionItem }
  | { type: 'question'; item: QuestionItem }
  | { type: 'risk'; item: RiskItem }
  | { type: 'quote'; text: string; speaker?: string; timestampMs?: number };

export interface MeetingSummaryV3 {
  schemaVersion: 3;
  title: string;
  tldr: string[];
  overview: string;
  whatChanged: string[];
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  openQuestions: QuestionItem[];
  risks: RiskItem[];
  sections: MeetingNoteSection[];
  followUpDraft?: FollowUpDraft;
  timeline?: TimelineItem[];
  people?: PersonMention[];
  topics?: string[];
  sourceQuality: SourceQuality;
  mode: MeetingSummaryModeMeta;
  generation: MeetingSummaryGenerationMeta;
  // Additive render/export helpers:
  noteBlocks?: NoteBlock[];
  recipes?: Record<string, string>;
}

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors: string[];
  repaired: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coercion primitives
// ─────────────────────────────────────────────────────────────────────────────

const NUL_RE = /\x00/g;
const FENCE_RE = /```/g;
const FILLER_RE = /\b(the meeting discussed|covered various|talked about various|various topics|the conversation covered)\b/i;
const VALID_CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low']);
const VALID_EXPLICITNESS = new Set(['explicit', 'inferred']);
const VALID_QUESTION_STATUS = new Set(['open', 'answered', 'deferred']);
const VALID_ACTION_STATUS = new Set(['open', 'done', 'deferred']);
const VALID_RISK_SEVERITY = new Set(['low', 'medium', 'high']);
const VALID_TIMELINE_TYPE = new Set<TimelineItemType>(['topic_shift', 'decision', 'action_item', 'risk', 'question']);
const VALID_FOLLOWUP_TYPE = new Set<FollowUpDraftType>(['email', 'slack', 'project_update', 'crm_note', 'study_notes', 'interview_feedback']);
const VALID_FOLLOWUP_TONE = new Set<FollowUpTone>(['professional', 'warm', 'concise', 'friendly']);

export function cleanString(value: unknown): string {
  return String(value ?? '').replace(NUL_RE, '').replace(/\s+/g, ' ').trim();
}

export function cleanNoteText(value: unknown, max = 240): string {
  return cleanString(value).replace(FENCE_RE, '').replace(FILLER_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeConfidence(value: unknown): Confidence {
  return VALID_CONFIDENCE.has(value as Confidence) ? (value as Confidence) : 'medium';
}

function inferSeverity(value: unknown): RiskItem['severity'] {
  const text = cleanString(value).toLowerCase();
  if (/\b(blocked|critical|security|legal|cannot|won't|miss deadline|outage)\b/.test(text)) return 'high';
  if (/\b(risk|concern|delay|budget|slip|unclear|dependency)\b/.test(text)) return 'medium';
  return 'low';
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\b(the|a|an|to|for|and|or|of|in|on|by)\b/g, '').replace(/\s+/g, ' ').trim();
}

function cleanId(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'section';
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Field coercers. Each accepts loose input (LLM JSON, legacy rows) and a mutable
// `track` flag set to true whenever a value had to be coerced/dropped.
// ─────────────────────────────────────────────────────────────────────────────

interface Track { repaired: boolean; }

export function sanitizeEvidenceArray(value: unknown, max: number): EvidenceRef[] {
  return arr(value)
    .map((item: any) => {
      // Accept both new (timestampMs, speakerId/speakerName) and legacy (timestamp, speaker).
      const ts = num(item?.timestampMs) ?? num(item?.timestamp);
      const speakerName = item?.speakerName ?? item?.speaker;
      const ref: EvidenceRef = {
        ...(item?.speakerId ? { speakerId: cleanString(item.speakerId).slice(0, 80) } : {}),
        ...(speakerName ? { speakerName: cleanString(speakerName).slice(0, 80) } : {}),
        ...(ts !== undefined ? { timestampMs: ts } : {}),
        ...(item?.quote ? { quote: cleanString(item.quote).slice(0, 220) } : {}),
        ...(item?.segmentId ? { segmentId: cleanString(item.segmentId).slice(0, 80) } : {}),
      };
      return ref;
    })
    .filter((e: EvidenceRef) => e.speakerId || e.speakerName || typeof e.timestampMs === 'number' || e.quote || e.segmentId)
    .slice(0, max);
}

export function sanitizeStringArray(value: unknown, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr(value)) {
    const cleaned = cleanNoteText(item);
    if (!cleaned || FILLER_RE.test(cleaned)) continue;
    const key = normalizedKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function dedupeByText<T extends { text: string }>(items: T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = normalizedKey(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeDecisions(value: unknown, max: number, t?: Track): DecisionItem[] {
  return dedupeByText(arr(value).map((item: any) => {
    const ts = num(item?.timestampMs) ?? num(item?.timestamp);
    return {
      text: cleanNoteText(typeof item === 'string' ? item : item?.text),
      ...(item?.owner ? { owner: cleanString(item.owner).slice(0, 80) } : {}),
      ...(ts !== undefined ? { timestampMs: ts } : {}),
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
      confidence: normalizeConfidence(item?.confidence),
    } as DecisionItem;
  }).filter((d: DecisionItem) => d.text), max);
}

export function sanitizeActions(value: unknown, max: number, t?: Track): ActionItem[] {
  return dedupeByText(arr(value).map((item: any) => {
    const ts = num(item?.sourceTimestampMs) ?? num(item?.sourceTimestamp);
    return {
      text: cleanNoteText(typeof item === 'string' ? item : item?.text),
      ...(item?.owner ? { owner: cleanString(item.owner).slice(0, 80) } : {}),
      ...(item?.deadline ? { deadline: cleanString(item.deadline).slice(0, 80) } : {}),
      ...(ts !== undefined ? { sourceTimestampMs: ts } : {}),
      explicitness: VALID_EXPLICITNESS.has(item?.explicitness) ? item.explicitness : 'inferred',
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
      confidence: normalizeConfidence(item?.confidence),
      ...(VALID_ACTION_STATUS.has(item?.status) ? { status: item.status } : {}),
    } as ActionItem;
  }).filter((a: ActionItem) => a.text), max);
}

export function sanitizeQuestions(value: unknown, max: number): QuestionItem[] {
  return dedupeByText(arr(value).map((item: any) => ({
    text: cleanNoteText(typeof item === 'string' ? item : item?.text),
    ...(item?.owner ? { owner: cleanString(item.owner).slice(0, 80) } : {}),
    status: VALID_QUESTION_STATUS.has(item?.status) ? item.status : 'open',
    evidence: sanitizeEvidenceArray(item?.evidence, 3),
    ...(item?.confidence ? { confidence: normalizeConfidence(item.confidence) } : {}),
  } as QuestionItem)).filter((q: QuestionItem) => q.text), max);
}

export function sanitizeRisks(value: unknown, max: number): RiskItem[] {
  return dedupeByText(arr(value).map((item: any) => ({
    text: cleanNoteText(typeof item === 'string' ? item : item?.text),
    severity: VALID_RISK_SEVERITY.has(item?.severity) ? item.severity : inferSeverity(item?.text),
    evidence: sanitizeEvidenceArray(item?.evidence, 3),
    ...(item?.confidence ? { confidence: normalizeConfidence(item.confidence) } : {}),
  } as RiskItem)).filter((r: RiskItem) => r.text), max);
}

function sanitizeBullets(value: unknown, max: number): NoteBullet[] {
  return arr(value).map((item: any) => {
    const text = typeof item === 'string' ? item : item?.text;
    return {
      ...(item?.id ? { id: cleanString(item.id).slice(0, 80) } : {}),
      text: cleanNoteText(text),
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
      ...(item?.confidence ? { confidence: normalizeConfidence(item.confidence) } : {}),
    } as NoteBullet;
  }).filter((b: NoteBullet) => b.text).slice(0, max);
}

function sanitizeSections(value: unknown, max: number): MeetingNoteSection[] {
  return arr(value).map((section: any, index: number) => ({
    id: cleanId(section?.id || section?.title || `section_${index}`),
    title: cleanString(section?.title || `Section ${index + 1}`),
    bullets: sanitizeBullets(section?.bullets, 30),
    order: num(section?.order) ?? index,
  })).filter((s: MeetingNoteSection) => s.title && s.bullets.length > 0)
    .sort((a, b) => a.order - b.order)
    .slice(0, max);
}

function sanitizePeople(value: unknown, max: number): PersonMention[] {
  return arr(value).map((p: any) => ({
    ...(p?.speakerId ? { speakerId: cleanString(p.speakerId).slice(0, 80) } : {}),
    ...(p?.name ? { name: cleanString(p.name).slice(0, 80) } : {}),
    ...(p?.role ? { role: cleanString(p.role).slice(0, 80) } : {}),
    ...(p?.organization ? { organization: cleanString(p.organization).slice(0, 80) } : {}),
    ...(num(p?.mentions) !== undefined ? { mentions: num(p.mentions) } : {}),
    ...(p?.confidence ? { confidence: normalizeConfidence(p.confidence) } : {}),
  } as PersonMention)).filter((p: PersonMention) => p.name || p.speakerId).slice(0, max);
}

function sanitizeTimeline(value: unknown, max: number): TimelineItem[] {
  return arr(value).map((item: any, index: number) => {
    const ts = num(item?.timestampMs) ?? num(item?.timestamp);
    return {
      ...(item?.id ? { id: cleanId(item.id) } : { id: `moment_${index}` }),
      ...(ts !== undefined ? { timestampMs: ts } : {}),
      title: cleanNoteText(item?.title, 160),
      ...(item?.description ? { description: cleanNoteText(item.description, 260) } : {}),
      type: VALID_TIMELINE_TYPE.has(item?.type) ? item.type : 'topic_shift',
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
    } as TimelineItem;
  }).filter((item: TimelineItem) => item.title).slice(0, max);
}

export function sanitizeFollowUpDraft(value: unknown): FollowUpDraft | undefined {
  if (!value) return undefined;
  // Legacy: a plain string body.
  if (typeof value === 'string') {
    const body = cleanString(value);
    if (!body) return undefined;
    return { type: 'email', body: value.trim(), tone: 'professional' };
  }
  if (typeof value !== 'object') return undefined;
  const raw = value as any;
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body) return undefined;
  return {
    type: VALID_FOLLOWUP_TYPE.has(raw.type) ? raw.type : 'email',
    ...(raw.subject ? { subject: cleanString(raw.subject).slice(0, 160) } : {}),
    body: body.slice(0, 4000),
    tone: VALID_FOLLOWUP_TONE.has(raw.tone) ? raw.tone : 'professional',
    ...(Array.isArray(raw.basedOnActionItemIds) ? { basedOnActionItemIds: raw.basedOnActionItemIds.map((x: any) => cleanString(x)).filter(Boolean).slice(0, 50) } : {}),
    ...(Array.isArray(raw.basedOnDecisionIds) ? { basedOnDecisionIds: raw.basedOnDecisionIds.map((x: any) => cleanString(x)).filter(Boolean).slice(0, 50) } : {}),
  };
}

function sanitizeMode(value: unknown): MeetingSummaryModeMeta {
  const raw = (value && typeof value === 'object') ? value as any : {};
  const conf = num(raw.detectedConfidence);
  return {
    ...(raw.selectedModeId ? { selectedModeId: cleanString(raw.selectedModeId).slice(0, 80) } : {}),
    ...(raw.selectedModeName ? { selectedModeName: cleanString(raw.selectedModeName).slice(0, 80) } : {}),
    ...(raw.selectedTemplateType ? { selectedTemplateType: cleanString(raw.selectedTemplateType).slice(0, 80) } : {}),
    ...(raw.detectedModeId ? { detectedModeId: cleanString(raw.detectedModeId).slice(0, 80) } : {}),
    ...(raw.detectedModeName ? { detectedModeName: cleanString(raw.detectedModeName).slice(0, 80) } : {}),
    ...(conf !== undefined ? { detectedConfidence: clamp(conf, 0, 1) } : {}),
    ...(raw.summaryModeUsed ? { summaryModeUsed: cleanString(raw.summaryModeUsed).slice(0, 80) } : {}),
  };
}

function sanitizeGeneration(value: unknown): MeetingSummaryGenerationMeta {
  const raw = (value && typeof value === 'object') ? value as any : {};
  const validStrategy = new Set<SummaryStrategy>(['direct', 'map_reduce', 'long_context', 'fallback']);
  return {
    strategy: validStrategy.has(raw.strategy) ? raw.strategy : 'fallback',
    ...(raw.provider ? { provider: cleanString(raw.provider).slice(0, 80) } : {}),
    ...(raw.model ? { model: cleanString(raw.model).slice(0, 120) } : {}),
    startedAt: typeof raw.startedAt === 'string' && raw.startedAt ? raw.startedAt : new Date(0).toISOString(),
    ...(raw.completedAt ? { completedAt: cleanString(raw.completedAt) } : {}),
    ...(num(raw.durationMs) !== undefined ? { durationMs: num(raw.durationMs) } : {}),
    ...(num(raw.chunkCount) !== undefined ? { chunkCount: num(raw.chunkCount) } : {}),
    warnings: sanitizeStringArray(raw.warnings, 12),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: validate + repair a full MeetingSummaryV3.
// ─────────────────────────────────────────────────────────────────────────────

export function validateMeetingSummaryV3(value: unknown): ValidationResult<MeetingSummaryV3> {
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: ['summary is not an object'], repaired: false };
  }
  const raw = value as any;
  const errors: string[] = [];

  const tldr = sanitizeStringArray(raw.tldr, 6);
  // Overview is a whole-meeting paragraph TLDR (up to ~400 words ≈ 2800 chars).
  const overview = cleanNoteText(raw.overview, 2800);
  const repairedTldr = tldr.length > 0
    ? tldr
    : overview.split(/(?<=[.!?])\s+/).map(s => cleanNoteText(s)).filter(Boolean).slice(0, 4);

  const decisions = sanitizeDecisions(raw.decisions, 40);
  const actionItems = sanitizeActions(raw.actionItems, 40);
  const openQuestions = sanitizeQuestions(raw.openQuestions, 40);
  const risks = sanitizeRisks(raw.risks, 40);
  const sections = sanitizeSections(raw.sections, 24);
  const followUpDraft = sanitizeFollowUpDraft(raw.followUpDraft);

  const summary: MeetingSummaryV3 = {
    schemaVersion: 3,
    title: cleanString(raw.title || 'Meeting Notes') || 'Meeting Notes',
    tldr: repairedTldr,
    overview,
    whatChanged: sanitizeStringArray(raw.whatChanged, 8),
    decisions,
    actionItems,
    openQuestions,
    risks,
    sections,
    ...(followUpDraft ? { followUpDraft } : {}),
    timeline: sanitizeTimeline(raw.timeline, 24),
    people: sanitizePeople(raw.people, 30),
    topics: sanitizeStringArray(raw.topics, 30),
    sourceQuality: {
      transcriptCoverage: clamp(Number(raw.sourceQuality?.transcriptCoverage ?? 0), 0, 1),
      speakerQuality: ['good', 'mixed', 'poor'].includes(raw.sourceQuality?.speakerQuality) ? raw.sourceQuality.speakerQuality : 'mixed',
      actionItemConfidence: normalizeConfidence(raw.sourceQuality?.actionItemConfidence),
      warnings: sanitizeStringArray(raw.sourceQuality?.warnings, 12),
    },
    mode: sanitizeMode(raw.mode),
    generation: sanitizeGeneration(raw.generation),
    ...(Array.isArray(raw.noteBlocks) ? { noteBlocks: raw.noteBlocks.slice(0, 120) } : {}),
    ...(raw.recipes && typeof raw.recipes === 'object'
      ? { recipes: Object.fromEntries(Object.entries(raw.recipes).map(([k, v]) => [cleanId(k), cleanString(v)]).filter(([k, v]) => k && v)) }
      : {}),
  };

  const hasStructuredContent =
    summary.decisions.length > 0 ||
    summary.actionItems.length > 0 ||
    summary.openQuestions.length > 0 ||
    summary.risks.length > 0 ||
    summary.sections.length > 0;

  const hasNarrative = Boolean(summary.overview) || summary.tldr.length > 0 || summary.whatChanged.length > 0;

  if (!hasStructuredContent && !hasNarrative) {
    errors.push('summary has no usable content');
    return { ok: false, errors, repaired: true };
  }

  return { ok: true, data: summary, errors, repaired: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Back-compat: render a legacy (pre-V3) detailedSummary as a minimal V3 view.
// Does NOT mutate or rewrite the stored row — purely for rendering/normalization.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeLegacySummary(detailed: any): MeetingSummaryV3 | null {
  if (!detailed || typeof detailed !== 'object') return null;
  if (detailed.schemaVersion === 3) {
    const res = validateMeetingSummaryV3(detailed);
    return res.ok ? res.data! : null;
  }

  const overview = cleanNoteText(detailed.overview, 600);
  const keyPoints = sanitizeStringArray(detailed.keyPoints, 12);
  const legacyActions = sanitizeStringArray(detailed.actionItems, 30);
  const legacySections = arr(detailed.sections).map((s: any, i: number) => ({
    id: cleanId(s?.title || `section_${i}`),
    title: cleanString(s?.title || `Section ${i + 1}`),
    bullets: sanitizeStringArray(s?.bullets, 30).map(text => ({ text })),
    order: i,
  })).filter((s: MeetingNoteSection) => s.title && s.bullets.length > 0);

  if (!overview && keyPoints.length === 0 && legacyActions.length === 0 && legacySections.length === 0) {
    return null;
  }

  const v3: MeetingSummaryV3 = {
    schemaVersion: 3,
    title: cleanString(detailed.title || 'Meeting Notes') || 'Meeting Notes',
    tldr: keyPoints.length > 0 ? keyPoints.slice(0, 5) : (overview ? [overview] : []),
    overview,
    whatChanged: [],
    decisions: [],
    actionItems: legacyActions.map(text => ({ text, explicitness: 'inferred' as const, confidence: 'low' as const })),
    openQuestions: [],
    risks: [],
    sections: legacySections,
    ...(sanitizeFollowUpDraft(detailed.followUpDraft) ? { followUpDraft: sanitizeFollowUpDraft(detailed.followUpDraft) } : {}),
    sourceQuality: { transcriptCoverage: 0, speakerQuality: 'mixed', actionItemConfidence: 'low', warnings: ['Rendered from a legacy summary format.'] },
    mode: {},
    generation: { strategy: 'fallback', startedAt: new Date(0).toISOString(), warnings: ['legacy'] },
  };
  return v3;
}
