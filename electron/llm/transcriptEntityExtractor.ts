// electron/llm/transcriptEntityExtractor.ts
//
// Deterministic entity extraction from a transcript turn, for populating
// SessionMemory (release 2026-06-07c). Pure, no LLM, no I/O. Derives the salient
// tokens a follow-up might later reference — project/company/person/skill/topic/
// decision — using generic grammar (CamelCase names, "tell me about X" cues, short
// proper-noun answers, action-item owners, named concepts). Fully dynamic: no
// profile-, company-, or fixture-specific strings.
//
// PRIVACY: returns short TOKENS only (a name, a skill, an owner) — never the raw
// turn beyond a decision summary the caller already has. Salary/comp values are
// detected here so SessionMemory can gate them; the value text is the caller's
// transcript, not re-derived private data.

import type { MemoryItemKind } from './SessionMemory';

export interface ExtractedEntity {
  kind: MemoryItemKind;
  value: string;
  /** True when the value looks like compensation (so the caller gates it). */
  sensitive?: boolean;
}

// CamelCase tokens that are actually SKILLS/tech, not project names.
const KNOWN_SKILLS = /^(TypeScript|JavaScript|FastAPI|GraphQL|PostgreSQL|MongoDB|PowerBI|TensorFlow|PyTorch|NodeJS|RocksDB|DynamoDB|CockroachDB|Elasticsearch|Kubernetes|OpenTelemetry|ZooKeeper|RabbitMQ)$/i;
// Common sentence-initial / interjection / filler words capitalized by grammar but
// NOT entities — excluded from the short-answer proper-noun heuristic.
const STOP_PROPER = new Set([
  'Today', 'Action', 'Coming', 'Now', 'Why', 'And', 'Who', 'What', 'How', 'Tell', 'Explain',
  'Make', 'Solve', 'Can', 'Actually', 'Correction', 'Yes', 'No', 'Good', 'Nice', 'Remote',
  'Alright', 'Maybe', 'Cool', 'Sure', 'Okay', 'Well', 'Right', 'Thanks', 'Hello', 'Hi', 'Hey',
  'Yeah', 'Great', 'Perfect', 'Awesome', 'Sorry', 'Please', 'Fine', 'True', 'False', 'Done',
  'Where', 'When', 'Which', 'Whom', 'Here', 'There', 'Probably', 'Definitely', 'Onsite',
  'Hybrid', 'Yep', 'Nope', 'Absolutely', 'Certainly', 'Indeed', 'Exactly', 'Filler', 'Strong',
  'Also', 'An', 'A', 'The', 'It', 'Our', 'Let', 'Lots', 'Quarterly', 'Some', 'Many', 'Most',
  'Reply', 'Answer', 'Response', 'Filler', 'Question', 'Continue', 'Going', 'Coming', 'Back',
  'Both', 'Either', 'Neither', 'Anything', 'Something', 'Nothing', 'Everyone', 'Someone',
]);
const SKILL_RE = /\b(Python|SQL|TypeScript|JavaScript|React|Node|Go|Rust|FastAPI|Django|Flask|GraphQL|AWS|GCP|Azure|Docker|Kubernetes|Tableau|Power\s?BI|Excel|Pandas|NumPy|Spark|Hadoop|Kafka|Redis|TensorFlow|PyTorch)\b/i;
const TOPIC_RE = /\b(amortized analysis|dynamic programming|graph traversal|hashing|BFS|DFS|recursion|big[- ]?o|complexity|rate limiting|caching|consistency|sharding|normalization|oauth|jwt)\b/i;
// Salary / comp value detector — used to flag sensitive notes so SessionMemory
// auto-promotes them to `comp` (gated to negotiation).
const SALARY_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh|lakhs)\b|[$£€]\s?\d|\b\d{3,}\s?(?:per|\/)\s?(?:year|yr|annum|month)\b|\b(?:base salary|expected (?:salary|comp|ctc|package)|total comp(?:ensation)?|equity grant|rsus?|signing bonus|ctc)\b/i;

/**
 * Extract salient entities from one turn's text. `speakerRole` lets us treat a short
 * candidate answer ("Natively.") as a project name. Returns [] for filler/noise.
 */
export function extractTranscriptEntities(text: string, speakerRole?: 'interviewer' | 'user' | 'assistant'): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const t = String(text || '');
  if (!t.trim()) return out;

  // Compensation FIRST — any comp-looking value is tagged sensitive (caller gates it).
  if (SALARY_VALUE_RE.test(t)) out.push({ kind: 'comp', value: t.trim().slice(0, 80), sensitive: true });

  // skills (before CamelCase so a CamelCase skill like TypeScript isn't a "project").
  // Collect EVERY skill mention, not just the first — `t.match(SKILL_RE)` without the
  // `g` flag silently drops every skill after the first one in the same turn (e.g. "a
  // streaming Kafka and Flink pipeline" only tagged Hadoop from an earlier sentence,
  // never Kafka), which then let the later CamelCase/cued-noun rule below mis-tag the
  // untagged skill as a `project` instead. All matched skill tokens are gathered into
  // `skillTokens` (lowercased) so the CamelCase/cued rules can exclude them too.
  const skillMatches = t.match(new RegExp(SKILL_RE.source, 'gi')) || [];
  const skillTokens = new Set<string>();
  for (const s of skillMatches) {
    const key = s.toLowerCase();
    if (skillTokens.has(key)) continue;
    skillTokens.add(key);
    out.push({ kind: 'skill', value: s });
  }
  const isSkillToken = (tok: string) => KNOWN_SKILLS.test(tok) || skillTokens.has(tok.toLowerCase());

  // PROJECT names: CamelCase tokens (excluding known/mentioned skills — a tech name
  // like RocksDB, Kafka, or TensorFlow is CamelCase-shaped but is a SKILL, not a
  // project, and must never be recalled as one; see isSkillToken above).
  const camel = t.match(/\b[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/g) || [];
  for (const c of camel) { if (!isSkillToken(c) && !out.some(e => e.value === c)) out.push({ kind: 'project', value: c }); }
  // a single capitalized proper noun introduced by a product cue. Deliberately
  // excludes any skill token (e.g. "a streaming system ON Kafka" must not tag Kafka as
  // a project just because "on" is one of the cue words — Kafka is already captured as
  // a skill above).
  //
  // Skeptic-pass finding (2026-07-17, live-reproduced): bare "on"/"to" are NOT
  // reliable project cues — they precede person/company names just as often as
  // project names ("reported TO Priya", "escalated TO Priya", "Going back TO
  // Stripe"), and the same downstream bare-pronoun substitution
  // (sessionFollowupResolver.ts's /\b(it|that|there)\b/i fallback) that spliced
  // Kafka/RocksDB into unrelated later questions does the identical thing with a
  // mis-tagged person name ("what was the hardest part of that project?" ->
  // "...of Priya?"). Removed from the trigger list; "back to X" (a genuine
  // topic-return cue, live-tested in LiveSessionMemory2026_06_07c.test.mjs) and
  // "use X"/"using X" are kept — those two are unambiguously about a
  // tool/project being adopted, not a person being addressed.
  const cued = t.match(/\b(?:tell me about|about|project called|called|use|using|back to)\s+([A-Z][a-z][a-zA-Z0-9]{2,})\b/);
  if (cued && !STOP_PROPER.has(cued[1]) && !isSkillToken(cued[1]) && !out.some(e => e.value === cued[1])) out.push({ kind: 'project', value: cued[1] });
  // a SHORT candidate answer that is just a proper noun ("Natively.") names a project.
  if (speakerRole !== 'interviewer') {
    const words = t.trim().replace(/[.?!,]/g, '').split(/\s+/).filter(Boolean);
    if (words.length <= 3) {
      for (const w of words) {
        if (/^[A-Z][a-z][a-zA-Z0-9]{2,}$/.test(w) && !STOP_PROPER.has(w) && !isSkillToken(w) && !out.some(e => e.value === w)) {
          out.push({ kind: 'project', value: w });
        }
      }
    }
  }

  // companies / customers ("customer Acme", "talking to Globex", "client Initech").
  const company = t.match(/\b(?:customer|account|client|talking to|prospect)\s+([A-Z][a-z]+)\b/);
  if (company && !STOP_PROPER.has(company[1])) out.push({ kind: 'company', value: company[1] });

  // action-item OWNER (a person name) → decision value = the owner (so "who owns
  // that?" recalls the owner).
  const owner = t.match(/\b(?:owner|assigned to)\s+([A-Z][a-z]+)\b/);
  if (owner && !STOP_PROPER.has(owner[1])) out.push({ kind: 'decision', value: owner[1] });

  // lecture / technical topics.
  const topic = t.match(TOPIC_RE);
  if (topic && !out.some(e => e.value.toLowerCase() === topic[0].toLowerCase())) out.push({ kind: 'topic', value: topic[0] });

  return out;
}

/** Does the text begin with / contain a correction cue ("actually", "correction")? */
export function isCorrectionTurn(text: string): boolean {
  return /\b(actually|correction|instead|let'?s use|moved to|scratch that|i meant)\b/i.test(String(text || ''));
}

/** Does the question explicitly invite cross-mode profile recall in coding/etc?
 * Anchored to a PROFILE/PROJECT object (code-review 2026-06-07c) so a benign "in
 * college" / "in the project structure" doesn't falsely relax the boundary. */
export function isExplicitCrossModeInvite(text: string): boolean {
  const t = String(text || '');
  return /\b(use|using|with|in|from)\s+(my|your|this|that|the)\s+(natively|project|portfolio|own (project|code|app))\b/i.test(t)
    || /\bin natively\b/i.test(t)
    || /\bhave you (?:used|done|built|implemented|applied)\b[^.?!]*\bin\s+(your|my|this|that|the)\s+(natively|project|portfolio|app|product|work|experience)\b/i.test(t);
}
