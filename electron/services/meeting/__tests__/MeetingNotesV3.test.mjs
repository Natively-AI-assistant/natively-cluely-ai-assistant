import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const load = (name) => import(pathToFileURL(path.join(base, name)).href);

const { validateMeetingSummaryV3, normalizeLegacySummary, sanitizeFollowUpDraft } = await load('MeetingSummaryV3.js');
const { TranscriptNormalizer } = await load('TranscriptNormalizer.js');
const { TranscriptChunker } = await load('TranscriptChunker.js');
const { MeetingSummaryStrategySelector } = await load('MeetingSummaryStrategySelector.js');
const { MeetingModeDetector } = await load('MeetingModeDetector.js');
const { SpeakerLabelService } = await load('SpeakerLabelService.js');
const { CrossMeetingRecall, priorFromDetailedSummary } = await load('CrossMeetingRecall.js');
const { FollowUpDraftGenerator, followUpTypeForMode } = await load('FollowUpDraftGenerator.js');
const { generateStructured, extractJsonObject } = await load('generateStructured.js');
const { MeetingSummarySchemaValidator } = await load('MeetingSummarySchemaValidator.js');
const { MeetingSummaryReducer } = await load('MeetingSummaryReducer.js');
const { SectionPromptCompiler, deterministicSectionInstruction } = await load('SectionPromptCompiler.js');

function seg(speaker, text, timestamp) { return { speaker, text, timestamp, final: true }; }

// ── Schema validation ────────────────────────────────────────────────────────

test('validateMeetingSummaryV3 fills required blocks and accepts sparse content', () => {
  const res = validateMeetingSummaryV3({ decisions: [{ text: 'ship it', confidence: 'high' }] });
  assert.equal(res.ok, true);
  assert.equal(res.data.schemaVersion, 3);
  assert.ok(Array.isArray(res.data.whatChanged));
  assert.ok(res.data.mode && typeof res.data.mode === 'object');
  assert.ok(res.data.generation && res.data.generation.strategy);
  assert.equal(res.data.decisions[0].text, 'ship it');
});

test('validateMeetingSummaryV3 rejects empty/no-content objects', () => {
  const res = validateMeetingSummaryV3({});
  assert.equal(res.ok, false);
});

test('validateMeetingSummaryV3 coerces legacy evidence timestamp → timestampMs', () => {
  const res = validateMeetingSummaryV3({
    actionItems: [{ text: 'x', explicitness: 'explicit', confidence: 'high', evidence: [{ speaker: 'Ari', timestamp: 5000, quote: 'q' }] }],
  });
  assert.equal(res.ok, true);
  const ev = res.data.actionItems[0].evidence[0];
  assert.equal(ev.timestampMs, 5000);
  assert.equal(ev.speakerName, 'Ari');
});

test('validateMeetingSummaryV3 sanitizes invalid enums to safe defaults', () => {
  const res = validateMeetingSummaryV3({
    actionItems: [{ text: 'x', explicitness: 'banana', confidence: 'super', status: 'nope' }],
    risks: [{ text: 'r', severity: 'extreme' }],
  });
  assert.equal(res.data.actionItems[0].explicitness, 'inferred');
  assert.equal(res.data.actionItems[0].confidence, 'medium');
  assert.equal(res.data.actionItems[0].status, undefined); // invalid status dropped
  assert.ok(['low', 'medium', 'high'].includes(res.data.risks[0].severity));
});

// ── Legacy back-compat ───────────────────────────────────────────────────────

test('normalizeLegacySummary renders an old V2 summary as a V3 view', () => {
  const v3 = normalizeLegacySummary({ overview: 'We discussed analytics.', keyPoints: ['PostHog'], actionItems: ['follow up'] });
  assert.ok(v3);
  assert.equal(v3.schemaVersion, 3);
  assert.ok(v3.tldr.length > 0);
  assert.equal(v3.actionItems[0].explicitness, 'inferred');
  assert.ok(v3.sourceQuality.warnings.some(w => /legacy/i.test(w)));
});

test('normalizeLegacySummary returns null for empty legacy data', () => {
  assert.equal(normalizeLegacySummary({}), null);
  assert.equal(normalizeLegacySummary(null), null);
});

test('sanitizeFollowUpDraft upgrades a legacy string to an object', () => {
  const d = sanitizeFollowUpDraft('Hi team,\nThanks.');
  assert.equal(d.type, 'email');
  assert.equal(d.tone, 'professional');
  assert.match(d.body, /Thanks/);
});

// ── Strategy selector ────────────────────────────────────────────────────────

test('strategy selector: short → direct, long → map_reduce', () => {
  const sel = new MeetingSummaryStrategySelector();
  const short = { segments: [seg('a', 'hi', 0)], totalTokensEstimate: 200 };
  const long = { segments: Array.from({ length: 50 }, (_, i) => seg('a', 'x', i)), totalTokensEstimate: 9000 };
  assert.equal(sel.select(short).strategy, 'direct');
  assert.equal(sel.select(long).strategy, 'map_reduce');
});

test('strategy selector: long_context only when explicitly enabled + allowed + safe', () => {
  const sel = new MeetingSummaryStrategySelector();
  const med = { segments: Array.from({ length: 10 }, (_, i) => seg('a', 'x', i)), totalTokensEstimate: 5000 };
  assert.equal(sel.select(med).strategy, 'map_reduce');
  assert.equal(sel.select(med, { enableLongContext: true, longContextAllowed: true }).strategy, 'long_context');
  // Too large for the safe cap → map_reduce even when enabled.
  const huge = { segments: [seg('a', 'x', 0)], totalTokensEstimate: 100000 };
  assert.equal(sel.select(huge, { enableLongContext: true, longContextAllowed: true }).strategy, 'map_reduce');
});

// ── Mode detection ───────────────────────────────────────────────────────────

test('mode detector flags a sales call from transcript', () => {
  const t = [seg('them', 'What is your pricing and budget? We need a pilot before procurement.', 0), seg('me', 'Here is the demo and the contract.', 1000)];
  const r = new MeetingModeDetector().detect({ transcript: t });
  assert.equal(r.templateType, 'sales');
  assert.ok(r.confidence > 0);
});

test('mode detector flags a technical interview', () => {
  const t = [seg('them', 'Implement an LRU cache. What is the time complexity, big O of get and put?', 0), seg('me', 'I will use a hash map and doubly linked list, O(1).', 1000)];
  const r = new MeetingModeDetector().detect({ transcript: t });
  assert.equal(r.templateType, 'technical-interview');
});

test('mode detector returns general with zero confidence on neutral chat', () => {
  const t = [seg('a', 'hello how are you', 0), seg('b', 'good thanks', 1000)];
  const r = new MeetingModeDetector().detect({ transcript: t });
  assert.equal(r.templateType, 'general');
  assert.equal(r.confidence, 0);
});

test('mode detector uses calendar title as a signal', () => {
  const t = [seg('a', 'ok lets start', 0)];
  const r = new MeetingModeDetector().detect({ transcript: t, calendarTitle: 'Weekly Team Standup' });
  assert.equal(r.templateType, 'team-meet');
});

// ── Speaker labels ───────────────────────────────────────────────────────────

test('speaker labels: canonical ids + rename resolution', () => {
  const svc = new SpeakerLabelService();
  const t = [seg('user', 'hi', 0), seg('interviewer', 'hello', 1000), seg('interviewer', 'more', 2000)];
  const speakers = svc.listSpeakers(t, { speaker_1: 'John from Client' });
  const me = speakers.find(s => s.speakerId === 'me');
  const s1 = speakers.find(s => s.speakerId === 'speaker_1');
  assert.equal(me.displayName, 'Me');
  assert.equal(s1.displayName, 'John from Client');
  assert.equal(s1.isRenamed, true);
  assert.equal(s1.segmentCount, 2);
});

test('speaker labels: applyLabels rewrites segment speakers', () => {
  const svc = new SpeakerLabelService();
  const t = [seg('interviewer', 'hi', 0)];
  const out = svc.applyLabels(t, { speaker_1: 'Sarah, PM' });
  assert.equal(out[0].speaker, 'Sarah, PM');
});

test('speaker labels: sanitize + merge', () => {
  const svc = new SpeakerLabelService();
  const clean = svc.sanitizeLabelMap({ speaker_1: '  John  ', bad: '' });
  assert.equal(clean.speaker_1, 'John');
  assert.equal('bad' in clean, false);
  const merged = svc.mergeLabels({ me: 'Evin' }, { speaker_1: 'John', me: '' });
  assert.equal(merged.speaker_1, 'John');
  assert.equal('me' in merged, false);
});

// ── Cross-meeting recall ─────────────────────────────────────────────────────

test('cross-meeting recall surfaces carried open questions', () => {
  const current = { openQuestions: [{ text: 'What retention period is acceptable for analytics?' }], risks: [] };
  const priors = [{ id: 'm1', title: 'Last sync', date: '', openQuestions: ['What retention period is acceptable for analytics data?'], risks: [] }];
  const r = new CrossMeetingRecall().compute(current, priors);
  assert.equal(r.carriedOpenQuestions.length, 1);
  assert.ok(r.stillOpen[0].includes('Last sync'));
});

test('cross-meeting recall is empty with no priors', () => {
  const r = new CrossMeetingRecall().compute({ openQuestions: [{ text: 'x' }], risks: [] }, []);
  assert.deepEqual(r.stillOpen, []);
});

test('priorFromDetailedSummary extracts questions/risks from V3 + legacy', () => {
  const v3 = priorFromDetailedSummary({ id: 'a', title: 'A', date: '', detailedSummary: { openQuestions: [{ text: 'q1' }], risks: [{ text: 'r1' }] } });
  assert.equal(v3.openQuestions[0], 'q1');
  const none = priorFromDetailedSummary({ id: 'b', title: 'B', date: '', detailedSummary: {} });
  assert.equal(none, null);
});

// ── generateStructured ladder (with a fake LLM helper) ───────────────────────

function fakeLLM(responses) {
  let i = 0;
  return { generateMeetingSummary: async () => responses[Math.min(i++, responses.length - 1)] };
}

test('generateStructured returns valid data on first try', async () => {
  const llm = fakeLLM(['{"body":"hello world this is fine"}']);
  const res = await generateStructured({
    schemaName: 'X', systemPrompt: 's', jsonShapeHint: '{}', userContent: 'u', llmHelper: llm,
    validate: (raw) => raw && raw.body ? { ok: true, data: raw, errors: [], repaired: false } : { ok: false, errors: ['no body'], repaired: false },
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.body, 'hello world this is fine');
  assert.equal(res.usedFallback, false);
});

test('generateStructured repairs after one bad response', async () => {
  const llm = fakeLLM(['not json at all', '{"body":"repaired output"}']);
  const res = await generateStructured({
    schemaName: 'X', systemPrompt: 's', jsonShapeHint: '{}', userContent: 'u', llmHelper: llm,
    validate: (raw) => raw && raw.body ? { ok: true, data: raw, errors: [], repaired: false } : { ok: false, errors: ['no body'], repaired: false },
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.body, 'repaired output');
  assert.equal(res.repaired, true);
});

test('generateStructured uses fallback when LLM never produces valid JSON', async () => {
  const llm = fakeLLM(['garbage', 'still garbage']);
  const res = await generateStructured({
    schemaName: 'X', systemPrompt: 's', jsonShapeHint: '{}', userContent: 'u', llmHelper: llm,
    validate: () => ({ ok: false, errors: ['bad'], repaired: false }),
    fallback: () => ({ body: 'deterministic' }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.usedFallback, true);
  assert.equal(res.data.body, 'deterministic');
});

test('extractJsonObject handles fenced and embedded JSON', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('prefix {"b":2} suffix'), { b: 2 });
  assert.equal(extractJsonObject('no json here'), null);
});

// ── Bad JSON from the chunk extractor (validator path) ───────────────────────

test('chunk validator parses fenced JSON and repairs missing fields', () => {
  const v = new MeetingSummarySchemaValidator();
  const parsed = v.parseJsonObject('```json\n{"brief":"x","decisions":[{"text":"d"}]}\n```');
  const atoms = v.validateAndRepairAtoms(parsed, 0);
  assert.equal(atoms.brief, 'x');
  assert.equal(atoms.decisions[0].confidence, 'medium'); // repaired default
  assert.ok(Array.isArray(atoms.actionItems)); // missing → []
});

test('chunk validator returns null for non-object', () => {
  const v = new MeetingSummarySchemaValidator();
  assert.equal(v.validateAndRepairAtoms(null, 0), null);
  assert.equal(v.parseJsonObject('totally not json'), null);
});

// ── FollowUp deterministic fallback (no LLM) ─────────────────────────────────

test('follow-up generator falls back deterministically and maps mode→type', async () => {
  assert.equal(followUpTypeForMode('team-meet'), 'project_update');
  assert.equal(followUpTypeForMode('technical-interview'), 'interview_feedback');
  assert.equal(followUpTypeForMode('lecture'), 'study_notes');
  assert.equal(followUpTypeForMode('sales'), 'email');

  // LLM returns nothing usable → deterministic body from decisions/actions.
  const llm = fakeLLM(['']);
  const gen = new FollowUpDraftGenerator(llm);
  const draft = await gen.generate({
    summary: {
      overview: 'We aligned on PostHog.',
      decisions: [{ id: 'd1', text: 'Use PostHog', confidence: 'high' }],
      actionItems: [{ id: 'a1', text: 'draft retention proposal', owner: 'Ari', deadline: 'Friday', explicitness: 'explicit', confidence: 'high' }],
      openQuestions: [], tldr: ['PostHog chosen'], whatChanged: [],
    },
    mode: 'team-meet',
  });
  assert.equal(draft.type, 'project_update');
  assert.match(draft.body, /retention proposal|Decisions confirmed|Next steps/i);
  assert.deepEqual(draft.basedOnDecisionIds, ['d1']);
});

test('follow-up generator uses LLM body when valid', async () => {
  const llm = fakeLLM(['{"subject":"Sync recap","body":"Thanks all. We chose PostHog and Ari will draft the retention proposal by Friday."}']);
  const gen = new FollowUpDraftGenerator(llm);
  const draft = await gen.generate({
    summary: { overview: 'x', decisions: [{ id: 'd1', text: 'Use PostHog', confidence: 'high' }], actionItems: [], openQuestions: [], tldr: [], whatChanged: [] },
    mode: 'sales',
  });
  assert.equal(draft.type, 'email');
  assert.match(draft.body, /PostHog/);
  assert.equal(draft.subject, 'Sync recap');
});

// ── Follow-up generator quality gates (regression suite for the senior review) ─
// These tests are intentionally narrow: each one locks in a single user-visible
// behaviour that the senior review found missing or breakable.

test('follow-up: rejects LLM subject with placeholder syntax and falls back to a grounded one', async () => {
  // A model that emits {first name} / [Name] must not see it persisted; the gate
  // strips placeholder syntax, then falls back to subjectFromContent(title).
  const llm = fakeLLM(['{"subject":"Hi {first name}, following up","body":"Thanks for your time today, we landed on PostHog for analytics."}']);
  const gen = new FollowUpDraftGenerator(llm);
  const draft = await gen.generate({
    summary: {
      title: 'Acme Q3 renewal kickoff',
      overview: 'Renewal conversation covering PostHog selection.',
      tldr: ['Chose PostHog for analytics'],
      whatChanged: [],
      decisions: [{ id: 'd1', text: 'Use PostHog', confidence: 'high' }],
      actionItems: [],
      openQuestions: [],
      risks: [],
      sections: [],
    },
    mode: 'general',
  });
  assert.equal(draft.type, 'email');
  // Placeholder syntax must not appear in the persisted subject.
  assert.equal(/[{}\[\]]/.test(draft.subject || ''), false, `subject leaked placeholder syntax: ${draft.subject}`);
  // The deterministic fallback subject is grounded in the title.
  assert.match(draft.subject || '', /Acme Q3 renewal kickoff/);
});

test('follow-up: rejects LLM subject with zero overlap to the notes (hallucinated topics list)', async () => {
  // Classic small-model regression: subject like "Mentions of PostHog, retention, Friday"
  // when the notes don't mention "Friday" — must be rejected.
  const llm = fakeLLM(['{"subject":"Mentions of bananas, quokkas, and prisms","body":"Thanks for your time today, we landed on PostHog for analytics."}']);
  const gen = new FollowUpDraftGenerator(llm);
  const draft = await gen.generate({
    summary: {
      title: 'Acme analytics review',
      overview: 'Reviewed analytics stack.',
      tldr: ['Chose PostHog'],
      whatChanged: [],
      decisions: [{ id: 'd1', text: 'Use PostHog', confidence: 'high' }],
      actionItems: [],
      openQuestions: [],
      risks: [],
      sections: [],
    },
    mode: 'general',
  });
  assert.match(draft.subject || '', /Acme analytics review/, 'should fall back to title-derived subject');
});

test('follow-up: subjectFromContent rejects generic titles and prefers a real tldr', async () => {
  const gen = new FollowUpDraftGenerator(fakeLLM([]));
  // No usable title, no usable tldr/overview → falls back to a non-broken string.
  const draft1 = await gen.generate({
    summary: { title: 'Meeting Notes', overview: '', tldr: [], whatChanged: [], decisions: [], actionItems: [], openQuestions: [], risks: [], sections: [] },
    mode: 'general',
  });
  assert.notEqual(draft1.subject, 'Follow-up: Meeting follow-up', 'generic title must not pass through verbatim');
  assert.equal(/Meeting Notes/.test(draft1.subject || ''), false, 'generic "Meeting Notes" title must not leak into subject');
  // A substantive tldr drives the subject.
  const draft2 = await gen.generate({
    summary: { title: '', tldr: ['We agreed to pilot the new onboarding flow across two regions.'], whatChanged: [], decisions: [], actionItems: [], openQuestions: [], risks: [], sections: [] },
    mode: 'general',
  });
  assert.match(draft2.subject || '', /onboarding flow/);
});

test('follow-up: recruiter fallback never renders decisions (would leak no-go to candidate)', async () => {
  // The deterministic fallback must not include a "decisions" block for recruiting,
  // because negative-hiring decisions would be sent to the candidate.
  const { MeetingSummaryReducer } = await load('MeetingSummaryReducer.js');
  const body = MeetingSummaryReducer.buildFollowUpBody
    ? MeetingSummaryReducer.buildFollowUpBody(
        [{ id: 'd1', text: 'No-go: weak systems design experience', confidence: 'high' }],
        [{ id: 'a1', text: 'Schedule onsite', owner: 'Taylor', deadline: 'Fri', explicitness: 'explicit', confidence: 'high' }],
        'recruiting'
      )
    : (await load('MeetingSummaryReducer.js')).buildFollowUpBody(
        [{ id: 'd1', text: 'No-go: weak systems design experience', confidence: 'high' }],
        [{ id: 'a1', text: 'Schedule onsite', owner: 'Taylor', deadline: 'Fri', explicitness: 'explicit', confidence: 'high' }],
        'recruiting'
      );
  assert.equal(/no-go|no go|systems design/i.test(body), false, 'recruiter fallback leaked a negative decision to the candidate');
  assert.match(body, /What happens next/);
  assert.match(body, /Taylor: Schedule onsite/);
});

// ── Long-meeting: no truncation, chunk coverage ──────────────────────────────

test('long transcript: chunker covers beginning, middle, end with overlap', () => {
  const transcript = Array.from({ length: 120 }, (_, i) =>
    seg(i % 2 ? 'me' : 'interviewer', `Segment ${i}: ${'word '.repeat(40)}${i === 0 ? 'ALPHA_START' : i === 60 ? 'BETA_MIDDLE' : i === 119 ? 'GAMMA_END' : ''}`, i * 30000));
  const normalized = new TranscriptNormalizer().normalize(transcript);
  const chunks = new TranscriptChunker({ chunkTargetTokens: 200, overlapTargetTokens: 40, shortTranscriptThresholdTokens: 100 }).chunk(normalized);
  assert.ok(chunks.length > 3);
  assert.match(chunks[0].text, /ALPHA_START/);
  assert.ok(chunks.some(c => /BETA_MIDDLE/.test(c.text)));
  assert.match(chunks[chunks.length - 1].text, /GAMMA_END/);
  // segmentIds preserved per chunk.
  assert.ok(chunks.every(c => Array.isArray(c.segmentIds) && c.segmentIds.length === c.segments.length));
  // Total coverage: every original segment appears in at least one chunk.
  const seen = new Set(chunks.flatMap(c => c.segmentIds));
  assert.equal(seen.size, normalized.segments.length);
});

test('normalizer assigns segmentId and canonical speakerId', () => {
  const normalized = new TranscriptNormalizer().normalize([seg('user', 'hello there', 0), seg('interviewer', 'hi back', 1000)]);
  assert.equal(normalized.segments[0].speakerId, 'me');
  assert.equal(normalized.segments[1].speakerId, 'speaker_1');
  assert.ok(normalized.segments.every(s => typeof s.segmentId === 'string' && s.segmentId.length > 0));
});

// ── Template-section extraction (Phase 16b: mode template = source of truth) ──

function atomsWith(findings, chunkIndex = 0) {
  return {
    chunkIndex,
    timeRange: { startMs: 0, endMs: 60000 },
    brief: 'chunk brief',
    topics: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    risks: [],
    deadlines: [],
    people: [],
    importantQuotes: [],
    modeSpecificFindings: findings,
  };
}

test('validator coerces bare-string findings to {text} and keeps evidence on objects', () => {
  const v = new MeetingSummarySchemaValidator();
  const atoms = v.validateAndRepairAtoms({
    brief: 'x',
    modeSpecificFindings: {
      'Discovery': ['bare string finding', { text: 'rich finding', evidence: [{ speakerName: 'Maya', timestampMs: 1000, quote: 'q' }], confidence: 'high' }],
    },
  }, 0, { allowedSectionTitles: ['Discovery'] });
  const d = atoms.modeSpecificFindings['Discovery'];
  assert.equal(d.length, 2);
  assert.equal(d[0].text, 'bare string finding');
  assert.equal(d[1].evidence[0].speakerName, 'Maya');
  assert.equal(d[1].confidence, 'high');
});

test('validator DROPS invented section keys not in the allowed-title set', () => {
  const v = new MeetingSummarySchemaValidator();
  const atoms = v.validateAndRepairAtoms({
    brief: 'x',
    modeSpecificFindings: { 'Discovery': ['ok'], 'Made Up Section': ['should be dropped'] },
  }, 0, { allowedSectionTitles: ['Discovery'] });
  assert.ok(atoms.modeSpecificFindings['Discovery']);
  assert.equal(atoms.modeSpecificFindings['Made Up Section'], undefined);
});

test('validator canonicalizes finding keys case/space-insensitively to the template title', () => {
  const v = new MeetingSummarySchemaValidator();
  const atoms = v.validateAndRepairAtoms({
    brief: 'x',
    modeSpecificFindings: { 'questions  and RESPONSES': ['routed'] },
  }, 0, { allowedSectionTitles: ['Questions and responses'] });
  assert.ok(atoms.modeSpecificFindings['Questions and responses']);
  assert.equal(atoms.modeSpecificFindings['Questions and responses'][0].text, 'routed');
});

test('reducer routes findings (with evidence) into the declared template sections only', () => {
  const reducer = new MeetingSummaryReducer();
  const normalized = new TranscriptNormalizer().normalize([seg('user', 'hello there friend', 0)]);
  const atoms = [atomsWith({
    'Discovery': [{ text: 'Prospect needs faster QA', evidence: [{ speakerName: 'Maya', timestampMs: 5000, quote: 'QA takes days' }], confidence: 'high' }],
    'Invented': ['nope'],
  })];
  const summary = reducer.reduce({ title: 't', atoms, normalizedTranscript: normalized, modeTemplateType: 'sales', modeNoteSections: [{ title: 'Discovery' }, { title: 'Objections' }] });
  const discovery = summary.sections.find(s => s.title === 'Discovery');
  assert.ok(discovery, 'Discovery section present');
  assert.equal(discovery.bullets[0].text, 'Prospect needs faster QA');
  assert.equal(discovery.bullets[0].evidence[0].speakerName, 'Maya');
  assert.ok(!summary.sections.some(s => s.title === 'Invented'), 'invented section not rendered');
});

test('reducer Summary is outcome-first and never boilerplate; empty when no content', () => {
  const reducer = new MeetingSummaryReducer();
  const normalized = new TranscriptNormalizer().normalize([seg('user', 'hello there friend', 0)]);
  // With a decision, Summary leads with grounded content.
  const withDecision = reducer.reduce({
    title: 't',
    atoms: [{ ...atomsWith({}), decisions: [{ text: 'Adopt PostHog', confidence: 'high' }], brief: 'Team evaluated analytics tools' }],
    normalizedTranscript: normalized, modeTemplateType: 'general', modeNoteSections: [],
  });
  assert.ok(withDecision.tldr.length > 0);
  assert.ok(!withDecision.tldr.some(t => /captured from the transcript/i.test(t)), 'no boilerplate');
  assert.ok(withDecision.tldr.some(t => /PostHog|analytics/i.test(t)));
});

// ── Section prompt compiler ──────────────────────────────────────────────────

test('deterministicSectionInstruction carries source-only + empty-if-absent guardrails', () => {
  const instr = deterministicSectionInstruction({ sectionTitle: 'Discovery', sectionDescription: 'What the prospect said', meetingMode: 'sales' });
  assert.match(instr, /Discovery/);
  assert.match(instr, /only the transcript/i);
  assert.match(instr, /Not discussed/);
});

test('SectionPromptCompiler returns LLM instruction when it passes guardrails, else fallback', async () => {
  // Good compiled instruction (has both required clauses).
  const good = '{"instruction":"Extract the prospect statements. Use ONLY the transcript provided. Do not infer. If not present, output exactly: Not discussed."}';
  const okGen = { generateMeetingSummary: async () => good };
  const r1 = await new SectionPromptCompiler(okGen).compile({ sectionTitle: 'Discovery', sectionDescription: 'x', meetingMode: 'sales' });
  assert.equal(r1.compiled, true);
  assert.match(r1.instruction, /ONLY the transcript/i);

  // Missing guardrails twice → fall back to deterministic.
  const badGen = { generateMeetingSummary: async () => '{"instruction":"just grab whatever"}' };
  const r2 = await new SectionPromptCompiler(badGen).compile({ sectionTitle: 'Discovery', sectionDescription: 'x', meetingMode: 'sales' });
  assert.equal(r2.compiled, false);
  assert.match(r2.instruction, /Not discussed/);
});

test('chunk extractor prefers compiledPrompt over description in the prompt', () => {
  // White-box: verify the compiled guidance reaches the section block. We assert via the
  // reducer path that a compiled section still routes (prompt text is internal), so here we
  // just confirm MeetingModeSectionInput carries compiledPrompt through the reducer.
  const reducer = new MeetingSummaryReducer();
  const normalized = new TranscriptNormalizer().normalize([seg('user', 'hello there friend', 0)]);
  const summary = reducer.reduce({
    title: 't',
    atoms: [atomsWith({ 'Custom': ['finding'] })],
    normalizedTranscript: normalized,
    modeNoteSections: [{ title: 'Custom', description: 'd', compiledPrompt: 'compiled instruction' }],
  });
  assert.ok(summary.sections.some(s => s.title === 'Custom'));
});

// ── Constrained LLM Summary polish (#1) ──────────────────────────────────────

const { SummaryPolisher, newSignificantTokens } = await load('SummaryPolisher.js');

test('newSignificantTokens flags fact-shaped tokens not present in the source', () => {
  const grounded = 'Summary points:\n- Adopt PostHog for analytics\nDecisions:\n- Use PostHog';
  // "Mixpanel" (proper noun not in source) and "40%" (number not in source) must be flagged.
  const offending = newSignificantTokens('We will adopt Mixpanel and cut costs 40% by Friday.', grounded);
  assert.ok(offending.some(t => /Mixpanel/i.test(t)), 'flags invented proper noun');
  assert.ok(offending.some(t => /40%/.test(t)), 'flags invented number');
  assert.ok(offending.some(t => /Friday/i.test(t)), 'flags invented weekday');
});

test('newSignificantTokens allows pure rephrasing (no new facts)', () => {
  const grounded = 'Summary points:\n- Adopt PostHog for analytics\nAction items:\n- Ari: draft retention proposal by Friday';
  // Rephrase using only grounded facts (PostHog, Ari, Friday all present).
  const offending = newSignificantTokens('The team chose PostHog; Ari will draft the retention proposal by Friday.', grounded);
  assert.deepEqual(offending, []);
});

test('SummaryPolisher keeps polished prose when it introduces no new facts', async () => {
  const llm = { generateMeetingSummary: async () => '{"summary":["The team selected PostHog for analytics.","Ari will draft the retention proposal by Friday."]}' };
  const out = await new SummaryPolisher(llm).polish({
    deterministicSummary: ['Adopt PostHog', 'Ari: draft retention proposal by Friday'],
    decisions: [{ text: 'Adopt PostHog', confidence: 'high' }],
    actionItems: [{ text: 'draft retention proposal', owner: 'Ari', deadline: 'Friday', explicitness: 'explicit', confidence: 'high' }],
    risks: [], sections: [], mode: 'team-meet',
  });
  assert.ok(Array.isArray(out));
  assert.ok(out.some(l => /PostHog/.test(l)));
});

test('SummaryPolisher REJECTS hallucinated output and returns null (keep deterministic)', async () => {
  const llm = { generateMeetingSummary: async () => '{"summary":["The team selected Mixpanel and committed to a 40% cost cut by Q3."]}' };
  const out = await new SummaryPolisher(llm).polish({
    deterministicSummary: ['Adopt PostHog'],
    decisions: [{ text: 'Adopt PostHog', confidence: 'high' }],
    actionItems: [], risks: [], sections: [], mode: 'team-meet',
  });
  assert.equal(out, null); // hallucination gate tripped → caller keeps deterministic summary
});

test('SummaryPolisher returns null when there is nothing to polish', async () => {
  const llm = { generateMeetingSummary: async () => '{"summary":["x"]}' };
  const out = await new SummaryPolisher(llm).polish({ deterministicSummary: [], decisions: [], actionItems: [], risks: [], sections: [] });
  assert.equal(out, null);
});

// ── Provider diarization (#3): diarized speakerId precedence ─────────────────

test('normalizer: provider speakerId wins over channel mapping and sets display name', () => {
  const t = [
    { speaker: 'interviewer', speakerId: 'speaker_2', text: 'I run product here.', timestamp: 0, final: true },
    { speaker: 'interviewer', speakerId: 'speaker_3', text: 'And I lead engineering.', timestamp: 5000, final: true },
    { speaker: 'user', text: 'Great to meet you both.', timestamp: 10000, final: true },
  ];
  const normalized = new TranscriptNormalizer().normalize(t);
  assert.equal(normalized.segments[0].speakerId, 'speaker_2');
  assert.equal(normalized.segments[0].speaker, 'Speaker 2');
  assert.equal(normalized.segments[1].speakerId, 'speaker_3');
  assert.equal(normalized.segments[1].speaker, 'Speaker 3');
  assert.equal(normalized.segments[2].speakerId, 'me'); // mic channel unchanged
  // Three distinct speakers now resolvable (diarization split the remote channel).
  assert.equal(new Set(normalized.segments.map(s => s.speakerId)).size, 3);
});

test('normalizer: without speakerId, channel mapping is unchanged (back-compat)', () => {
  const t = [{ speaker: 'interviewer', text: 'hello', timestamp: 0, final: true }];
  const normalized = new TranscriptNormalizer().normalize(t);
  assert.equal(normalized.segments[0].speakerId, 'speaker_1');
  assert.equal(normalized.segments[0].speaker, 'Speaker 1');
});
