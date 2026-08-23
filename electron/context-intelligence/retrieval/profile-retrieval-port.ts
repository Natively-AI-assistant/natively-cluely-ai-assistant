// electron/context-intelligence/retrieval/profile-retrieval-port.ts
//
// THE factory for a RetrievalPort over the user's PROFILE INTELLIGENCE sources
// (active résumé + active target JD + verified profile facts).
//
// WHY THIS EXISTS (2026-07-31 source-routing defect)
// The planner has always been able to PLAN [RESUME, PROFILE_FACT,
// JOB_DESCRIPTION] — but planned types are a FILTER on whatever pool the turn's
// ports expose, and the only private-source port was the mode port over
// mode-attached files. A Looking-for-Work turn with zero attachments therefore
// resolved RESUME to an empty pool and told the user to upload a résumé they
// had already processed through Profile Intelligence. Mode attachments are
// SUPPLEMENTS; this port makes the profile the primary pool the spec says it is.
//
// Same construction rules as the mode/meeting ports:
//   * everything injected structurally — no import of ProfilePackBuilder,
//     KnowledgeOrchestrator or any legacy module, so this stays testable without
//     Electron or a DB. Callers collect the data (see
//     electron/services/knowledge/v3ProfileSources.ts) and hand it in as values.
//   * fail-closed registry: every source gets a DECLARED type, version and
//     scope; a doc whose mapped type the mode does not AUTHORIZE FOR PROFILE
//     HYDRATION (policy.profileSources) is not registered at all.
//   * the shared legacy-retrieval-port applies planned-type + claim-authority
//     gates downstream — this port only decides what exists and how it ranks.
//
// WHY SECTIONS FROM structured_data AND NOT ONLY OKF CARDS
// Verified live: ProfilePackBuilder.buildSourceText / the card templates drop
// `compensation_hint` and `min_years_experience`, so the JD's salary band and
// experience bar exist in knowledge_documents.structured_data but in NO card.
// Sections are rendered deterministically from the structured extraction every
// turn — complete, fresh (no pack-staleness window), and versioned by the
// caller-supplied content hash. Cards ride along as verified summaries (they
// carry AOT artifacts the raw extraction does not).

import type { EvidenceScope, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createLegacyRetrievalPort } from './legacy-retrieval-port';
import type { LegacyChunk } from './legacy-adapter';
import { Bm25Index, DEFAULT_BM25 } from './bm25';

/**
 * 'fact' (2026-08-02) carries DERIVED profile facts — things the app computed
 * about the user that no uploaded document states. It exists because
 * PROFILE_FACT was a planned source type with a structurally empty pool: the
 * planner emitted [RESUME, PROFILE_FACT] for "what is my expected salary", the
 * résumé is silent on the subject by nature, and PROFILE_FACT resolved to
 * nothing — so the turn answered DOCUMENT_FACT_NOT_FOUND about a figure
 * SalaryIntelligence had already computed and logged.
 *
 * Facts are DERIVED, not documentary. Their sections say so in the text (see
 * renderFactSections) because the model must never restate an estimate as a
 * line item on the résumé.
 */
export type ProfileDocKind = 'resume' | 'jd' | 'fact';

export interface ProfileCardLike {
  id: string;
  type?: string;
  title: string;
  body: string;
  approvalStatus?: string;
}

export interface ProfileDocLike {
  kind: ProfileDocKind;
  /** Canonical stable id (the OKF psrc_* derivation) — appears in telemetry and
   *  the evidence manifest, so it must match what the DB calls the source. */
  sourceId: string;
  /** Content hash of the structured extraction. A profile re-upload changes it,
   *  which is what makes "replace the résumé, ask again, get the new facts"
   *  work without restarting anything: the port is rebuilt per turn. */
  versionId: string;
  fileName: string;
  /** StructuredResume | StructuredJD — treated as data, never trusted shape. */
  structured: Record<string, unknown> | null | undefined;
  /** OKF verified cards for this doc, if a pack exists. Optional. */
  cards?: ProfileCardLike[];
  /**
   * The document's RAW parsed text (deep-test D1, 2026-08-01). The structured
   * extraction is inherently lossy — anything without a schema slot (a canary
   * line, a 7-stage interview list, arbitrary metrics) was unretrievable
   * forever. Raw text is chunked into additional sections so every fact the
   * document states remains reachable; the structured sections stay as the
   * higher-precision ranking aid. Optional: absent for legacy rows until the
   * caller can supply it.
   */
  rawText?: string | null;
}

export interface ProfilePortInput {
  docs: ProfileDocLike[];
  /** policy.allowedSourceTypes — a profile doc whose mapped type the mode does
   *  not allow at all is never registered. */
  allowedSourceTypes: readonly SourceType[];
  /**
   * policy.profileSources — the mode's EXPLICIT opt-in to profile hydration.
   * Distinct from allowedSourceTypes on purpose: Recruiting allows
   * JOB_DESCRIPTION (a hiring JD attached to the mode) but must NEVER hydrate
   * the user's own target JD into candidate evaluation. Empty ⇒ this factory
   * returns null and the turn sees no profile sources.
   */
  profileSources: readonly SourceType[];
  /** MUST match the userId on the turn's scope, or containment rejects all. */
  userId: string;
  /**
   * Content hashes of mode-attached files (sha256 hex of raw content). A
   * profile doc whose EXTRACTION hash cannot match a raw-file hash is not
   * deduplicated this way — this exists for the caller that CAN compute a
   * matching identity (same canonical document attached to the mode), so the
   * duplicate is served once, from the mode attachment it was compared against.
   */
  excludeVersionIds?: readonly string[];
}

const TYPE_FOR_KIND: Record<ProfileDocKind, SourceType> = {
  resume: 'RESUME',
  jd: 'JOB_DESCRIPTION',
  fact: 'PROFILE_FACT',
};

// ── deterministic section rendering ─────────────────────────────────────────

export interface ProfileSection {
  section: string;
  text: string;
  /**
   * TRUE only when the section enumerates the COMPLETE extracted record of a
   * category (every skill, every employer, every requirement). That is what
   * licenses grounded NEGATIVE answers: "Kubernetes is not listed" is a fact
   * about a complete inventory and a guess about a fragment. Consumed by
   * evidenceSupportsClaim via chunk metadata.
   */
  completeInventory: boolean;
  /**
   * WHICH category this is the complete record of. Consumed by
   * evidenceSupportsClaim so the term-free absence shortcut is
   * category-matched: the complete EMPLOYMENT list must never license a
   * grounded negative about CERTIFICATIONS (review finding, 2026-07-31 — a
   * category-blind shortcut manufactured confidently-wrong absences from
   * whichever complete chunk happened to rank).
   */
  inventoryCategory?: string;
  /** Coarse kind used by the intent boosts below. */
  boostKey: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const lines = (v: unknown): string[] => arr(v).map((x) => str(x)).filter(Boolean);

function renderResumeSections(sd: Record<string, unknown>): ProfileSection[] {
  const out: ProfileSection[] = [];
  const id = (sd.identity ?? {}) as Record<string, unknown>;

  // FIELD-LABELLED, and contact fields included (2026-08-02 defect).
  //
  // Two bugs lived in the previous one-liner
  // (`[name, summary, location].join('. ')`), both verified against the real
  // shipped DB:
  //
  //  1. UNRETRIEVABLE BY ITS OWN QUESTION. This port ranks by BM25 over
  //     `section + text`, and the text held only the VALUES ("Rohan Varma.
  //     Kochi, India") — never the word "name". "What is my name" therefore
  //     scored 0 on every chunk, fell under the `score > 0.05` cut, and the
  //     turn logged `evidence:0 / answerability:NONE /
  //     DOCUMENT_FACT_NOT_FOUND` — the assistant denying a résumé it had
  //     successfully ingested. Labelling puts the interrogative's own noun in
  //     the chunk, so the lookup matches lexically instead of relying on a
  //     boost. (The boost in INTENT_RULES is the belt to this braces.)
  //
  //  2. DROPPED FIELDS. email / phone / linkedin / github / website are
  //     extracted and stored, and NO renderer read them — the same
  //     extracted-but-invisible class as the `leadership` defect above. A
  //     résumé stating an email could never answer "what is my email".
  //
  // Still NOT an inventory: a contact blurb enumerates nothing, so it must
  // never license a term-free absence claim (review finding).
  const identityBits = [
    str(id.name) ? `Name: ${str(id.name)}` : '',
    str(id.email) ? `Email: ${str(id.email)}` : '',
    str(id.phone) ? `Phone: ${str(id.phone)}` : '',
    str(id.location) ? `Location: ${str(id.location)}` : '',
    str(id.linkedin) ? `LinkedIn: ${str(id.linkedin)}` : '',
    str(id.github) ? `GitHub: ${str(id.github)}` : '',
    str(id.website) ? `Website: ${str(id.website)}` : '',
    str(id.summary) ? `Summary: ${str(id.summary)}` : '',
  ].filter(Boolean);
  if (identityBits.length) {
    out.push({
      section: 'Identity & summary', boostKey: 'identity',
      text: identityBits.join('. '), completeInventory: false,
    });
  }

  const exp = arr(sd.experience) as Array<Record<string, unknown>>;
  for (const e of exp) {
    const head = [str(e.role), str(e.company)].filter(Boolean).join(' at ');
    const dates = [str(e.start_date), str(e.end_date)].filter(Boolean).join(' to ');
    const bullets = lines(e.bullets).join(' ');
    const text = [head, dates ? `(${dates})` : '', bullets].filter(Boolean).join(' — ');
    if (text) out.push({ section: `Experience: ${head || 'entry'}`, boostKey: 'experience', text, completeInventory: false });
  }
  if (exp.length) {
    // The complete employment index in ONE chunk: absence semantics need the
    // full list ("Did I work at Google?" must see every employer to say no).
    const index = exp.map((e) => {
      const head = [str(e.role), str(e.company)].filter(Boolean).join(' at ');
      const dates = [str(e.start_date), str(e.end_date)].filter(Boolean).join(' to ');
      return dates ? `${head} (${dates})` : head;
    }).filter(Boolean).join('; ');
    if (index) {
      out.push({
        section: 'Complete employment history', boostKey: 'experience',
        text: `Complete list of all work experience on the résumé: ${index}. No other employment is listed.`,
        completeInventory: true, inventoryCategory: 'experience',
      });
    }
  }

  const projects = arr(sd.projects) as Array<Record<string, unknown>>;
  for (const p of projects) {
    const tech = lines(p.technologies).join(', ');
    // `highlights` are the extractor's VERBATIM metric bullets ("Reached 27,450
    // registered users") — the schema exists precisely so numbers are never
    // lost, and StructuredExtractor's prompt promises as much. This renderer
    // dropped them (deep-test D1, 2026-08-01): the model saw a project's name
    // and stack but none of its metrics, and fabricated the numbers.
    const highlights = lines(p.highlights).join(' ');
    const text = [str(p.name), str(p.description), highlights, tech ? `Technologies: ${tech}` : '']
      .filter(Boolean).join(' — ');
    if (text) out.push({ section: `Project: ${str(p.name) || 'entry'}`, boostKey: 'projects', text, completeInventory: false });
  }
  if (projects.length) {
    const index = projects.map((p) => str(p.name)).filter(Boolean).join('; ');
    if (index) {
      out.push({
        section: 'Complete project list', boostKey: 'projects',
        text: `Complete list of all projects on the résumé: ${index}. No other projects are listed.`,
        completeInventory: true, inventoryCategory: 'projects',
      });
    }
  }

  // Skills: the single most absence-sensitive category. skills_flat (when the
  // extractor provides it) plus the categorized map, in one complete chunk.
  const skills = (sd.skills ?? {}) as Record<string, unknown>;
  const flat = lines(sd.skills_flat);
  const catLines = Object.entries(skills)
    .map(([cat, list]) => {
      const ls = lines(list);
      return ls.length ? `${cat}: ${ls.join(', ')}` : '';
    })
    .filter(Boolean);
  if (flat.length || catLines.length) {
    const body = catLines.length ? catLines.join('. ') : flat.join(', ');
    out.push({
      section: 'Complete skills inventory', boostKey: 'skills',
      text: `Complete list of all skills, languages, frameworks and tools on the résumé: ${body}. `
        + 'Any skill or technology not in this list is not listed on the résumé.',
      completeInventory: true, inventoryCategory: 'skills',
    });
  }

  const education = arr(sd.education) as Array<Record<string, unknown>>;
  if (education.length) {
    const body = education.map((ed) => [
      [str(ed.degree), str(ed.field)].filter(Boolean).join(' in '),
      str(ed.institution),
      str(ed.gpa) ? `CGPA/GPA: ${str(ed.gpa)}` : '',
      [str(ed.start_date), str(ed.end_date)].filter(Boolean).join(' to '),
    ].filter(Boolean).join(', ')).join('; ');
    if (body) out.push({ section: 'Education', boostKey: 'education', text: `Complete education record: ${body}`, completeInventory: true, inventoryCategory: 'education' });
  }

  const achievements = arr(sd.achievements) as Array<Record<string, unknown>>;
  const achBody = achievements.map((a) => [str(a.title), str(a.description)].filter(Boolean).join(': ')).filter(Boolean).join('; ');
  if (achBody) out.push({ section: 'Achievements', boostKey: 'achievements', text: achBody, completeInventory: false });

  const certs = lines(sd.certifications).join('; ');
  if (certs) out.push({ section: 'Certifications', boostKey: 'skills', text: `Certifications: ${certs}`, completeInventory: false });

  // Leadership had ZERO readers in this renderer (deep-test D1) — extracted,
  // stored, and invisible at answer time.
  const leadership = arr(sd.leadership) as Array<Record<string, unknown> | string>;
  const leadBody = leadership.map((l) => (typeof l === 'string'
    ? l.trim()
    : [str((l as Record<string, unknown>).title), str((l as Record<string, unknown>).description)].filter(Boolean).join(': ')))
    .filter(Boolean).join('; ');
  if (leadBody) out.push({ section: 'Leadership', boostKey: 'experience', text: `Leadership: ${leadBody}`, completeInventory: false });

  return out;
}

function renderJdSections(sd: Record<string, unknown>): ProfileSection[] {
  const out: ProfileSection[] = [];

  const role = [
    str(sd.title), str(sd.company), str(sd.location),
    str(sd.level) ? `Level: ${str(sd.level)}` : '',
    str(sd.employment_type) ? `Employment type: ${str(sd.employment_type)}` : '',
    str(sd.description_summary),
  ].filter(Boolean).join('. ');
  if (role) out.push({ section: 'Target role', boostKey: 'role', text: role, completeInventory: false });

  const reqs = lines(sd.requirements);
  if (reqs.length) {
    out.push({
      section: 'Job requirements (complete)', boostKey: 'requirements',
      text: `Complete list of requirements in the job description: ${reqs.join('; ')}.`,
      completeInventory: true, inventoryCategory: 'requirements',
    });
  }
  const nice = lines(sd.nice_to_haves);
  if (nice.length) {
    out.push({
      section: 'Nice-to-haves (complete)', boostKey: 'requirements',
      text: `Complete list of preferred/nice-to-have qualifications: ${nice.join('; ')}.`,
      completeInventory: true, inventoryCategory: 'nice_to_haves',
    });
  }
  const resp = lines(sd.responsibilities);
  if (resp.length) {
    out.push({ section: 'Responsibilities', boostKey: 'role', text: resp.join('; '), completeInventory: false });
  }

  // The fields the OKF card templates DROP — the reason sections exist at all.
  const minYears = sd.min_years_experience;
  const comp = str(sd.compensation_hint);
  const compBits = [
    comp ? `Compensation: ${comp}` : '',
    (typeof minYears === 'number' && minYears > 0)
      ? `Minimum professional experience required: ${minYears}+ years`
      : '',
  ].filter(Boolean);
  if (compBits.length) {
    out.push({
      // Retrievable by term match; not an inventory that grounds absences.
      section: 'Compensation & experience bar', boostKey: 'compensation',
      text: compBits.join('. '), completeInventory: false,
    });
  }

  const tech = [...lines(sd.technologies), ...lines(sd.keywords)];
  if (tech.length) {
    out.push({
      // Category 'technologies', NOT 'requirements': a keyword list ranking in
      // must not term-free-support a requirements claim while the actual
      // requirements chunk went unretrieved (review finding: the clearance case).
      section: 'Technologies & keywords (complete)', boostKey: 'requirements',
      text: `Complete list of technologies and keywords named by the job description: ${[...new Set(tech)].join(', ')}.`,
      completeInventory: true, inventoryCategory: 'technologies',
    });
  }
  return out;
}

/**
 * DERIVED profile facts (2026-08-02). Currently the résumé-based salary
 * estimate; the shape is a list so further computed facts can join it.
 *
 * Every section states, in its own text, that the value is an ESTIMATE derived
 * from the résumé and is neither written on the résumé nor an employer offer.
 * That sentence is the whole safety property of this source: the retrieved
 * chunk is what the model sees, so the qualification has to travel WITH the
 * number, not sit in a policy the prompt might not restate.
 *
 * Never a completeInventory: one derived figure enumerates nothing, so it must
 * not license "you have no other compensation expectation" style absences.
 */
function renderFactSections(sd: Record<string, unknown>): ProfileSection[] {
  const out: ProfileSection[] = [];

  const salary = (sd.salary_estimate ?? null) as Record<string, unknown> | null;
  if (salary && typeof salary === 'object') {
    const min = typeof salary.min === 'number' ? salary.min : null;
    const max = typeof salary.max === 'number' ? salary.max : null;
    const currency = str(salary.currency);
    if (min !== null && max !== null && max > 0) {
      const band = `${currency ? `${currency} ` : ''}${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}`;
      const confidence = str(salary.confidence);
      const role = str(salary.role);
      const location = str(salary.location);
      const factors = lines(salary.justification_factors);
      out.push({
        section: 'Expected salary (derived estimate)',
        // OWN key, not 'compensation': the requirements intent rule spills a
        // 0.3 boost onto 'compensation' (so the JD comp band surfaces on
        // "do I meet the bar" questions — correct for the JD). A policy-only
        // chunk keyed the same way would be admitted on every requirements
        // question. derived_salary is boosted ONLY by the genuine
        // salary/compensation rule below.
        boostKey: 'derived_salary',
        text: [
          `Estimated market compensation for the candidate: ${band} per year.`,
          role || location
            ? `Basis: ${[role, location].filter(Boolean).join(' in ')}.`
            : '',
          confidence ? `Confidence: ${confidence}.` : '',
          factors.length ? `Factors considered: ${factors.join('; ')}.` : '',
          'IMPORTANT: this is a DERIVED ESTIMATE calculated from the résumé '
            + '(role, location, skills and years of experience). It is NOT stated '
            + 'anywhere on the résumé, and it is NOT an offer or a figure from the '
            + 'job description. Present it as an estimate.',
        ].filter(Boolean).join(' '),
        completeInventory: false,
      });
    }
  }

  return out;
}

export function renderProfileSections(kind: ProfileDocKind, structured: unknown): ProfileSection[] {
  if (!structured || typeof structured !== 'object') return [];
  try {
    if (kind === 'resume') return renderResumeSections(structured as Record<string, unknown>);
    if (kind === 'fact') return renderFactSections(structured as Record<string, unknown>);
    return renderJdSections(structured as Record<string, unknown>);
  } catch {
    return []; // a malformed extraction yields no sections, never a throw
  }
}

// ── ranking ─────────────────────────────────────────────────────────────────
//
// Lexical BM25 over sections + cards, plus small deterministic intent boosts —
// the profile analogue of OkfProfileRetriever's INTENT_TYPE_BOOSTS: "Do I have
// Kubernetes experience?" shares no token with a skills list that (correctly)
// lacks Kubernetes, so the very chunk that PROVES the absence would never rank.
// Boosts are additive and small; a genuine lexical match always outranks them.

interface IntentRule { re: RegExp; boosts: Record<string, number> }

const INTENT_RULES: IntentRule[] = [
  { re: /\b(do i (have|know)|have i (used|worked)|am i (familiar|proficient|experienced)|experience (with|in|using)|missing|not list|do(n'?| no)t (have|know|list)|lack\b|gaps?\b)/i,
    boosts: { skills: 0.4, requirements: 0.3 } },
  { re: /\b(gpa|cgpa|degree|educat\w*|universit\w*|college|graduat\w*|studied|study)\b/i,
    boosts: { education: 0.45 } },
  { re: /\b(salary|compensation|pay\b|lpa\b|ctc\b|package|band\b|offer|bonus|benefits?)\b/i,
    boosts: { compensation: 0.5, card_artifact_negotiation: 0.35, derived_salary: 0.5 } },
  { re: /\b(experience|work(ed)?|intern\w*|role\b|position|company|employer|years?|tenure)\b/i,
    boosts: { experience: 0.3, identity: 0.15 } },
  { re: /\b(project|built|build|created|developed|launch\w*|portfolio)\b/i,
    boosts: { projects: 0.35 } },
  { re: /\b(require\w*|required|qualif\w*|minimum|criteria|eligib\w*|meet\b|bar\b)\b/i,
    boosts: { requirements: 0.4, compensation: 0.3 } },
  { re: /\b(language|languages|programming|tech stack|technolog\w*|framework|tools?)\b/i,
    boosts: { skills: 0.4, requirements: 0.25 } },
  { re: /\b(intro|introduce|elevator|pitch|tell me about (yourself|myself))\b/i,
    boosts: { identity: 0.4, card_artifact_intro: 0.35 } },
  // IDENTITY & CONTACT LOOKUPS (2026-08-02 defect). The labelled identity
  // section now matches "name"/"email"/"phone" lexically, but the phrasings
  // people actually use in an interview overlay often name no field at all
  // ("who am I", "how do they reach me", "my background"). Those still scored
  // 0 on every chunk and produced a DOCUMENT_FACT_NOT_FOUND on an ingested
  // résumé. Kept OFF the generic pronoun words ("my", "me") on purpose: a
  // boost this broad would ride along on every first-person question and crowd
  // the 6-item evidence cap.
  { re: /\b(who am i|my name|name is|e-?mail|phone|mobile|contact (details|info\w*|number)|linkedin|github|portfolio|personal (site|website)|my (background|profile)|about me)\b/i,
    boosts: { identity: 0.45 } },
];

function intentBoosts(query: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const rule of INTENT_RULES) {
    if (!rule.re.test(query)) continue;
    for (const [k, v] of Object.entries(rule.boosts)) m.set(k, Math.max(m.get(k) ?? 0, v));
  }
  return m;
}

interface PortChunk {
  sourceId: string;
  fileName: string;
  section: string;
  text: string;
  chunkIndex: number;
  boostKey: string;
  completeInventory: boolean;
  inventoryCategory?: string;
  /**
   * POLICY-ADMITTED ONLY (2026-08-02): the chunk is served exclusively when an
   * intent rule targeting its boostKey fires — its BM25 score is discarded.
   * Exists for derived facts: the salary section's own safety disclaimer
   * ("calculated from the résumé — role, location, skills, years of
   * experience…") is a lexical keyword magnet that ranked it #2 on "tell me
   * about my experience" / "what are my skills" in a real-DB probe, wasting an
   * evidence slot and injecting compensation noise into non-salary answers.
   * A derived fact is evidence by POLICY (the question asks for this fact),
   * never by lexical accident.
   */
  policyOnly?: boolean;
}

/** Squash an unbounded BM25 score into the 0..1 band the mode/meeting ports
 *  score in, so combineRetrievalPorts' global sort compares like with like. */
const squash = (bm25: number): number => (bm25 <= 0 ? 0 : bm25 / (bm25 + 1.5));

const normText = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A fail-closed RetrievalPort over Profile Intelligence sources, or null when
 * the mode opts out of profile hydration or no authorized profile doc exists.
 */
export function createProfileRetrievalPort(input: ProfilePortInput): RetrievalPort | null {
  const authorized = new Set<SourceType>(
    input.profileSources.filter((t) => input.allowedSourceTypes.includes(t)),
  );
  if (authorized.size === 0) return null;

  const excluded = new Set(input.excludeVersionIds ?? []);

  const sourceTypes = new Map<string, SourceType>();
  const activeVersions = new Map<string, string>();
  const chunkVersions = new Map<string, string>();
  const sourceScopes = new Map<string, EvidenceScope>();
  const chunks: PortChunk[] = [];

  for (const doc of input.docs) {
    const mapped = TYPE_FOR_KIND[doc.kind];
    if (!mapped || !authorized.has(mapped)) continue;           // mode did not opt in for this type
    if (!doc.sourceId || !doc.versionId) continue;              // fail closed, never guess identity
    if (excluded.has(doc.versionId)) continue;                  // canonical duplicate of a mode attachment

    let idx = 0;
    const seen = new Set<string>();
    const push = (section: string, text: string, boostKey: string, completeInventory: boolean, inventoryCategory?: string) => {
      const key = normText(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      chunks.push({
        sourceId: doc.sourceId, fileName: doc.fileName, section, text, chunkIndex: idx++,
        boostKey, completeInventory, inventoryCategory,
        // Derived facts are policy-admitted, never lexically discovered — see
        // PortChunk.policyOnly.
        policyOnly: doc.kind === 'fact',
      });
    };

    for (const s of renderProfileSections(doc.kind, doc.structured)) {
      push(s.section, s.text, s.boostKey, s.completeInventory, s.inventoryCategory);
    }
    for (const c of doc.cards ?? []) {
      if (c.approvalStatus === 'rejected') continue;
      const body = str(c.body);
      if (!body) continue;
      push(c.title || 'Card', `${c.title ? `${c.title}: ` : ''}${body}`, `card_${c.type ?? 'unknown'}`, false);
    }
    // LOSSLESS raw-text sections (deep-test D1): ~110-word windows with a one-
    // line overlap, so a fact with no schema slot is still retrievable. Ranked
    // by the same BM25 as everything else; the structured sections usually
    // outrank them on common questions, so this adds recall without disturbing
    // precision. Deduped against the structured sections by normText via push().
    const raw = str(doc.rawText);
    if (raw) {
      const rawLines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      let buf: string[] = [];
      let words = 0;
      let part = 1;
      const flush = () => {
        if (!buf.length) return;
        push(`Document text (part ${part})`, buf.join('\n'), 'raw_document', false);
        part += 1;
        const overlap = buf[buf.length - 1];
        buf = overlap ? [overlap] : [];
        words = overlap ? overlap.split(/\s+/).length : 0;
      };
      for (const line of rawLines) {
        buf.push(line);
        words += line.split(/\s+/).length;
        if (words >= 110) flush();
      }
      if (buf.length && (part === 1 || buf.length > 1)) {
        push(`Document text (part ${part})`, buf.join('\n'), 'raw_document', false);
      }
    }

    if (idx === 0) continue;                                    // nothing renderable ⇒ not registered
    sourceTypes.set(doc.sourceId, mapped);
    activeVersions.set(doc.sourceId, doc.versionId);
    chunkVersions.set(doc.sourceId, doc.versionId);
    sourceScopes.set(doc.sourceId, { userId: input.userId });
  }

  if (sourceTypes.size === 0) return null;

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number }): Promise<LegacyChunk[]> => {
      const index = new Bm25Index(chunks.map((c, i) => ({ id: String(i), text: `${c.section} ${c.text}` })), DEFAULT_BM25);
      const bm25ById = new Map(index.score(query).map((s) => [s.id, s.score]));
      const boosts = intentBoosts(query);

      return chunks
        .map((c, i) => {
          const lexical = squash(bm25ById.get(String(i)) ?? 0);
          const boost = boosts.get(c.boostKey) ?? 0;
          // A boost with NO lexical signal must rank BELOW genuine matches —
          // additive flat boosts were crowding real mode-attachment hits out of
          // the 6-item cap (review finding). ONE exception, by design: a
          // COMPLETE INVENTORY targeted by a fired intent is admitted at a
          // fixed 0.6. Absence evidence can never rank on similarity — the
          // skills list that proves "Kubernetes is not listed" deliberately
          // does not contain the word Kubernetes — so it is policy-admitted at
          // a level below real matches (0.7+) but above the cut line. Bounded:
          // at most one or two inventory chunks per fired intent.
          const boostOnly = c.completeInventory && boost > 0 ? 0.6 : Math.min(0.35, boost);
          // policyOnly (derived facts): lexical score DISCARDED. Admitted at the
          // inventory level (0.6 — beneath real matches, above the cut) only
          // when an intent rule targeting the chunk's own boostKey fired.
          const score = c.policyOnly
            ? (boost > 0 ? 0.6 : 0)
            : (lexical > 0 ? Math.min(1, lexical * 0.85 + boost) : boostOnly);
          return { c, score };
        })
        .filter((s) => s.score > 0.05)
        .sort((a, b) => b.score - a.score || a.c.chunkIndex - b.c.chunkIndex)
        .slice(0, Math.max(1, opts.topK))
        .map(({ c, score }) => ({
          sourceId: c.sourceId,
          fileName: c.fileName,
          section: c.section,
          text: c.text,
          chunkIndex: c.chunkIndex,
          score,
          // Provenance (issue 10 / Pattern D): derived from the registry role
          // this port itself declared for the document — never from content.
          provenance: sourceTypes.get(c.sourceId) === 'JOB_DESCRIPTION'
            ? 'PROFILE_JOB_DESCRIPTION'
            : sourceTypes.get(c.sourceId) === 'RESUME'
              ? 'PROFILE_RESUME' : 'PROFILE_FACT',
          // Carried through the adapter so evidenceSupportsClaim can treat a
          // checked COMPLETE inventory as grounded support for absence answers
          // — category-matched, so the shortcut only fires for the claim class
          // the record actually enumerates.
          metadata: c.completeInventory
            ? { completeInventory: true, ...(c.inventoryCategory ? { inventoryCategory: c.inventoryCategory } : {}) }
            : {},
        }));
    },
  });
}
