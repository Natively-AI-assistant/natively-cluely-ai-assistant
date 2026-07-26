// electron/services/knowledge/FrontMatterExtractor.ts
//
// Context OS production-readiness Phase 4/5 — generic front-matter / title-page
// metadata extraction into ATOMIC facts.
//
// WHY THIS EXISTS
// ---------------
// Scholarly and institutional documents carry their identity in a compact
// "Label Value" metadata block on (or just after) the title page:
//
//     Author Alberto Dian
//     Title Towards Connected Intelligence: ...
//     Supervisor Prof. Ville Kyrki
//     Advisors Dr. Massimiliano Maule, Prof. Davide Brunelli
//     Date 21 June 2025 Number of pages 67 Language English
//     Keywords Embodied AI, Robotics, ...
//
// The OKF section extractor folds this block into whatever enclosing section
// body it lands in, so a label-style question ("What language is the thesis
// written in?", "What date is listed?", "Name one advisor") cannot rank the
// dense prose chunk that happens to contain the single label word — the real
// backend benchmark refused every one of these ("I could not find that in the
// retrieved sections"). The value is plainly present; the representation was
// wrong: a broad section card, not an atomic fact.
//
// THIS MODULE is deterministic (no LLM) and GENERIC. It hardcodes only LABEL
// vocabulary (Author, Title, Date, Language, …) — never any document's VALUES.
// It splits fused single-line label runs into atomic label→value pairs and
// emits one atomic fact per property. Those become high-confidence OKF cards
// that a property-aware query resolves directly, independent of prose ranking.

/** A canonical document metadata property. Maps onto Context OS
 *  RequestedProperty where one exists; extras are still useful evidence. */
export type FrontMatterProperty =
  | 'title'
  | 'subtitle'
  | 'author'
  | 'degree_program'
  | 'major'
  | 'institution'
  | 'department'
  | 'supervisor'
  | 'advisor'
  | 'collaborator'
  | 'date'
  | 'page_count'
  | 'language'
  | 'keywords'
  | 'abstract';

export interface FrontMatterFact {
  property: FrontMatterProperty;
  /** The label as printed in the document ("Number of pages"). */
  label: string;
  /** The extracted value, whitespace-normalized. */
  value: string;
  /** For list-valued properties (advisors, keywords), the split items. */
  items?: string[];
  /** 1-based page the fact was found on, when [Page N] markers are present. */
  page: number | null;
}

// Label vocabulary. Each canonical property lists the surface labels that
// introduce it, longest/most-specific first so "Number of pages" wins over a
// bare "pages". Purely structural — no document values here.
const LABEL_RULES: Array<{
  property: FrontMatterProperty;
  labels: string[];
  list?: boolean;
}> = [
  { property: 'title', labels: ['Title'] },
  { property: 'subtitle', labels: ['Subtitle'] },
  { property: 'author', labels: ['Author', 'Authors', 'Candidate', 'Student', 'Written by', 'By'] },
  { property: 'degree_program', labels: ['Degree programme', 'Degree program', 'Degree', 'Programme', 'Program'] },
  { property: 'major', labels: ['Major', 'Specialisation', 'Specialization', 'Track'] },
  { property: 'institution', labels: ['Institution', 'University', 'School', 'Faculty'] },
  { property: 'department', labels: ['Department', 'Dept'] },
  { property: 'supervisor', labels: ['Supervisors', 'Supervisor', 'Examiner', 'Examiners'], list: true },
  { property: 'advisor', labels: ['Advisors', 'Advisor', 'Co-advisors', 'Co-advisor', 'Instructors', 'Instructor'], list: true },
  { property: 'collaborator', labels: ['Collaborative partner', 'Collaborative partners', 'Industry partner', 'Partner', 'Collaborators', 'Collaborator'], list: true },
  { property: 'date', labels: ['Date', 'Submitted', 'Submission date', 'Defense date'] },
  { property: 'page_count', labels: ['Number of pages', 'Pages', 'Page count', 'Total pages'] },
  { property: 'language', labels: ['Language'] },
  { property: 'keywords', labels: ['Keywords', 'Keyword', 'Key words', 'Index terms'], list: true },
];

// Flat lookup: every label surface form → its rule. Sorted by descending label
// length so the tokenizer greedily matches the most specific label first.
const ALL_LABELS: Array<{ label: string; property: FrontMatterProperty; list: boolean }> = LABEL_RULES
  .flatMap((rule) => rule.labels.map((label) => ({ label, property: rule.property, list: !!rule.list })))
  .sort((a, b) => b.label.length - a.label.length);

const PAGE_MARKER_RE = /^\s*\[Page\s+(\d+)\]\s*$/;

/** How far into the document front matter may live. Scholarly metadata is on
 *  the title page or the immediately following abstract page; scanning the
 *  whole document would let a mid-body "Language modeling" heading masquerade
 *  as a metadata label. Generous enough for a cover + inner title + abstract. */
const FRONT_MATTER_PAGE_LIMIT = 6;

const normalizeWs = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Build one regex that matches ANY known label as a whole word at a position.
 *  Used to detect the NEXT label inside a fused single-line run so we can bound
 *  the current value. Case-sensitive on the leading capital (labels are printed
 *  Title-case) to avoid matching mid-sentence words. */
const LABEL_ALTERNATION = ALL_LABELS
  .map((entry) => entry.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const NEXT_LABEL_RE = new RegExp(`\\b(?:${LABEL_ALTERNATION})\\b`, 'g');

/** Split a list-valued string into clean items: "Dr. A. B., Prof. C. D." →
 *  ["Dr. A. B.", "Prof. C. D."]. Splits on commas, semicolons, " and ", " & ".
 *  Keeps honorifics attached. */
export function splitListValue(value: string): string[] {
  return normalizeWs(value)
    .split(/\s*(?:,|;|\band\b|&)\s*/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !/^(?:and|&)$/i.test(item));
}

/**
 * Parse a single physical line that may contain one OR MORE fused
 * "Label Value" pairs (e.g. "Date 21 June 2025 Number of pages 67 Language
 * English") into atomic pairs. Returns [] for a line that does not START with a
 * known label (prose lines are ignored — this is not a general NER pass).
 */
export function parseFrontMatterLine(line: string): Array<{ label: string; property: FrontMatterProperty; value: string; list: boolean }> {
  const text = normalizeWs(line);
  if (!text) return [];

  // The line must begin with a known label, else it is prose, not metadata.
  const leading = ALL_LABELS.find((entry) => {
    const re = new RegExp(`^${entry.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return re.test(text);
  });
  if (!leading) return [];

  // Walk the line, carving off [label, value] segments. A value runs until the
  // next known label appears as a whole word (or end of line).
  const out: Array<{ label: string; property: FrontMatterProperty; value: string; list: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    // Match the label at the cursor.
    const here = ALL_LABELS.find((entry) => {
      const re = new RegExp(`^${entry.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return re.test(text.slice(cursor));
    });
    if (!here) break;
    const afterLabel = cursor + here.label.length;
    // Find the next label boundary after this label's value begins.
    NEXT_LABEL_RE.lastIndex = afterLabel;
    let nextLabelStart = text.length;
    let m: RegExpExecArray | null;
    while ((m = NEXT_LABEL_RE.exec(text)) !== null) {
      // Skip a match that is INSIDE the value only if it is not a real standalone
      // label — but since labels are Title-case whole words, the first one after
      // the value start is the boundary. Require at least 1 char of value first.
      if (m.index > afterLabel) { nextLabelStart = m.index; break; }
    }
    const value = normalizeWs(text.slice(afterLabel, nextLabelStart));
    if (value) out.push({ label: here.label, property: here.property, value, list: here.list });
    cursor = nextLabelStart;
    // Advance past whitespace to the next label token.
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
  }
  return out;
}

/**
 * Extract atomic front-matter facts from a document's stored text content.
 * `content` is the same [Page N]-marked text the OKF/DocumentMap pipeline sees.
 * Deterministic and generic — returns [] for documents without a recognizable
 * metadata block (most non-scholarly PDFs), so it is safe to always run.
 */
export function extractFrontMatter(content: string): FrontMatterFact[] {
  const lines = String(content || '').split(/\r?\n/);
  const facts: FrontMatterFact[] = [];
  const seen = new Set<FrontMatterProperty>();
  let page: number | null = null;
  let sawAnyPageMarker = false;

  for (const rawLine of lines) {
    const pageMatch = rawLine.match(PAGE_MARKER_RE);
    if (pageMatch) {
      page = Number(pageMatch[1]);
      sawAnyPageMarker = true;
      continue;
    }
    // Once past the front-matter page window, stop — later "Language model"
    // style headings must not be mined as metadata.
    if (sawAnyPageMarker && page !== null && page > FRONT_MATTER_PAGE_LIMIT) break;

    const pairs = parseFrontMatterLine(rawLine);
    for (const pair of pairs) {
      // First occurrence of each property wins (title page precedence). A later
      // duplicate label (e.g. a running header) does not overwrite it.
      if (seen.has(pair.property)) continue;
      // Title-page continuation guard: a "Title" value that got cut by a false
      // next-label match keeps only its first line here; DocumentMap-level
      // multi-line title joining is out of scope for the atomic pass.
      const value = pair.value;
      if (!value || value.length > 400) continue;
      const isList = pair.list;
      facts.push({
        property: pair.property,
        label: pair.label,
        value,
        items: isList ? splitListValue(value) : undefined,
        page,
      });
      seen.add(pair.property);
    }
  }
  return facts;
}

/** Human-readable card body for an atomic front-matter fact. Generic phrasing
 *  keyed on the property, so a property-aware retriever and the answer model
 *  both see the label and value unambiguously. */
export function frontMatterFactToCardBody(fact: FrontMatterFact): string {
  const label = fact.label;
  if (fact.items && fact.items.length > 1) {
    return `${label}: ${fact.items.join(', ')}`;
  }
  return `${label}: ${fact.value}`;
}
