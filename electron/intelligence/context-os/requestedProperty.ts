// electron/intelligence/context-os/requestedProperty.ts
//
// Context OS (Phase 1/2/5 shared) — the single table of property-evidence
// vocabulary. Two consumers:
//
//   • requestedPropertyDetector.ts (Phase 2): what property is the QUESTION
//     asking for? Uses QUESTION_PATTERNS.
//   • propertyEvidenceValidator.ts (Phase 5): does the EVIDENCE actually prove
//     that property? Uses EVIDENCE_PATTERNS.
//
// The two pattern sets are deliberately separate: a question that asks "who
// funded this?" contains the word "funded", but COLLABORATION evidence also
// mentions a company name without any funding vocabulary — the evidence set is
// what rejects topic-overlap. These are CATEGORY synonyms, never
// document-specific terms (no entity names, ever — see the v1 blacklist
// lesson in customModeExecutionContract.ts).

import type { RequestedProperty } from './types';

export interface PropertyRule {
  property: RequestedProperty;
  /** Matches when the QUESTION asks for this property. Order matters (first hit wins). */
  questionPatterns: RegExp[];
  /** Matches when an EVIDENCE sentence can actually prove this property. */
  evidencePatterns: RegExp[];
}

// Ordered: more specific properties first so e.g. "dataset size" wins over the
// generic result/list patterns, and candidate_* (possessive-anchored) wins over
// document-property readings of the same nouns.
export const PROPERTY_RULES: readonly PropertyRule[] = [
  {
    property: 'candidate_project',
    questionPatterns: [
      /\bmy\s+(?:best\s+|strongest\s+|favorite\s+)?projects?\b/i,
      /\bprojects?\s+(?:on|in|from)\s+my\s+(?:resume|cv|profile)\b/i,
      /\bwhat\s+(?:have|did)\s+i\s+built?\b/i,
    ],
    evidencePatterns: [/\bproject\b/i, /\bbuilt\b/i, /\bdeveloped\b/i, /\bcreated\b/i, /\bshipped\b/i],
  },
  {
    property: 'candidate_experience',
    questionPatterns: [
      /\bmy\s+(?:work\s+)?experience\b/i,
      /\bmy\s+skills?\b/i,
      /\bmy\s+strongest\s+skills?\b/i,
      /\bhave\s+i\s+(?:worked|used|done)\b/i,
      /\bdo\s+i\s+(?:know|have\s+experience)\b/i,
      /\b(?:why\s+am|am)\s+i\s+(?:a\s+good\s+)?fit\b/i,
    ],
    evidencePatterns: [/\bexperience\b/i, /\bworked\b/i, /\bskills?\b/i, /\byears?\b/i, /\brole\b/i],
  },
  {
    property: 'candidate_identity',
    questionPatterns: [
      /\bmy\s+name\b/i,
      /\bwho\s+am\s+i\b/i,
      /\bmy\s+current\s+(?:status|role|position|title)\b/i,
      /\bintroduce\s+(?:me|myself)\b/i,
    ],
    evidencePatterns: [/\bname\b/i, /\bcandidate\b/i, /\bcurrently\b/i, /\brole\b/i, /\btitle\b/i],
  },
  {
    property: 'role_requirement',
    questionPatterns: [
      /\bjob\s+description\b/i,
      /\bjd\s+(?:say|require|want)/i,
      /\bwhat\s+(?:does\s+the\s+role|is)\s+required?\b/i,
      /\brole\s+requirements?\b/i,
    ],
    evidencePatterns: [/\brequire(?:s|d|ment)?\b/i, /\bjob\s+description\b/i, /\bmust\s+have\b/i, /\bqualifications?\b/i],
  },
  {
    // Document-identity / title-page metadata (author, title, date, language,
    // advisors, supervisor, keywords, degree, institution). Ordered BEFORE
    // document_structure and software_stack so "what LANGUAGE is the thesis
    // written in?" reads as document metadata, not a programming-language
    // (software_stack) question. Generic label vocabulary — no document values.
    property: 'document_metadata',
    questionPatterns: [
      /\bwho\s+(?:is|wrote|are)\s+the\s+(?:author|writer|authors)\b/i,
      /\bauthor\s+of\s+the\b/i,
      /\b(?:full\s+)?title\s+of\s+the\s+(?:thesis|paper|document|report|dissertation)\b/i,
      /\b(?:name|list)\s+(?:an?\s+|the\s+|one\s+|two\s+)?(?:advisors?|supervisors?|examiners?)\b/i,
      /\b(?:advisors?|supervisors?|examiners?)\s+listed\b/i,
      /\b(?:what|which)\s+date\s+(?:is|does|listed)\b/i,
      /\bdate\s+(?:is\s+)?listed\s+for\s+the\b/i,
      /\b(?:what|which)\s+language\s+(?:is|was)\s+the\s+(?:thesis|paper|document|report|it)\b/i,
      /\b(?:what|which)\s+(?:institution|university|degree|department)\s+(?:is|are|does|listed)\b/i,
      /\b(?:keywords?)\s+(?:listed|for\s+the)\b/i,
      /\b(?:name|list)\s+(?:one|two|three|the|some)?\s*keywords?\b/i,
    ],
    // Evidence: a "Label: value" front-matter card OR a plain title-page label
    // line. Requires a metadata LABEL token, so topical prose that merely uses
    // the word "language" or "date" cannot prove it.
    evidencePatterns: [
      /\b(?:author|title|advisors?|supervisors?|examiners?|date|language|keywords?|degree\s+programme?|department|institution|number\s+of\s+pages)\s*[:\-]/i,
      /\b(?:Author|Title|Advisors?|Supervisors?|Date|Language|Keywords?)\b.{0,60}$/im,
    ],
  },
  {
    property: 'document_structure',
    questionPatterns: [
      /\btable\s+of\s+contents\b/i,
      /\b(?:title|name)\s+of\s+(?:chapter|section)\s+\d{1,2}\b/i,
      /\b(?:what|which)\s+page\s+(?:does|do|is|are|begins?|starts?)\b/i,
      /\b(?:how\s+many|number\s+of)\s+(?:chapters?|sections?)\b/i,
      /\bchapter\s+\d{1,2}\b/i,
    ],
    // Navigation entries must carry a numbered heading plus a printed page.
    // This prevents topical prose that merely mentions a chapter from proving a
    // title/page question.
    evidencePatterns: [/^\s*\[Table of Contents\s*\|[^\n]*\][\s\S]*^\s*\d+(?:\.\d+){0,3}\s+.+?\s+\d{1,3}\s*$/im],
  },
  {
    property: 'funding_source',
    questionPatterns: [
      /\bwho\s+funded\b/i,
      /\bwho\s+paid\s+for\b/i,
      /\bfund(?:ed|ing|s)?\b/i,
      /\bsponsor(?:ed|ship|s)?\b/i,
      /\bgrant(?:s|ed)?\b/i,
      /\bfinancial\s+support\b/i,
      /\bfinanced\b/i,
    ],
    evidencePatterns: [
      /\bfund(?:ed|ing|s)?\b/i,
      /\bsponsor(?:ed|ship|s)?\b/i,
      /\bgrant(?:s|ed)?\b/i,
      /\bfinancial(?:ly)?\s+support(?:ed)?\b/i,
      /\bfunding\s+agency\b/i,
      /\bfinanced\b/i,
      /\bbacked\s+by\b/i,
    ],
  },
  {
    property: 'cost_or_price',
    questionPatterns: [
      /\bcost(?:s)?\b/i,
      /\bprice(?:s|d)?\b/i,
      /\bbudget\b/i,
      /\bhow\s+much\s+(?:did|does|is|was|to)\b/i,
      /\bexpensive\b/i,
      /[₹$€£]\s?\d/,
      /\b(?:usd|inr|eur)\b/i,
    ],
    evidencePatterns: [
      /\bcost(?:s)?\b/i,
      /\bprice(?:s|d)?\b/i,
      /\bbudget\b/i,
      /\bexpens(?:e|ive|diture)\b/i,
      /[₹$€£]\s?\d/,
      /\b(?:usd|inr|eur|dollars?|euros?|rupees?)\b/i,
    ],
  },
  {
    property: 'processor_or_controller',
    questionPatterns: [
      /\bprocessors?\b/i,
      /\bcontrollers?\b/i,
      /\bmcu\b/i,
      /\bcpu\b/i,
      /\bcontrol\s+(?:board|system|unit)\b/i,
      /\bcompute\s+(?:unit|module)\b/i,
      /\bwhat\s+(?:chip|soc|board)\b/i,
    ],
    evidencePatterns: [
      /\bprocessors?\b/i,
      /\bcontrollers?\b/i,
      /\bmcu\b/i,
      /\bcpu\b/i,
      /\bsoc\b/i,
      /\bcontrol\s+(?:board|system|unit)\b/i,
      /\bcompute\s+(?:unit|module)\b/i,
      /\bcontrolled\s+by\b/i,
    ],
  },
  {
    property: 'dataset_size',
    questionPatterns: [
      /\bdataset\s+size\b/i,
      /\bsize\s+of\s+the\s+dataset\b/i,
      /\bhow\s+(?:many|much)\s+(?:samples?|examples?|demonstrations?|trajectories|images?|rows?|data)\b/i,
      /\bwhat\s+dataset\b/i,
      /\bwhich\s+dataset\b/i,
      /\bdataset\s+(?:was|is|were)\s+used\b/i,
    ],
    evidencePatterns: [
      /\bdatasets?\b/i,
      /\bsamples?\b/i,
      /\bdemonstrations?\b/i,
      /\btrajectories\b/i,
      /\bimages?\b/i,
      /\brows?\b/i,
      /\bepisodes?\b/i,
      /\bhours\s+of\s+(?:data|recordings?)\b/i,
    ],
  },
  {
    property: 'training_time',
    questionPatterns: [
      /\btraining\s+time\b/i,
      /\bhow\s+long\b[^.?!]{0,40}\btrain/i,
      /\bepochs?\b/i,
      /\bgpu\s+hours?\b/i,
      /\btraining\s+duration\b/i,
    ],
    evidencePatterns: [
      /\btraining\s+time\b/i,
      /\btrained\s+for\b/i,
      /\bepochs?\b/i,
      /\bgpu\s+hours?\b/i,
      /\bduration\b/i,
      /\bhours?\s+(?:of\s+)?training\b/i,
    ],
  },
  {
    property: 'cloud_provider',
    questionPatterns: [
      /\bcloud\s+provider\b/i,
      /\bwhich\s+cloud\b/i,
      /\baws\b/i,
      /\bgcp\b/i,
      /\bazure\b/i,
      /\bcloud\s+infrastructure\b/i,
      /\bhosted\s+on\b/i,
    ],
    evidencePatterns: [
      /\baws\b/i,
      /\bamazon\s+web\s+services\b/i,
      /\bgcp\b/i,
      /\bgoogle\s+cloud\b/i,
      /\bazure\b/i,
      /\bcloud\s+(?:provider|infrastructure|platform)\b/i,
      /\bon-?prem\b/i,
    ],
  },
  {
    property: 'human_participants',
    questionPatterns: [
      /\bhuman\s+participants?\b/i,
      /\bhow\s+many\s+(?:people|participants?|subjects?|users?)\b/i,
      /\buser\s+study\b/i,
      /\bannotators?\b/i,
    ],
    evidencePatterns: [
      /\bparticipants?\b/i,
      /\b(?:human\s+)?subjects?\b/i,
      /\boperators?\b/i,
      /\bannotators?\b/i,
      /\buser\s+study\b/i,
      /\bvolunteers?\b/i,
      /\brespondents?\b/i,
    ],
  },
  {
    property: 'phase_or_stage',
    questionPatterns: [
      /\bphases?\b/i,
      /\bstages?\b/i,
      /\bsteps?\b/i,
      /\bpipeline\b/i,
      /\bmethodology\b/i,
      /\bmain\s+objectives?\b/i,
      /\bmilestones?\b/i,
    ],
    evidencePatterns: [
      /\bphases?\b/i,
      /\bstages?\b/i,
      /\bsteps?\b/i,
      /\bpipeline\b/i,
      /\bmethodology\b/i,
      /\bobjectives?\b/i,
      /\bmilestones?\b/i,
      /\bworkflow\b/i,
    ],
  },
  {
    property: 'result_metric',
    questionPatterns: [
      /\bresults?\b/i,
      /\bmetrics?\b/i,
      /\baccuracy\b/i,
      /\bsuccess\s+rate\b/i,
      /\bimprovements?\b/i,
      /\bbenchmarks?\b/i,
      /\bhow\s+well\s+did\b/i,
      /\bperformance\b/i,
    ],
    evidencePatterns: [
      /\baccuracy\b/i,
      /\bprecision\b/i,
      /\brecall\b/i,
      /\bf1\b/i,
      /\bsuccess\s+rate\b/i,
      /\bimprovements?\b/i,
      /\bbenchmarks?\b/i,
      /\bmetrics?\b/i,
      /\bevaluat(?:ed|ion)\b/i,
      /\b\d+(?:\.\d+)?\s?%/,
    ],
  },
  {
    property: 'hardware_component',
    questionPatterns: [
      /\bhardware\b/i,
      /\bsensors?\b/i,
      /\bcameras?\b/i,
      /\bactuators?\b/i,
      /\bwhat\s+(?:robot|device|equipment)\b/i,
    ],
    evidencePatterns: [
      /\bhardware\b/i,
      /\bsensors?\b/i,
      /\bcameras?\b/i,
      /\bactuators?\b/i,
      /\brobots?\b/i,
      /\bdevices?\b/i,
      /\bboards?\b/i,
    ],
  },
  {
    property: 'software_stack',
    questionPatterns: [
      /\bsoftware\s+(?:stack)?\b/i,
      /\bframeworks?\b/i,
      /\bwhat\s+(?:language|library|libraries)\b/i,
      /\btech\s+stack\b/i,
    ],
    evidencePatterns: [
      /\bsoftware\b/i,
      /\bframeworks?\b/i,
      /\blibrar(?:y|ies)\b/i,
      /\bros\b/i,
      /\bpython\b/i,
      /\bnode(?:\.js)?\b/i,
      /\bimplemented\s+(?:in|with|using)\b/i,
    ],
  },
  {
    property: 'methodology',
    questionPatterns: [
      /\bmethodolog(?:y|ies)\b/i,
      /\bwhat\s+(?:method|approach)\b/i,
      /\bhow\s+(?:was|were|did)\s+(?:it|they|the)\b[^.?!]{0,40}\b(?:done|conducted|performed|implemented)\b/i,
    ],
    evidencePatterns: [/\bmethodolog(?:y|ies)\b/i, /\bmethods?\b/i, /\bapproach(?:es)?\b/i, /\bprocedures?\b/i],
  },
] as const;

/** Rule lookup by property (returns undefined for 'unknown'). */
export function propertyRuleFor(property: RequestedProperty): PropertyRule | undefined {
  return PROPERTY_RULES.find((r) => r.property === property);
}

/** Does this text contain the evidence vocabulary that can PROVE `property`? */
export function textCanProveProperty(text: string, property: RequestedProperty): boolean {
  if (property === 'unknown') return true;
  const rule = propertyRuleFor(property);
  if (!rule || rule.evidencePatterns.length === 0) return true;
  const t = String(text || '');
  return rule.evidencePatterns.some((re) => re.test(t));
}
