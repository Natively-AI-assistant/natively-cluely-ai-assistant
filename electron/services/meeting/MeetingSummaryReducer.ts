import * as crypto from 'crypto';
import type {
  ActionItem,
  ChunkMeetingAtoms,
  DecisionItem,
  MeetingModeSectionInput,
  MeetingNoteSection,
  MeetingSummaryGenerationMeta,
  MeetingSummaryModeMeta,
  MeetingSummaryV3,
  NormalizedTranscript,
  NoteBlock,
  NoteBullet,
  PersonMention,
  QuestionItem,
  RiskItem,
  TimelineItem,
} from './types';

export interface ReduceParams {
  title?: string;
  atoms: ChunkMeetingAtoms[];
  normalizedTranscript: NormalizedTranscript;
  modeTemplateType?: string | null;
  modeNoteSections?: MeetingModeSectionInput[];
  transcriptCoverage?: number;
  mode?: MeetingSummaryModeMeta;
  generation?: Partial<MeetingSummaryGenerationMeta>;
}

export class MeetingSummaryReducer {
  reduce(params: ReduceParams): MeetingSummaryV3 {
    const atoms = [...params.atoms].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const decisions = assignIds(mergeSimilar(flatMap(atoms, atom => atom.decisions), 'decision')) as DecisionItem[];
    const actionItems = assignIds(mergeSimilar(flatMap(atoms, atom => [...atom.actionItems, ...(atom.deadlines || [])]), 'action')) as ActionItem[];
    const openQuestions = assignIds(mergeSimilar(flatMap(atoms, atom => atom.openQuestions), 'question')) as QuestionItem[];
    const risks = assignIds(mergeSimilar(flatMap(atoms, atom => atom.risks), 'risk')) as RiskItem[];
    const topics = dedupeStrings(flatMap(atoms, atom => atom.topics)).slice(0, 20);
    const people = mergePeople(flatMap(atoms, atom => atom.people)).slice(0, 20);
    const sections = buildSections(params.modeNoteSections || [], atoms);
    const timeline = buildTimeline(atoms, decisions, actionItems, risks);
    // "Summary" (rendered at the top of the notes) = outcome-first, grounded, no filler.
    const tldr = buildSummary(decisions, actionItems, risks, atoms, sections);
    const whatChanged = buildWhatChanged(atoms, decisions).slice(0, 6);
    const overview = buildOverview(tldr, atoms, decisions);
    const actionConfidence = deriveActionConfidence(actionItems);
    const transcriptCoverage = Math.max(0, Math.min(1, typeof params.transcriptCoverage === 'number' ? params.transcriptCoverage : (params.normalizedTranscript.totalChars > 0 ? 1 : 0)));
    const warnings = [...params.normalizedTranscript.qualityWarnings];
    const atomWarnings = dedupeStrings(flatMap(atoms, atom => atom.sourceQualityWarnings || []));
    warnings.push(...atomWarnings);
    if (atoms.length === 0) warnings.push('No summary atoms were produced; notes may be incomplete.');

    const generation: MeetingSummaryGenerationMeta = {
      strategy: params.generation?.strategy || (atoms.length > 1 ? 'map_reduce' : 'direct'),
      ...(params.generation?.provider ? { provider: params.generation.provider } : {}),
      ...(params.generation?.model ? { model: params.generation.model } : {}),
      startedAt: params.generation?.startedAt || new Date(0).toISOString(),
      ...(params.generation?.completedAt ? { completedAt: params.generation.completedAt } : {}),
      ...(typeof params.generation?.durationMs === 'number' ? { durationMs: params.generation.durationMs } : {}),
      chunkCount: params.generation?.chunkCount ?? atoms.length,
      warnings: params.generation?.warnings || [],
    };

    const summary: MeetingSummaryV3 = {
      schemaVersion: 3,
      title: params.title || 'Meeting Notes',
      tldr,
      overview,
      whatChanged,
      decisions,
      actionItems,
      openQuestions,
      risks,
      sections,
      timeline,
      people,
      topics,
      sourceQuality: {
        transcriptCoverage,
        speakerQuality: params.normalizedTranscript.speakerQuality,
        actionItemConfidence: actionConfidence,
        warnings: dedupeStrings(warnings),
      },
      mode: params.mode || {},
      generation,
      noteBlocks: buildNoteBlocks({ tldr, whatChanged, decisions, actionItems, openQuestions, risks, sections }),
    };

    return summary;
  }
}

function flatMap<T>(atoms: ChunkMeetingAtoms[], mapper: (atom: ChunkMeetingAtoms) => T[]): T[] {
  return atoms.flatMap(mapper).filter(Boolean);
}

function buildSections(modeSections: MeetingModeSectionInput[], atoms: ChunkMeetingAtoms[]): MeetingNoteSection[] {
  const sectionMap = new Map<string, { title: string; bullets: NoteBullet[]; order: number }>();
  const titleCounts = new Map<string, number>();
  let orderCounter = 0;

  const ensure = (title: string) => {
    const idBase = slugify(title || 'notes');
    const count = titleCounts.get(idBase) || 0;
    titleCounts.set(idBase, count + 1);
    const id = count === 0 ? idBase : `${idBase}_${count + 1}`;
    if (!sectionMap.has(id)) sectionMap.set(id, { title, bullets: [], order: orderCounter++ });
    return id;
  };

  for (const section of modeSections) ensure(section.title);

  // Only route findings into PRE-DECLARED mode sections — the validator already drops
  // invented keys, but this is a second guard so the output never contains a section the
  // user's template didn't define.
  const allowedIds = new Set(sectionMap.keys());
  for (const atom of atoms) {
    for (const [title, findings] of Object.entries(atom.modeSpecificFindings || {})) {
      const matching = [...sectionMap.entries()].find(([, s]) => normalize(s.title) === normalize(title));
      const id = matching?.[0];
      if (!id || !allowedIds.has(id)) continue;
      const section = sectionMap.get(id)!;
      for (const finding of findings) {
        const text = typeof finding === 'string' ? finding : finding?.text;
        if (!text || section.bullets.some(b => similar(b.text, text))) continue;
        const evidence = (finding && typeof finding === 'object') ? finding.evidence : undefined;
        const confidence = (finding && typeof finding === 'object' && finding.confidence) ? finding.confidence : 'medium';
        section.bullets.push({ id: `bullet_${crypto.randomUUID()}`, text, ...(evidence?.length ? { evidence } : {}), confidence });
      }
    }
  }

  return [...sectionMap.entries()]
    .map(([id, section]) => ({ id, title: section.title, bullets: section.bullets.slice(0, 20), order: section.order }))
    .filter(section => section.bullets.length > 0)
    .sort((a, b) => a.order - b.order);
}

function buildTimeline(atoms: ChunkMeetingAtoms[], decisions: DecisionItem[], actionItems: ActionItem[], risks: RiskItem[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const atom of atoms) {
    if (atom.brief) items.push({ id: `moment_${atom.chunkIndex}`, timestampMs: atom.timeRange.startMs, title: atom.brief, type: 'topic_shift' });
  }
  for (const decision of decisions) items.push({ id: `decision_${decision.id || crypto.randomUUID()}`, timestampMs: decision.timestampMs, title: decision.text, type: 'decision', evidence: decision.evidence });
  for (const action of actionItems) items.push({ id: `action_${action.id || crypto.randomUUID()}`, timestampMs: action.sourceTimestampMs, title: action.text, type: 'action_item', evidence: action.evidence });
  for (const risk of risks) items.push({ id: `risk_${risk.id || crypto.randomUUID()}`, timestampMs: risk.evidence?.[0]?.timestampMs, title: risk.text, type: 'risk', evidence: risk.evidence });
  return items.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)).slice(0, 20);
}

function buildWhatChanged(atoms: ChunkMeetingAtoms[], decisions: DecisionItem[]): string[] {
  // "What changed" = concrete outcomes: confirmed decisions + chunk briefs that describe a shift.
  const candidates: string[] = [];
  candidates.push(...decisions.slice(0, 3).map(d => d.text));
  candidates.push(...atoms.map(a => a.brief).filter(Boolean));
  return dedupeStrings(candidates).slice(0, 6);
}

// Outcome-first Summary, built deterministically from the already-grounded reduced content.
// 3–5 lines: purpose → key decisions → most important next step → top risk (only if nothing
// else carried the meeting). Zero new information. Returns [] (empty Summary) rather than
// boilerplate when there is genuinely no grounded outcome — honest beats filler.
function buildSummary(decisions: DecisionItem[], actionItems: ActionItem[], risks: RiskItem[], atoms: ChunkMeetingAtoms[], sections: MeetingNoteSection[]): string[] {
  const out: string[] = [];
  const purpose = atoms.map(a => a.brief).find(Boolean) || sections.find(s => s.bullets.length)?.bullets[0]?.text;
  if (purpose) out.push(purpose);
  out.push(...decisions.slice(0, 2).map(d => d.text));
  const a = actionItems[0];
  if (a) out.push(`${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` by ${a.deadline}` : ''}`);
  if (out.length < 2 && risks[0]) out.push(risks[0].text);
  return dedupeStrings(out).slice(0, 5);
}

// Deterministic whole-meeting overview paragraph (fallback when LLM polish is off/unavailable).
// Stitches the chunk briefs (the chronological arc of the meeting) into a paragraph, then
// folds in the headline decisions so it reads as a quick recap of the ENTIRE meeting rather
// than just the first two summary bullets. Capped to ~400 words.
function buildOverview(summary: string[], atoms: ChunkMeetingAtoms[], decisions: DecisionItem[]): string {
  const briefs = dedupeStrings(atoms.map(a => a.brief).filter(Boolean));
  const parts: string[] = [];
  if (briefs.length) parts.push(briefs.join(' '));
  else if (summary.length) parts.push(summary.join(' '));
  const topDecisions = decisions.slice(0, 3).map(d => d.text);
  if (topDecisions.length) parts.push(`Key decisions: ${topDecisions.join('; ')}.`);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const words = text.split(/\s+/);
  return words.length > 400 ? words.slice(0, 400).join(' ') : text;
}

// Deterministic follow-up body (fallback used when the LLM follow-up generator is
// unavailable or scope-denied). Kept exported so FollowUpDraftGenerator can reuse it.
// Mode-aware: salutation, opening, section labels and sign-off match the meeting mode
// so an offline draft still reads correctly for its audience (a sales prospect, a
// candidate, an internal team, a study recap, etc.) rather than always "Hi team,".
export function buildFollowUpBody(decisions: DecisionItem[], actionItems: ActionItem[], mode?: string | null): string {
  // Per-mode scaffold: [salutation, opening, decisionsLabel, nextStepsLabel, emptyLine, signoff]
  // A null salutation/sign-off means "omit" (study notes, interviewer feedback).
  const S: Record<string, { salutation: string | null; opening: string; decisionsLabel: string; nextStepsLabel: string; empty: string; signoff: string | null }> = {
    general:              { salutation: 'Hi team,',            opening: 'Thanks for the conversation.',           decisionsLabel: 'Decisions confirmed:', nextStepsLabel: 'Next steps:',        empty: 'No explicit decisions or action items were captured.', signoff: 'Best,' },
    sales:                { salutation: 'Hi there,',           opening: 'Thanks for taking the time to meet today.', decisionsLabel: 'What we aligned on:',  nextStepsLabel: 'Next steps:',        empty: 'It was great connecting — I\'ll follow up with next steps shortly.', signoff: 'Best regards,' },
    // Recruiting omits the decisions block from the deterministic fallback entirely:
    // negative-hiring decisions or Concerns would be leaked to the candidate if rendered.
    recruiting:           { salutation: 'Hi there,',           opening: 'Thank you for taking the time to speak with us today.', decisionsLabel: '',                       nextStepsLabel: 'What happens next:',  empty: 'Thanks again — we\'ll be in touch about next steps soon.', signoff: 'Best,' },
    'team-meet':          { salutation: 'Hi team,',            opening: 'Quick recap from our sync:',             decisionsLabel: 'Decisions:',           nextStepsLabel: 'Owners & next steps:', empty: 'No decisions or action items were captured this time.', signoff: 'Thanks,' },
    'looking-for-work':   { salutation: 'Dear interviewer,',   opening: 'Thank you for taking the time to speak with me today.', decisionsLabel: 'What we discussed:',   nextStepsLabel: 'Next steps:',        empty: 'Thank you again for the conversation — I really enjoyed it.', signoff: 'Best regards,' },
    'technical-interview':{ salutation: null,                  opening: 'Interview debrief:',                     decisionsLabel: 'Assessment:',          nextStepsLabel: 'Recommended next step:', empty: 'No decisions were recorded during the session.', signoff: null },
    lecture:              { salutation: null,                  opening: 'Study recap:',                           decisionsLabel: 'Key points:',          nextStepsLabel: 'To review:',         empty: 'No key points were captured.', signoff: null },
  };
  const p = (mode && S[mode]) || S.general;

  const lines: string[] = [];
  if (p.salutation) lines.push(p.salutation, '');
  lines.push(p.opening);
  if (decisions.length > 0 && p.decisionsLabel) {
    lines.push('', p.decisionsLabel, ...decisions.slice(0, 5).map(item => `- ${item.text}`));
  }
  if (actionItems.length > 0) {
    lines.push('', p.nextStepsLabel, ...actionItems.slice(0, 8).map(item => {
      const owner = item.owner ? `${item.owner}: ` : '';
      const deadline = item.deadline ? ` by ${item.deadline}` : '';
      const inferred = item.explicitness === 'inferred' ? ' (inferred)' : '';
      return `- ${owner}${item.text}${deadline}${inferred}`;
    }));
  }
  if (decisions.length === 0 && actionItems.length === 0) lines.push('', p.empty);
  if (p.signoff) lines.push('', p.signoff);
  return lines.join('\n');
}

function buildNoteBlocks(params: { tldr: string[]; whatChanged: string[]; decisions: DecisionItem[]; actionItems: ActionItem[]; openQuestions: QuestionItem[]; risks: RiskItem[]; sections: MeetingNoteSection[] }): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  if (params.tldr.length) {
    blocks.push({ type: 'heading', text: 'Summary' });
    params.tldr.forEach(text => blocks.push({ type: 'bullet', text }));
  }
  if (params.whatChanged.length) {
    blocks.push({ type: 'heading', text: 'What changed' });
    params.whatChanged.forEach(text => blocks.push({ type: 'bullet', text }));
  }
  if (params.decisions.length) {
    blocks.push({ type: 'heading', text: 'Decisions' });
    params.decisions.forEach(item => blocks.push({ type: 'decision', item }));
  }
  if (params.actionItems.length) {
    blocks.push({ type: 'heading', text: 'Action Items' });
    params.actionItems.forEach(item => blocks.push({ type: 'action', item }));
  }
  if (params.openQuestions.length) {
    blocks.push({ type: 'heading', text: 'Open Questions' });
    params.openQuestions.forEach(item => blocks.push({ type: 'question', item }));
  }
  if (params.risks.length) {
    blocks.push({ type: 'heading', text: 'Risks / Blockers' });
    params.risks.forEach(item => blocks.push({ type: 'risk', item }));
  }
  for (const section of params.sections) {
    blocks.push({ type: 'heading', text: section.title });
    section.bullets.forEach(bullet => blocks.push({ type: 'bullet', text: bullet.text, evidence: bullet.evidence }));
  }
  return blocks;
}

function mergeSimilar<T extends { text: string; evidence?: any[] }>(items: T[], kind: string): T[] {
  const merged: T[] = [];
  for (const item of items) {
    const existing = merged.find(other => similar(other.text, item.text));
    if (!existing) {
      merged.push({ ...item });
      continue;
    }
    existing.evidence = [...(existing.evidence || []), ...(item.evidence || [])].slice(0, 4);
    if (kind === 'action') {
      const e = existing as any;
      const i = item as any;
      if (!e.owner && i.owner) e.owner = i.owner;
      if (!e.deadline && i.deadline) e.deadline = i.deadline;
      if (e.explicitness !== 'explicit' && i.explicitness === 'explicit') e.explicitness = 'explicit';
      if (confidenceRank(i.confidence) > confidenceRank(e.confidence)) e.confidence = i.confidence;
    }
  }
  return merged;
}

function assignIds<T extends { id?: string; text: string }>(items: T[]): T[] {
  return items.map(item => ({ ...item, id: item.id || `${slugify(item.text).slice(0, 24)}_${crypto.randomUUID().slice(0, 8)}` }));
}

function mergePeople(people: PersonMention[]): PersonMention[] {
  const byName = new Map<string, PersonMention>();
  for (const person of people) {
    const name = (person.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) byName.set(key, { ...person, mentions: person.mentions || 1 });
    else existing.mentions = (existing.mentions || 1) + (person.mentions || 1);
  }
  return [...byName.values()].sort((a, b) => (b.mentions || 0) - (a.mentions || 0));
}

function deriveActionConfidence(actions: ActionItem[]): 'high' | 'medium' | 'low' {
  if (actions.length === 0) return 'low';
  const explicit = actions.filter(a => a.explicitness === 'explicit').length;
  const withEvidence = actions.filter(a => a.evidence?.length).length;
  if (explicit / actions.length >= 0.75 && withEvidence / actions.length >= 0.75) return 'high';
  if (explicit / actions.length >= 0.4 || withEvidence / actions.length >= 0.4) return 'medium';
  return 'low';
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values.map(v => (v || '').trim()).filter(Boolean)) {
    if (!out.some(existing => similar(existing, value))) out.push(value);
  }
  return out;
}

function similar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aWords = new Set(na.split(' '));
  const bWords = new Set(nb.split(' '));
  const shared = [...aWords].filter(w => bWords.has(w)).length;
  const smaller = Math.min(aWords.size, bWords.size) || 1;
  return shared / smaller >= 0.8;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\b(the|a|an|to|for|and|or|of|in|on|by|with|from)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return (value || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
}

function confidenceRank(value: string): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}
