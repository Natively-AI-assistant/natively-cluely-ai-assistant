import { Mode, ModeReferenceFile } from './ModesManager';
import { ModeHybridRetriever, ModeRetrievedContext as HybridContext } from './modes/ModeHybridRetriever';
import { VectorStore } from '../rag/VectorStore';
import { EmbeddingPipeline } from '../rag/EmbeddingPipeline';
import { DatabaseManager } from '../db/DatabaseManager';
// Imported from the leaf module (not the ../llm barrel) to avoid a require cycle.
import { classifyCustomContext, selectCustomContextForAnswer } from '../llm/customContextClassifier';
import type { AnswerType } from '../llm/AnswerPlanner';
import { buildDocumentMap, resolveTargetSections, sectionAwareChunksFromMap, selectTableOfContentsEntries, sentenceAwareWindows, tabularChunks, type DocumentMap } from './modes/DocumentMap';
import { EVIDENCE_USE_RULE, retrievalDiagnosticsEnabled, diagLog, isBroadDocumentQuery, computeEvidenceCoverage, classifyDocumentQuestionShape } from '../llm/documentGroundedPrompt';

/**
 * Gate the mode's raw customContext blob by answer type (Phase 3). Returns only
 * the chunks the answer type may see — sensitive chunks (salary/pricing/private
 * strategy) are dropped unless the answer is a negotiation. When `answerType` is
 * undefined the full blob is returned unchanged (backward compatible). Returns
 * `{ text, sensitiveDropped }` so the caller can record safety telemetry.
 */
function scopeCustomContext(raw: string, answerType?: AnswerType): { text: string; sensitiveDropped: boolean } {
    const trimmed = raw.trim();
    if (!trimmed || !answerType) return { text: trimmed, sensitiveDropped: false };
    const classified = classifyCustomContext(trimmed);
    const selection = selectCustomContextForAnswer(classified, answerType);
    const sensitiveDropped = classified.sensitive.length > 0 && !selection.sensitiveIncluded;
    return { text: selection.included.map(c => c.text).join('\n'), sensitiveDropped };
}

export interface ModeKnowledgeSource {
    id: string;
    type: 'custom_context' | 'reference_file';
    fileName?: string;
    content: string;
}

export interface ModeRetrievedSnippet {
    sourceId: string;
    sourceType: ModeKnowledgeSource['type'];
    fileName?: string;
    text: string;
    score: number;
}

export interface ModeRetrievedContext {
    snippets: ModeRetrievedSnippet[];
    formattedContext: string;
    usedFallback: boolean;
    /** Document-type-agnostic retrieval confidence in [0,1] (diagnostics-only).
     *  top snippet's raw score normalized against this query's own adaptive
     *  relevance floor, clamped to [0,1] — works across ToC and flat-prose docs
     *  by construction. Absent on empty/fallback returns (treat as 0). */
    topScoreConfidence?: number;
}

export interface ModeRetrievalOptions {
    /**
     * Document-grounded custom modes need a fail-closed grounding path even for
     * broad questions like “what is the main topic?” that have little lexical
     * overlap with the uploaded file. When true, retrieval always emits a compact
     * document-identity block and expands broad queries with file identity terms.
     */
    forceDocumentGrounding?: boolean;
    /**
     * Follow-up referent hint (round-7 Failure-2). A short/anaphoric follow-up
     * ("What processor controls it?", "What throughput does that give?") loses
     * the subject — the bare query has no referent, so retrieval can't find the
     * fact. The caller passes the PREVIOUS assistant answer here; the retriever
     * extracts its high-signal ENTITY terms (e.g. "Mercury X1", "OpenVLA-OFT")
     * and appends them to the retrieval query ONLY (never shown to the model, so
     * the doc-grounded anti-contamination guarantee is preserved — the prior
     * answer text never re-enters the prompt). Used only for retrieval scoring.
     * Empty/absent → today's behavior exactly.
     */
    followUpReferentHint?: string;
    /**
     * Validation/repair retry path may ask retrieval to broaden recall after the
     * first answer proved incomplete/unsupported. Kept opt-in so the normal hot
     * path stays at the calibrated doc-grounded budget/topK.
     */
    relaxed?: boolean;
    /** Optional topK override used with relaxed repair retrieval. */
    topK?: number;
}

export interface RetrieveOptions extends ModeRetrievalOptions {
    query: string;
    transcript?: string;
    tokenBudget?: number;
    topK?: number;
    /**
     * When set, the mode's customContext is scoped by answer type so sensitive
     * chunks (salary/pricing/private strategy) never leak into a non-negotiation
     * answer. Undefined → the full customContext blob is used (backward compat).
     */
    answerType?: AnswerType;
    /**
     * PI v3 (W2): callers that PIN the mode's customContext directly into the
     * prompt (getActiveModePinnedInstructions) set this so retrieval doesn't
     * surface the same text a second time. Reference files are unaffected.
     */
    excludeCustomContext?: boolean;
    /**
     * Phase 1 (smart-retrieval): manual/typed/follow-up callers set this to
     * permit the local cross-encoder rerank escalation when the confidence gate
     * trips. Live transcript turns leave it false so first-token latency is
     * never gated on a (cold) reranker load. Default false.
     */
    allowRerank?: boolean;
}

const DEFAULT_TOKEN_BUDGET = 1800;
const DEFAULT_TOP_K = 6;
// Document-grounded custom mode retrieves from large PDFs (50-200 pages).
// Default limits (topK=6, budget=1800) were calibrated for short seminar
// notes; they leave most of the thesis unread. These higher limits apply
// automatically when forceDocumentGrounding=true and the caller didn't
// pass a larger explicit value.
// Exported so ipcHandlers.ts and LLMHelper.ts can reference the same values.
export const DOC_GROUNDED_TOKEN_BUDGET = 3600;
export const DOC_GROUNDED_TOP_K = 12;
const MIN_RELEVANCE_SCORE = 0.18;
const CHUNK_WORDS = 140;
const CHUNK_OVERLAP = 30;
// Fact-level sub-chunk target (audit 2026-06-28, weak-model real-path fix).
// Much smaller than CHUNK_WORDS so flat-prose reference files split into
// per-fact units that topK can rank/select, instead of one giant chunk per
// file that matches every query identically.
const SUBCHUNK_WORDS = 45;

// Shared evidence extraction rule (EVIDENCE_USE_RULE) is imported at the top of
// this file from the leaf module electron/llm/documentGroundedPrompt — round-8
// (seminar-fix-2) made it the SINGLE source of truth so the HYBRID retriever (the
// live path) uses the SAME 6-clause rule as this lexical path (previously the
// hybrid formatContext had a stale 1-sentence copy, so completeness clause (5) +
// off-topic-redirect clause (6) never reached the model in production).

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function encodePayload(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// Question and function words that match too promiscuously in body text.
// Only applied to `queryWords` on the document-grounded path — keeping them
// in the 7 default-mode paths is safe and intentional (they never land in
// sections with the same word; the noise is harmless there).
// Shared here so the per-chunk `contentWordBonus` stopword set (formerly inline
// at line ~800) uses the same list rather than maintaining two copies.
const DOC_GROUNDED_STOPWORDS = new Set([
    'what', 'which', 'where', 'when', 'how', 'why', 'who', 'whom',
    'does', 'did', 'many', 'much', 'used', 'use', 'using', 'uses',
    'was', 'were', 'are', 'is', 'the', 'for', 'and', 'with',
    'this', 'that', 'these', 'those', 'have', 'has', 'had',
    'can', 'could', 'would', 'should', 'about', 'role', 'main',
    // Document-context words: ubiquitous in any uploaded document so they
    // match every chunk equally and add noise without signal.
    'thesis', 'seminar', 'paper', 'study', 'research',
    // Generic storage verbs — substring-stem "store" matches "stores", "storage",
    // "datastore" in chunk bodies, producing false contentWordBonus hits that
    // push structural-data chunks above the RLDS-format chunk for Q39.
    'stored', 'store', 'stores',
]);

function wordsOf(text: string): string[] {
    return text
        .toLowerCase()
        // English possessive: collapse "Green's" → "green", "interviewer's" →
        // "interviewer". Symmetrically strips the `'s` suffix on both query
        // and chunk so a query about "interviewer's complexity" still matches
        // a file that says "Interviewer prefers …", and a query about
        // "Green's function" matches a file that says "Green's function".
        .replace(/['’]s\b/g, '')
        // Remaining in-word apostrophes (contractions like "don't", "can't"):
        // drop them so the word stays one token ("dont", "cant") rather than
        // being split into a dropped single-char fragment.
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2);
}

function chunkText(content: string, fineChunk: boolean = false): string[] {
    // TABULAR data (CSV/TSV) → row-aware chunks with the header repeated, so a
    // query for one entity retrieves its labelled row instead of a giant blob
    // (prose chunkers made the model fabricate dataset figures). Mirror of
    // ModeHybridRetriever.chunkText.
    const table = tabularChunks(content);
    if (table) return table;

    // Section-aware chunker (audit 2026-06-27): splits on heading boundaries so
    // a query like "What is OpenVLA-OFT?" reliably retrieves a chunk that
    // STARTS with "OpenVLA-OFT" rather than a mid-paragraph fragment. The
    // previous word-window chunker split a 140-word slide window at any word
    // boundary, so a heading could land in one chunk and its body in the next,
    // defeating the section-aware retrieval that the AnswerPlanner/document
    // identity block assumes.
    //
    // Heading patterns we recognise:
    //   `# Heading`, `## Subheading`, `### Subsubheading`  (markdown ATX)
    //   `1.1 Title`, `2.1.3 Title`                          (numbered sections)
    //   `2 OpenVLA-OFT`                                     (numbered top-level)
    //   `[Page N]` markers from PDF ingest (audit F1+F2) — used as SOFT
    //     boundaries: we never split mid-page, but we DO start a new chunk
    //     at each [Page N] marker.
    const lines = content.split('\n');
    const sections: Array<{ heading: string | null; body: string[] }> = [];
    let current: { heading: string | null; body: string[] } = { heading: null, body: [] };

    const headingRe = /^\s*(?:#{1,3}\s+|(?:\d+(?:\.\d+){0,2}\s+))/;
    const pageMarkerRe = /^\s*\[Page\s+\d+\]\s*$/;

    const flush = () => {
        if (current.heading !== null || current.body.length > 0) sections.push(current);
        current = { heading: null, body: [] };
    };

    for (const line of lines) {
        if (headingRe.test(line)) {
            // New heading → close the previous section, start a new one.
            flush();
            current.heading = line.trim();
        } else if (pageMarkerRe.test(line)) {
            // [Page N] is a SOFT boundary. We do NOT close the section here —
            // a heading + 10 pages of content is one section. But we mark the
            // line so it stays attached to the next body line. Pages that
            // contain only a marker + blank lines still flow into the section.
            current.body.push(line);
        } else {
            current.body.push(line);
        }
    }
    flush();

    const chunks: string[] = [];
    for (const section of sections) {
        const headingLine = section.heading ?? '';
        const bodyText = section.body.join('\n').replace(/\s+/g, ' ').trim();
        const fullText = headingLine ? `${headingLine}\n${bodyText}` : bodyText;
        if (!fullText) continue;

        if (!fineChunk) {
            // DEFAULT (non-document-grounded) path — unchanged section-aware
            // behavior: a whole section ≤ CHUNK_WORDS is one chunk; longer
            // sections word-window with the heading anchored. This preserves
            // retrieval granularity for the 7 default modes and custom modes
            // without files, which the existing fixtures/tests depend on.
            const words = fullText.split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;
            if (words.length <= CHUNK_WORDS) {
                chunks.push(fullText);
                continue;
            }
            // Sentence-aware windowing: never split a normative clause mid-sentence
            // across a chunk boundary (mirror of ModeHybridRetriever).
            const bodyForWindows = headingLine ? bodyText : fullText;
            for (const window of sentenceAwareWindows(bodyForWindows, CHUNK_WORDS, CHUNK_OVERLAP)) {
                const ct = headingLine ? `${headingLine}\n${window}` : window;
                if (ct.trim()) chunks.push(ct);
            }
            continue;
        }

        // DOCUMENT-GROUNDED fine-chunk path (audit 2026-06-28, weak-model
        // real-path fix). The seminar fixtures are flat prose / CSV rows with no
        // headings — under the "<= CHUNK_WORDS → one chunk" rule a 144-word file
        // (OpenVLA + OpenVLA-OFT + AutoGen + objectives) collapsed into ONE
        // chunk that scored identically for every query, so topK returned ALL
        // files every time and the weak gemini-3.1-flash-lite anchored on
        // whatever fact repeated most. Sub-chunk on sentence / line boundaries
        // so each fact is its own retrievable unit and topK can SELECT.
        const rawBody = section.body.join('\n');
        const units = splitIntoUnits(rawBody);
        if (units.length === 0 && !headingLine) continue;

        let pending: string[] = [];
        let pendingWords = 0;
        const emit = () => {
            if (pending.length === 0) return;
            const body = pending.join(' ').replace(/\s+/g, ' ').trim();
            const ft = headingLine ? `${headingLine}\n${body}` : body;
            if (ft.trim()) chunks.push(ft);
            pending = [];
            pendingWords = 0;
        };
        for (const unit of units) {
            const uw = unit.split(/\s+/).filter(Boolean).length;
            if (pendingWords > 0 && pendingWords + uw > SUBCHUNK_WORDS) emit();
            pending.push(unit);
            pendingWords += uw;
            if (pendingWords >= SUBCHUNK_WORDS) emit();
        }
        emit();
        if (units.length === 0 && headingLine) chunks.push(headingLine);
    }

    // Round-7 safety net (2026-07-01, hardened after test-engineer review):
    // if the chunker produced very few chunks (< 3) for a non-trivial
    // document (>= 600 words), the content was probably one giant section
    // without any sub-split surface — common for pathological inputs (all-
    // caps policy text, CSV blobs, scan OCR without sentence punctuation,
    // long single-paragraph markdown without `\n\n`).
    //
    // The fineChunk path normally splits on sentence/line boundaries via
    // splitIntoUnits; if THAT also returned 1 unit (e.g. all-lowercase, no
    // punctuation, no newlines), the chunker would return exactly 1 chunk
    // and topK would only see that one chunk. This safety net first tries
    // paragraph-boundary splits (`\n\s*\n+`); if the doc still has only
    // 1 paragraph (the canonical pathological case), it falls back to a
    // forced SUBCHUNK_WORDS word-window split so a 600+ word single blob
    // gets broken into SUBCHUNK_WORDS-word candidates. Either way the
    // downstream `adaptiveThreshold` filter has multiple candidates to
    // SELECT from instead of a single guaranteed-winner.
    if (fineChunk && chunks.length < 3) {
        const totalWords = chunks.reduce((n, c) => n + c.split(/\s+/).filter(Boolean).length, 0);
        // Senior-review observability 2026-07-01: emit a debug log so support
        // can confirm the safety net actually fired when a user reports bad
        // retrieval against a long single-paragraph / scan-OCR doc.
        console.debug(`[ModeContextRetriever] chunkText safety net triggered (existingChunks=${chunks.length}, totalWords=${totalWords})`);
        if (totalWords >= 600) {
            const paragraphs = content
                .split(/\n\s*\n+/)
                .map(p => p.trim())
                .filter(p => p.length > 0);
            // Originally required paragraphs.length >= 3, but test-engineer
            // (2026-07-01) traced 800-word single-paragraph markdown and saw
            // it collapse to 1 chunk (no \n\n at all). Relaxed to >= 2 so a
            // 2-paragraph 1200-word doc also benefits. For the truly single-
            // paragraph case, paragraphs.length === 1 → falls through to
            // the word-window fallback below.
            if (paragraphs.length >= 2) {
                const paraChunks: string[] = [];
                for (const para of paragraphs) {
                    const words = para.split(/\s+/).filter(Boolean);
                    if (words.length === 0) continue;
                    if (words.length <= SUBCHUNK_WORDS) { paraChunks.push(para); continue; }
                    for (let i = 0; i < words.length; i += SUBCHUNK_WORDS - 5) {
                        const window = words.slice(i, i + SUBCHUNK_WORDS);
                        if (window.length === 0) break;
                        paraChunks.push(window.join(' '));
                        if (i + SUBCHUNK_WORDS >= words.length) break;
                    }
                }
                if (paraChunks.length >= 3) chunks.length = 0, chunks.push(...paraChunks);
            } else if (paragraphs.length === 1 && paragraphs[0].split(/\s+/).filter(Boolean).length >= 600) {
                // Canonical pathological case: one giant paragraph, >=600
                // words, no sentence punctuation, no \n\n. Force a word-
                // window split on SUBCHUNK_WORDS boundaries so topK gets
                // multiple candidates. This catches scan-OCR + all-caps
                // policy text + single-paragraph markdown.
                const para = paragraphs[0];
                const words = para.split(/\s+/).filter(Boolean);
                const windowChunks: string[] = [];
                for (let i = 0; i < words.length; i += SUBCHUNK_WORDS - 5) {
                    const window = words.slice(i, i + SUBCHUNK_WORDS);
                    if (window.length === 0) break;
                    windowChunks.push(window.join(' '));
                    if (i + SUBCHUNK_WORDS >= words.length) break;
                }
                if (windowChunks.length >= 3) chunks.length = 0, chunks.push(...windowChunks);
            }
        }
    }

    return chunks;
}

// Split a block of text into fact-level units: sentence boundaries AND line
// boundaries (so CSV rows / bulleted lines each become a unit). Keeps short
// fragments attached to avoid 1-2 word noise units.
function splitIntoUnits(text: string): string[] {
    const out: string[] = [];
    for (const line of text.split('\n')) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        // Sentence split within the line: break after . ! ? followed by space +
        // capital/digit, but don't break common abbreviations or decimals.
        const sentences = trimmedLine
            .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
            .map(s => s.trim())
            .filter(Boolean);
        for (const s of sentences) out.push(s);
    }
    return out;
}

// Precompute the query's high-signal entity terms ONCE per retrieve() call.
// scoreChunk() runs once per chunk (hundreds of times on a 66-page doc, across
// three loops), and extractHighSignalEntityTerms re-parses the query with two
// global regexes — identical every call. Compute it once and thread it in.
function precomputeEntityTerms(rawQuery: string | undefined, useEntityFusion: boolean): string[] | null {
    if (!useEntityFusion || !rawQuery) return null;
    const terms = extractHighSignalEntityTerms(rawQuery);
    return terms.length > 0 ? terms : null;
}

function scoreChunk(
    queryWords: Set<string>,
    chunk: string,
    rawQuery?: string,
    useEntityFusion: boolean = false,
    entityTerms?: string[] | null,
): number {
    if (queryWords.size === 0) return 0;
    const chunkWords = wordsOf(chunk);
    if (chunkWords.length === 0) return 0;

    let matches = 0;
    const seen = new Set<string>();
    for (const word of chunkWords) {
        if (queryWords.has(word) && !seen.has(word)) {
            matches++;
            seen.add(word);
        }
    }
    const lexical = matches / Math.sqrt(queryWords.size * Math.max(1, new Set(chunkWords).size));

    // BOUNDED fusion (round-6 rebuild, 2026-06-29). The previous code did
    // `score += 0.5 * entityHits` UNBOUNDED — a chunk that tripped several entity
    // terms reached scores >2 (the live logs showed 2.207), so a generic chunk
    // that happens to name many query tokens dominated the chunk that actually
    // answered the question, and the two retrievers (lexical here vs the bounded
    // hybrid) produced incomparable orderings. Now entity presence is a SECOND
    // bounded signal in [0,1] and the final score is a weighted convex
    // combination, so every score stays in [0,1] and is comparable.
    // Entity-coverage fusion is DOCUMENT-GROUNDED ONLY (round-6). The 7 default
    // modes and non-doc-grounded custom modes keep PURE lexical scoring — their
    // flat fixtures/tests depend on the original ranking, and the entity signal
    // is only needed to separate sections in a large structured document. Also
    // skip when the query has no high-signal entity terms.
    if (!useEntityFusion || !rawQuery) return lexical;
    // Use the precomputed terms when provided (hot path); otherwise compute
    // lazily (keeps the function correct if called without precomputation).
    const resolvedEntityTerms = entityTerms !== undefined
        ? entityTerms
        : (extractHighSignalEntityTerms(rawQuery) || null);
    if (!resolvedEntityTerms || resolvedEntityTerms.length === 0) return lexical;

    const chunkLower = chunk.toLowerCase();
    let entityHits = 0;
    for (const term of resolvedEntityTerms) {
        const t = term.toLowerCase();
        // WORD-BOUNDARY match (round-6 fix): substring matching wrongly counted
        // "lora" inside "exploration"/"collaborative", inflating the entity
        // score of windows that don't actually name the entity and burying the
        // window that does (e.g. the "Low-Rank Adaptation (LoRA)" sentence). Use
        // a boundary check so only genuine entity mentions count. Falls back to
        // substring for terms with regex-special chars (e.g. "ROS#", "C++").
        let matched: boolean;
        if (/^[a-z0-9-]+$/.test(t)) {
            matched = new RegExp(`(^|[^a-z0-9])${t.replace(/[-]/g, '\\-')}([^a-z0-9]|$)`).test(chunkLower);
        } else {
            matched = chunkLower.includes(t);
        }
        if (matched) entityHits++;
    }
    // Fraction of the query's entity terms present verbatim in the chunk — a
    // strong "this chunk is about the asked entity" signal, bounded to [0,1].
    const entityFrac = entityHits / resolvedEntityTerms.length;

    // 55% lexical overlap + 45% entity coverage. Entity coverage is weighted
    // heavily (a chunk that names the queried entity verbatim should win) but
    // can never push the score above 1 (the old `+0.5*hits` reached 2.2) or
    // swamp a chunk with strong lexical overlap.
    const ENTITY_WEIGHT = 0.45;
    return (1 - ENTITY_WEIGHT) * lexical + ENTITY_WEIGHT * entityFrac;
}

const DOCUMENT_IDENTITY_MAX_FILES = 5;
const DOCUMENT_IDENTITY_TERMS_PER_FILE = 14;
const DOCUMENT_IDENTITY_EXCERPT_CHARS = 700;
const DOCUMENT_GROUNDED_QUERY_EXPANSION = [
    'title', 'abstract', 'introduction', 'research questions', 'objectives',
    'thesis structure', 'methodology', 'experiments', 'results', 'discussion',
    'limitations', 'conclusion', 'evaluation metrics', 'technical specifications',
];

const LOW_SIGNAL_TERMS = new Set([
    'abstract', 'introduction', 'conclusion', 'references', 'figure', 'table',
    'section', 'appendix', 'overview', 'summary', 'method', 'methods', 'results',
    'discussion', 'paper', 'document', 'presentation', 'slides', 'notes', 'file',
]);

function firstTextExcerpt(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_IDENTITY_EXCERPT_CHARS);
}

// Targeted-retry helpers (audit 2026-06-27).

// Pull high-signal entity terms out of a question so the targeted retry
// has a usable query when the original wording lexically missed every
// chunk. We match capitalised phrases ("Mercury X1", "OpenVLA-OFT"),
// mixed-case tokens ("iPhone"), and terms containing digits or hyphens
// ("DOF", "19", "C920"). Low-signal stop words are dropped.
const ENTITY_STOPWORDS = new Set([
    'the', 'and', 'what', 'how', 'why', 'when', 'where', 'which',
    'does', 'did', 'are', 'was', 'were', 'has', 'have', 'had',
    'this', 'that', 'these', 'those', 'with', 'from', 'into',
    'about', 'between', 'your', 'you', 'i', 'we', 'they', 'his',
    'her', 'its', 'our', 'their', 'me', 'us', 'them',
]);
function extractHighSignalEntityTerms(query: string): string[] {
    const phraseMatches = query.match(/\b[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]+){0,3}\b/g) ?? [];
    const termMatches = query.match(/\b[A-Za-z0-9-]*[A-Z][A-Za-z0-9-]*\b|\b\w*[0-9]\w*\b/g) ?? [];
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const t of [...phraseMatches, ...termMatches]) {
        const cleaned = t.trim();
        if (cleaned.length < 2 || cleaned.length > 40) continue;
        const lower = cleaned.toLowerCase();
        if (ENTITY_STOPWORDS.has(lower)) continue;
        // Reject multi-word phrases whose first word is a question/function word.
        // "What VR" matches the phrase regex (sentence-initial "What" + all-caps
        // "VR") but "What" is not an entity — dropping it prevents false entity
        // signal from polluting the retry query.
        const firstWord = lower.split(/\s+/)[0];
        if (ENTITY_STOPWORDS.has(firstWord)) continue;
        if (seen.has(lower)) continue;
        seen.add(lower);
        terms.push(cleaned);
        if (terms.length >= 6) break;
    }
    return terms;
}

// Extract a `[Page N]` marker from a chunk (PDF ingest emits these). Null
// if the chunk has no page marker — non-PDF or pre-F1 ingest.
function extractPageMarker(text: string): number | null {
    const m = text.match(/^\s*\[Page\s+(\d+)\]/);
    return m ? Number(m[1]) : null;
}

// Extract the first markdown / numbered heading in a chunk. The chunker
// anchors each chunk with its heading, so the first heading is the chunk's
// section identity.
function extractFirstHeading(text: string): string | null {
    const m = text.match(/^\s*(?:#{1,3}\s+|(?:\d+(?:\.\d+){0,2}\s+))([^\n]+)/m);
    return m ? m[1].trim() : null;
}

// PDF files (since 2026-06-27) inject `[Page N]` markers at ingest time and
// carry a real `pageCount` / `extractedPageCount` on the file record. Earlier
// uploads and txt/md/docx files have neither, so the retriever falls back to a
// text-length heuristic of 3000 chars/page. This helper prefers the real
// numbers when available — the previous 47-vs-67 mismatch came from using the
// heuristic for a PDF that was 141 KB of text on 67 pages.
function reportReferenceFilePageCounts(files: ModeReferenceFile[]): {
    referenceFilePageCount: number;
    referenceFileIngestedPages: number;
    pdfReportedPageCount?: number;
    pdfExtractedPageCount?: number;
    referenceFileIngestedByPageHeuristic?: boolean;
} {
    let pageCount = 0;
    let ingestedPages = 0;
    let hasRealPdf = false;
    let anyPdf = false;
    for (const file of files) {
        if (typeof file.pageCount === 'number' && file.pageCount > 0) {
            hasRealPdf = true;
            anyPdf = true;
            pageCount += file.pageCount;
            ingestedPages +=
                typeof file.extractedPageCount === 'number' && file.extractedPageCount > 0
                    ? file.extractedPageCount
                    : file.pageCount;
        } else if (/\.pdf$/i.test(file.fileName)) {
            anyPdf = true;
            // BACKFILL (round-6 Stage 4): the stored page_count is null for
            // pre-v19 uploads, but the content carries [Page N] markers — count
            // them as the real page count instead of falling to the 3000-char
            // heuristic (which reported "43" for the 66-page thesis). No
            // re-upload needed; this reads the markers already in the content.
            const markers = file.content.match(/\[Page\s+\d+\]/g);
            if (markers && markers.length > 0) {
                let maxP = 0;
                const distinctPages = new Set<number>();
                for (const mk of markers) {
                    const n = parseInt(mk.replace(/\D+/g, ''), 10);
                    if (n > 0) {
                        distinctPages.add(n);
                        if (n > maxP) maxP = n;
                    }
                }
                if (maxP > 0) {
                    hasRealPdf = true;
                    pageCount += maxP;
                    // DISTINCT pages, not raw marker count — a repeated [Page N]
                    // (page split across extraction blocks) must not inflate
                    // ingestedPages above pageCount.
                    ingestedPages += distinctPages.size;
                }
            }
        }
    }
    if (hasRealPdf) {
        return {
            referenceFilePageCount: pageCount,
            referenceFileIngestedPages: ingestedPages,
        };
    }
    const heuristic = Math.max(
        1,
        Math.ceil(files.reduce((sum, file) => sum + file.content.length, 0) / 3000),
    );
    return {
        referenceFilePageCount: heuristic,
        referenceFileIngestedPages: heuristic,
        ...(anyPdf ? { referenceFileIngestedByPageHeuristic: true } : {}),
    };
}

function addCandidateTerm(out: Map<string, number>, raw: string, boost = 1, requireSignalShape = false): void {
    const term = raw.replace(/[_\s]+/g, ' ').replace(/\s*[-/]\s*/g, '-').trim();
    if (term.length < 3 || term.length > 80) return;
    const key = term.toLowerCase();
    if (LOW_SIGNAL_TERMS.has(key)) return;
    if (/^\d+$/.test(term)) return;
    const hasMetricShape = /\b(?:Rate|Score|Accuracy|Precision|Recall|MSE|RMSE|Loss|Latency)\b/.test(term);
    const hasSignalShape = /[A-Z]{2,}/.test(term) || /[a-z][A-Z]/.test(term) || /[-/]/.test(raw) || /\d/.test(term) || hasMetricShape;
    if (requireSignalShape && !hasSignalShape) return;
    const score = boost
        + (/[A-Z]{2,}/.test(term) ? 3 : 0)
        + (/[a-z][A-Z]/.test(term) ? 3 : 0)
        + (/[-/]/.test(term) ? 2 : 0)
        + (/\d/.test(term) ? 1 : 0)
        + (hasSignalShape ? 1 : 0);
    out.set(term, Math.max(out.get(term) ?? 0, score));
}

interface DocumentIdentity {
    file: ModeReferenceFile;
    terms: string[];
    excerpt: string;
}

function identityContentHash(content: string): string {
    let hash = 0;
    const str = content.slice(0, 20_000);
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    hash = ((hash << 5) - hash + content.length) | 0;
    return (hash >>> 0).toString(16);
}

const DOCUMENT_IDENTITY_CACHE_MAX = 100;
const documentIdentityCache = new Map<string, { terms: string[]; excerpt: string }>();

// Document-map cache (round-6 rebuild). buildDocumentMap parses the whole
// reference file (up to 128 KB); the lexical retrieve() loop has NO chunk cache
// (unlike ModeHybridRetriever), so without this it would re-parse on every
// query, up to 3× per call. Keyed by `${file.id}:${contentHash}` so a re-upload
// (new content → new hash → miss) is handled automatically. True LRU: on a hit
// we delete+reinsert so the entry moves to the most-recently-used end (Map
// preserves insertion order), and eviction removes the least-recently-used
// front entry — a hot file uploaded early is NOT evicted before cold ones.
const DOCUMENT_MAP_CACHE_MAX = 100;
const documentMapCache = new Map<string, DocumentMap>();

function getCachedDocumentMap(fileId: string, content: string): DocumentMap {
    const key = `${fileId}:${identityContentHash(content)}`;
    const cached = documentMapCache.get(key);
    if (cached) {
        // Refresh recency (LRU): move this key to the most-recent end.
        documentMapCache.delete(key);
        documentMapCache.set(key, cached);
        return cached;
    }
    const built = buildDocumentMap(content);
    if (documentMapCache.size >= DOCUMENT_MAP_CACHE_MAX) {
        const oldestKey = documentMapCache.keys().next().value;
        if (oldestKey) documentMapCache.delete(oldestKey);
    }
    documentMapCache.set(key, built);
    return built;
}

/**
 * Build section-aware chunks from a structured document (one with a real ToC +
 * numbered sections). Each chunk is the section heading + body (sub-split when a
 * section is long), prefixed with a `[Section N.N | pX-Y]` tag so the chunk
 * carries its own section + page provenance into scoring and telemetry. Returns
 * null when the document has no detectable ToC/section structure — the caller
 * then keeps the existing chunkText() path (flat-prose fixtures, slide decks).
 */
function sectionAwareChunks(fileId: string, content: string): string[] | null {
    const map = getCachedDocumentMap(fileId, content);
    // Delegates to the shared chunker in DocumentMap so the lexical and hybrid
    // retrievers produce identical section-tagged chunks (single source of
    // truth — prevents the two paths from diverging).
    return sectionAwareChunksFromMap(map, CHUNK_WORDS, CHUNK_OVERLAP);
}

function extractHighSignalTerms(file: ModeReferenceFile): string[] {
    const terms = new Map<string, number>();
    const stem = file.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    for (const word of stem.split(/\s+/)) addCandidateTerm(terms, word, 1);

    const text = file.content.slice(0, 20_000);
    const technicalPattern = /\b(?:[A-Z]{2,}[A-Z0-9]*|[A-Z]?[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][A-Za-z0-9]+(?:[-/][A-Z]?[A-Za-z0-9]+)+)\b/g;
    for (const match of text.matchAll(technicalPattern)) addCandidateTerm(terms, match[0], 2);

    // Title-case noun phrases are useful for names/metrics such as Mercury X1 or
    // Success Rate, but sentence-start prose can look the same. Require at least
    // one token with a signal shape (digit/acronym/camel/hyphen/slash) before
    // considering the phrase a high-signal identity term.
    const titleCasePattern = /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){1,3}\b/g;
    for (const match of text.matchAll(titleCasePattern)) addCandidateTerm(terms, match[0], 2, true);

    return Array.from(terms.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, DOCUMENT_IDENTITY_TERMS_PER_FILE)
        .map(([term]) => term);
}

function buildDocumentIdentity(files: ModeReferenceFile[]): DocumentIdentity[] {
    return files
        .filter(file => file.content.trim())
        .slice(0, DOCUMENT_IDENTITY_MAX_FILES)
        .map(file => {
            const key = `${file.id}:${identityContentHash(file.content)}`;
            let cached = documentIdentityCache.get(key);
            if (!cached) {
                cached = { terms: extractHighSignalTerms(file), excerpt: firstTextExcerpt(file.content) };
                if (documentIdentityCache.size >= DOCUMENT_IDENTITY_CACHE_MAX) {
                    const oldestKey = documentIdentityCache.keys().next().value;
                    if (oldestKey) documentIdentityCache.delete(oldestKey);
                }
                documentIdentityCache.set(key, cached);
            }
            return { file, terms: cached.terms, excerpt: cached.excerpt };
        });
}

function buildDocumentIdentityQueryText(identities: DocumentIdentity[]): string {
    return identities
        .map(({ file, terms, excerpt }) => [file.fileName, ...terms, excerpt.slice(0, 500)].join(' '))
        .join('\n');
}

function buildDocumentIdentityBlock(mode: Mode, identities: DocumentIdentity[]): string {
    if (identities.length === 0) return '';

    const lines = ['  <document_identity purpose="broad_query_grounding">'];
    lines.push('    <document_identity_guard>Uploaded reference files are the highest-priority evidence for this custom mode. Use this identity block to route broad questions to the uploaded material. Answer only from facts literally present; you may match slightly different wording but never invent items not actually written. If the answer is not present, say it is not in the uploaded material; do not answer from general knowledge or prior chat history.</document_identity_guard>');
    lines.push(`    <mode>${escapeXmlText(mode.name)}</mode>`);
    for (const { file, terms, excerpt } of identities) {
        lines.push('    <file>');
        lines.push(`      <source>${encodePayload({ type: 'reference_file', fileName: file.fileName, sourceId: file.id })}</source>`);
        if (terms.length > 0) lines.push(`      <high_signal_terms>${escapeXmlText(terms.join(', '))}</high_signal_terms>`);
        if (excerpt) lines.push(`      <opening_excerpt>${escapeXmlText(excerpt)}</opening_excerpt>`);
        lines.push('    </file>');
    }
    lines.push('  </document_identity>');
    return lines.join('\n');
}

export class ModeContextRetriever {
    private _hybridRetriever: ModeHybridRetriever | null = null;
    private _sharedEmbeddingPipeline: EmbeddingPipeline | null = null;

    retrieve(mode: Mode, files: ModeReferenceFile[], options: RetrieveOptions): ModeRetrievedContext {
        const hasReferenceFiles = files.some(file => file.content.trim());
        // RC5 (Profile Intelligence production-fix round 2, 2026-07-05): with
        // ZERO reference files AND no retrievable customContext there is
        // nothing to retrieve — every manual profile question was still paying
        // for the full lexical pipeline (planner, chunking traces, rescue-gate)
        // just to produce an empty result (session log: "[FIX2-TRACE] LEXICAL
        // retrieve() entry { fileCount: 0, files: [] }" on EVERY question).
        // Short-circuit to the canonical empty result immediately. Kept
        // conservative: any non-empty customContext (unless the caller
        // excluded it) still runs the full path, since custom-context chunks
        // are a legitimate retrieval source with no files present.
        const hasRetrievableCustomContext = !options.excludeCustomContext && !!(mode.customContext || '').trim();
        if (!hasReferenceFiles && !hasRetrievableCustomContext) {
            return { snippets: [], formattedContext: '', usedFallback: false };
        }
        const forceDocumentGrounding = options.forceDocumentGrounding === true && hasReferenceFiles;
        if (retrievalDiagnosticsEnabled()) {
            try {
                const tagged = files.map(f => {
                    const chs = (forceDocumentGrounding && f.content.trim()) ? (sectionAwareChunks(f.id, f.content.trim()) ?? chunkText(f.content.trim(), true)) : chunkText(f.content, forceDocumentGrounding);
                    const tcount = chs.filter(c => /^\[Section\s+[\d.]+\s*\|/.test(c)).length;
                    return { id: f.id, name: f.fileName, chunks: chs.length, sectionTagged: tcount };
                });
                diagLog('LEXICAL retrieve() entry', { query: options.query, forceDocumentGrounding, fileCount: files.length, files: tagged });
            } catch (e) { diagLog('LEXICAL retrieve() entry (trace err)', (e as any)?.message); }
        }
        const documentIdentities = forceDocumentGrounding ? buildDocumentIdentity(files) : [];
        const identityQueryText = forceDocumentGrounding ? buildDocumentIdentityQueryText(documentIdentities) : '';
        const expansionQueryText = forceDocumentGrounding ? DOCUMENT_GROUNDED_QUERY_EXPANSION.join('\n') : '';
        // Score against the USER'S query words ONLY (audit 2026-06-28, weak-model
        // real-path fix). Previously the query was
        //   `${query}\n${transcript}\n${expansionQueryText}\n${identityQueryText}`
        // — which folded the 14 generic section words AND every high-signal term
        // from EVERY file into queryWords. That made every query look almost
        // identical ("title abstract methodology … AgenticVLA OpenVLA Mercury
        // X1 …"), so scoring was dominated by common document-wide terms and the
        // SAME generic chunks won regardless of the actual question. The
        // expansion/identity text is still used as a LOW-WEIGHT fallback only
        // when the bare user query has too few content tokens to score on its
        // own (e.g. "objectives?" → 1 token).
        // Follow-up referent enrichment (round-7 Failure-2). A short/anaphoric
        // follow-up ("What processor controls it?", "What throughput does that
        // give?") has no subject, so retrieval can't reach the answer. When the
        // caller supplies the previous answer as followUpReferentHint AND the
        // query looks anaphoric (contains a bare pronoun/deixis with no strong
        // entity of its own), we append the hint's high-signal ENTITY terms
        // (capitalised / hyphenated / digit-bearing — "Mercury X1", "OpenVLA-OFT")
        // to the retrieval query. This is retrieval-scoring ONLY; the hint text
        // is NEVER added to queryText shown to the model, so the doc-grounded
        // anti-contamination guarantee (prior answer stripped from the prompt) is
        // preserved. Generic: works for any doc-grounded mode, no doc strings.
        let referentEnrichment = '';
        if (forceDocumentGrounding && options.followUpReferentHint && options.query) {
            const q = options.query;
            const looksAnaphoric = /\b(it|its|it's|that|this|they|them|those|these|there|the same|he|she)\b/i.test(q);
            const ownEntities = extractHighSignalEntityTerms(q);
            // Only enrich when the follow-up is genuinely referential: it uses a
            // pronoun/deixis AND doesn't already carry its own strong entity.
            if (looksAnaphoric && ownEntities.length === 0) {
                // Drop pure-number entities ("19", "480") — they are values from
                // the prior ANSWER, not the SUBJECT the follow-up refers to, and
                // they mis-route the planner (e.g. "19" pulls a metrics section).
                // Keep named entities ("Mercury X1", "OpenVLA-OFT").
                const hintEntities = extractHighSignalEntityTerms(options.followUpReferentHint)
                    .filter(t => !/^\d[\d.,]*$/.test(t.trim()));
                if (hintEntities.length > 0) {
                    referentEnrichment = hintEntities.slice(0, 3).join(' ');
                }
            }
        }
        const bareQueryText = forceDocumentGrounding
            ? `${options.query}${referentEnrichment ? '\n' + referentEnrichment : ''}`.trim()
            : `${options.query}\n${options.transcript ?? ''}${referentEnrichment ? '\n' + referentEnrichment : ''}`.trim();
        const bareQueryWords = new Set(wordsOf(bareQueryText));
        const queryText = bareQueryWords.size >= 2
            ? bareQueryText
            : `${bareQueryText}\n${expansionQueryText}\n${identityQueryText}`.trim();
        // When document-grounded, filter question/function words from queryWords.
        // "what", "was", "the", etc. appear in almost every chunk body; keeping
        // them in the query set causes noise matches that mis-rank chunks by
        // coincidental occurrence (e.g. "joint states" body contains "what" and
        // outranks the RLDS chunk for Q39). This does NOT affect the 7 default
        // modes or non-grounded paths.
        const queryWordsRaw = wordsOf(queryText);
        const queryWords = new Set(
            forceDocumentGrounding
                ? queryWordsRaw.filter(w => !DOC_GROUNDED_STOPWORDS.has(w))
                : queryWordsRaw,
        );
        const queryShape = classifyDocumentQuestionShape(options.query || '', options.followUpReferentHint);
        const broadQuery = isBroadDocumentQuery(options.query || '');
        const includeDocumentIdentity = forceDocumentGrounding && broadQuery;
        const documentIdentityBlock = includeDocumentIdentity ? buildDocumentIdentityBlock(mode, documentIdentities) : '';
        diagLog('DOC-RANK identity', { queryShape, broadQuery, identityIncluded: includeDocumentIdentity, reason: includeDocumentIdentity ? 'broad_overview_query' : 'specific_query_suppressed' });

        // Zero-token query (all words ≤2 chars after possessive/contraction
        // stripping, or punctuation-only input). The adaptive threshold would
        // otherwise collapse to 0 and the `score < 0` filter would admit
        // every chunk with score 0, drowning the prompt in noise. Short-
        // circuit to the fallback path explicitly unless a document-grounded
        // custom mode supplied a compact identity block.
        if (queryWords.size === 0 && !documentIdentityBlock) {
            return { snippets: [], formattedContext: '', usedFallback: true };
        }

        const sources: ModeKnowledgeSource[] = [];

        // Scope customContext by answer type before it enters retrieval, so a
        // salary/pricing note in the mode's custom context can't be retrieved
        // into a coding/identity/behavioral answer. No-op when answerType is
        // unset (backward compatible). Skipped entirely when the caller pins
        // the customContext directly (PI v3 W2 — no duplicate injection).
        if (!options.excludeCustomContext) {
            const scopedCustom = scopeCustomContext(mode.customContext, options.answerType);
            if (scopedCustom.sensitiveDropped) {
                console.warn('[ModeContextRetriever] dropped sensitive customContext chunk(s) — not relevant to answer type', {
                    answerType: options.answerType,
                });
            }
            if (scopedCustom.text) {
                sources.push({
                    id: `${mode.id}:custom_context`,
                    type: 'custom_context',
                    content: scopedCustom.text,
                });
            }
        }

        for (const file of files) {
            if (!file.content.trim()) continue;
            sources.push({
                id: file.id,
                type: 'reference_file',
                fileName: file.fileName,
                content: file.content.trim(),
            });
        }

        // Adaptive threshold: when the user has not yet accumulated transcript
        // context (e.g. start of a session, or a typed question before the
        // call begins) and the bare query has few unique tokens, the
        // theoretical max score is mechanically lower because the denominator
        // sqrt(querySize * chunkSize) does not shrink with the query. A
        // 3-token query against a ~50-word chunk caps out around 0.245 even
        // if every query token matches the chunk. The full 0.18 floor leaves
        // very little headroom and rejects relevant chunks that a transcript
        // would have rescued. Scale the floor by querySize/5 (capped at 1)
        // ONLY when no transcript is provided; production mid-session calls
        // (transcript present) are unaffected. See FINDING-001 in
        // docs/testing/MODES_PROFILE_INTELLIGENCE_BUGFIX_LOG.md.
        const hasTranscript = !forceDocumentGrounding && !!options.transcript && options.transcript.trim().length > 0;
        const adaptiveThreshold = hasTranscript
            ? MIN_RELEVANCE_SCORE
            : MIN_RELEVANCE_SCORE * Math.min(1, queryWords.size / 5);

        // Chunk a source the right way: a STRUCTURED reference file (real ToC +
        // numbered sections, e.g. a thesis PDF) is chunked by SECTION via the
        // document map, which excludes the Table of Contents — the round-6 fix
        // for the model only ever seeing the "3.4.1 Conversational Agent" ToC
        // fragment. A flat-prose reference file (the seminar fixtures, a slide
        // deck) or custom_context falls back to the existing chunkText path.
        const chunksForSource = (source: ModeKnowledgeSource): string[] => {
            if (forceDocumentGrounding && source.type === 'reference_file') {
                const sectionChunks = sectionAwareChunks(source.id, source.content);
                if (sectionChunks) return sectionChunks;
            }
            return chunkText(source.content, forceDocumentGrounding);
        };

        // QUERY PLANNER (round-6 Stage 3): resolve the question to the document
        // SECTIONS it most likely targets, using the section titles from the
        // document map. A chunk whose `[Section N.N | …]` tag matches a target
        // section gets a bounded relevance lift, so e.g. "What is the role of
        // ROS#?" surfaces §2.4.2 ROS# above the §2 parent chapter that merely
        // mentions ROS# once. ADVISORY only — the lift is added to the score,
        // never a hard filter, so a fact that lives outside the predicted
        // section is still reachable via lexical/entity scoring.
        // Keep the targets ORDERED (best-first) and only take the top few, so a
        // low-confidence 3rd/4th match doesn't spray boosts across the document.
        let targetList: string[] = [];
        // Sibling sections of the planner's targets (round-7 Failure-1 fix). The
        // planner resolves a query to a section by TITLE, but a specific fact
        // frequently lives in a SIBLING subsection under the same parent — e.g.
        // "how many episodes / at what sampling rate?" title-matches
        // "3.2.3 Dataset Structure and Format" while the 480-episodes / 25 Hz
        // facts sit in the sibling "3.2.2 Data acquisition process". The exact/
        // descendant-only sectionBoost gives those siblings zero lift, so on a
        // flat lexical field the answer-bearing sibling never enters top-K.
        // We collect the siblings (same parent prefix, from the REAL section
        // tree) and give them a smaller secondary boost below. Structural and
        // domain-agnostic — no document-specific section numbers are hardcoded.
        const siblingTargets = new Set<string>();
        // Planner query includes the follow-up referent enrichment (round-7
        // Failure-2): for an anaphoric follow-up ("What processor controls it?")
        // the bare query routes the planner to the wrong section (§2.4.1 VR),
        // but the enrichment ("Mercury X1") routes it to §2.3 Mercury X1 Robot,
        // whose child §2.3.2 holds the Jetson controller. The enrichment is
        // retrieval-side only; it never enters the model-visible prompt.
        const plannerQuery = referentEnrichment
            ? `${options.query} ${referentEnrichment}`
            : options.query;
        if (forceDocumentGrounding && plannerQuery) {
            for (const source of sources) {
                if (source.type !== 'reference_file') continue;
                const map = getCachedDocumentMap(source.id, source.content);
                if (!map.hasToc) continue;
                const t = resolveTargetSections(plannerQuery, map);
                if (t.length > targetList.length) targetList = t;
            }
            // Follow-up referent: ALSO target the section the referent ENTITY
            // itself names (round-7 Failure-2). The question words ("processor
            // controls") route the planner to the control-pipeline section, but
            // the fact ("Mercury X1 … Jetson controller") lives in the ENTITY's
            // own section (§2.3 Mercury X1 Robot → §2.3.2 Technical Specs). We
            // resolve the referent entities on their own and MERGE their target
            // sections in, so both the topic section and the entity section get
            // the boost. Appended (not replacing) so the primary query targets
            // still lead.
            if (referentEnrichment) {
                for (const source of sources) {
                    if (source.type !== 'reference_file') continue;
                    const map = getCachedDocumentMap(source.id, source.content);
                    if (!map.hasToc) continue;
                    const entTargets = resolveTargetSections(referentEnrichment, map);
                    for (const et of entTargets) {
                        if (!targetList.includes(et)) targetList.push(et);
                    }
                }
            }
            // Build the sibling set from the winning targetList against the map.
            if (targetList.length > 0) {
                for (const source of sources) {
                    if (source.type !== 'reference_file') continue;
                    const map = getCachedDocumentMap(source.id, source.content);
                    if (!map.hasToc) continue;
                    const sectionNums = map.sections.map(s => s.num).filter((n): n is string => !!n);
                    for (const t of targetList.slice(0, 2)) { // only expand the top-2 targets
                        const lastDot = t.lastIndexOf('.');
                        if (lastDot === -1) continue; // top-level chapter has no "sibling parent"
                        const parent = t.slice(0, lastDot);
                        for (const sn of sectionNums) {
                            // A sibling shares the parent prefix, is one level below
                            // the parent (a direct child), and is NOT already a target
                            // or a descendant of one.
                            if (sn === t) continue;
                            if (!sn.startsWith(parent + '.')) continue;
                            if (sn.slice(parent.length + 1).includes('.')) continue; // deeper than a direct child
                            const isTargetOrDesc = targetList.some(tt => sn === tt || sn.startsWith(tt + '.'));
                            if (!isTargetOrDesc) siblingTargets.add(sn);
                        }
                    }
                }
            }
        }
        diagLog('LEXICAL planner', { plannerQuery, targetList, siblingTargets: Array.from(siblingTargets), referentEnrichment });
        // Pull the section number out of a chunk's `[Section N.N | …]` tag.
        const chunkSectionNum = (text: string): string | null => {
            const m = text.match(/^\[Section\s+([\d.]+)\s*\|/);
            return m ? m[1] : null;
        };
        const navigationEntriesBySource = new Map<string, Set<string>>();
        if (forceDocumentGrounding && queryShape === 'document_structure_answer') {
            for (const source of sources) {
                if (source.type !== 'reference_file') continue;
                const entries = selectTableOfContentsEntries(options.query, getCachedDocumentMap(source.id, source.content));
                if (entries.length > 0) navigationEntriesBySource.set(source.id, new Set(entries));
            }
        }
        const isMatchingNavigationChunk = (sourceId: string, text: string): boolean => {
            if (!text.startsWith('[Table of Contents |')) return false;
            const entries = navigationEntriesBySource.get(sourceId);
            return Boolean(entries && [...entries].some((entry) => text.includes(entry)));
        };
        // Boost a chunk for being IN a target section or a DESCENDANT of one
        // (a target "2.3" pulls "2.3.2 Technical Specifications"). We do NOT
        // boost ANCESTORS — boosting the broad "2" chapter for a "2.4.2" target
        // is what let the parent chapter outrank the specific section. The lift
        // decays by target RANK (top-predicted section wins) AND by DEPTH
        // DISTANCE from the target, so when the planner returns a broad parent
        // like "2.4" a deep descendant doesn't get the full lift sprayed across
        // every subsection — the exact-match section still wins.
        const depthOf = (n: string): number => n.split('.').length;
        const sectionBoost = (secNum: string | null): number => {
            if (!secNum || targetList.length === 0) return 0;
            for (let i = 0; i < targetList.length; i++) {
                const t = targetList[i];
                const isExact = secNum === t;
                const isDescendant = secNum.startsWith(t + '.');
                if (!isExact && !isDescendant) continue;
                // Rank decay (0.6^i) × depth weighting. A DIRECT child
                // (levelsBelow=1) is boosted SLIGHTLY ABOVE its exact-match
                // parent: the planner frequently returns a broad parent like
                // "2.3 Mercury X1 Robot" while the actual fact (sensors, specs)
                // lives in the "2.3.1"/"2.3.2" child, and the generic parent
                // chunk otherwise outranks and DILUTES the specific child. Deep
                // descendants (≥2 levels) are damped to avoid spraying the lift
                // across a whole chapter subtree.
                const levelsBelow = isExact ? 0 : depthOf(secNum) - depthOf(t);
                let depthWeight: number;
                if (levelsBelow === 0) depthWeight = 1.0;        // exact match
                else if (levelsBelow === 1) depthWeight = 1.1;   // direct child wins over generic parent
                else depthWeight = Math.pow(0.7, levelsBelow);   // deep descendant damped
                return Math.min(0.4, 0.35 * Math.pow(0.6, i) * depthWeight);
            }
            // Sibling lift (round-7 Failure-1 fix): a direct sibling of a top
            // target gets a SMALLER bounded boost so the answer-bearing sibling
            // subsection (e.g. "3.2.2 Data acquisition process" when the planner
            // targeted "3.2.3 Dataset Structure and Format") can enter top-K
            // without OUTRANKING the exact target. Capped at 0.15 — below the
            // exact/child lift (≥0.19 at rank 0) so it only rescues, never
            // dominates. Only applies to the flat conceptual queries this whole
            // block already gates on (forceDocumentGrounding).
            if (siblingTargets.has(secNum)) return 0.15;
            return 0;
        };

        // Precompute the query's entity terms ONCE (was recomputed per chunk
        // inside scoreChunk across all three scoring loops).
        const queryEntityTerms = precomputeEntityTerms(options.query, forceDocumentGrounding);

        // Within-section tiebreak (round-6 51-bench): when the planner targets a
        // long section EVERY window gets the same section boost, so the generic
        // first window can outrank the window that actually holds the answer
        // ("how many parameters" → the "7B-parameter" window; "what format" →
        // the "RLDS format" window). A chunk that contains a query content word
        // gets a tiny bonus so the right window surfaces. Matching is PREFIX-
        // based (≥4 chars) so "parameters"/"parameter" and "format"/"formats"
        // unify without a full stemmer.
        const queryContentStems = forceDocumentGrounding && options.query
            ? [...new Set(wordsOf(options.query))]
                .filter(w => w.length >= 4 && !DOC_GROUNDED_STOPWORDS.has(w))
                .map(w => w.slice(0, Math.max(4, w.length - 1))) // crude stem: drop trailing plural/inflection
            : [];
        const contentWordBonus = (chunk: string): number => {
            if (queryContentStems.length === 0) return 0;
            const lower = chunk.toLowerCase();
            let hit = 0;
            for (const stem of queryContentStems) if (lower.includes(stem)) hit++;
            // Tiebreak WITHIN equally-section-boosted chunks: the chunk that
            // contains MORE content-word stems from the query wins. Raised from
            // 0.03/0.06 to 0.05/0.15 so the "RLDS format" chunk decisively
            // outranks the "joint states array" chunk for "what format was the
            // dataset stored in?" — both get the same sectionBoost (both §3.2.3),
            // but only the RLDS chunk contains "forma" (from "format").
            return Math.min(0.15, 0.05 * hit);
        };
        const candidates: ModeRetrievedSnippet[] = [];
        for (const source of sources) {
            for (const chunk of chunksForSource(source)) {
                const navigationMatch = isMatchingNavigationChunk(source.id, chunk);
                let score = scoreChunk(queryWords, chunk, options.query, forceDocumentGrounding, queryEntityTerms);
                const boost = sectionBoost(chunkSectionNum(chunk));
                if (boost > 0) score = Math.min(1, score + boost + contentWordBonus(chunk));
                if (navigationMatch) score = Math.max(score, 0.9);
                if (score < adaptiveThreshold) continue;
                candidates.push({
                    sourceId: source.id,
                    sourceType: source.type,
                    fileName: source.fileName,
                    text: chunk,
                    score,
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        // Conceptual-query rescue (audit 2026-06-28, weak-model real-path fix).
        // A vague question whose answer uses DIFFERENT words than the question
        // ("four main phases" → the doc says "objectives include teleoperation,
        // data collection, training…"; "evaluation metrics" → "Success Rate",
        // "MSE") scores low on the bare query and would fail closed. When the
        // bare pass found too few strong candidates, re-score WITH the
        // document section-expansion terms (title/abstract/methodology/
        // objectives/results/evaluation metrics/…) added — at a reduced weight —
        // so a chunk that belongs to the asked-about SECTION is rescued. Precise
        // entity queries (OpenVLA-OFT) already cleared the bar on the bare pass,
        // so they never reach this and stay un-diluted.
        const STRONG_SCORE = MIN_RELEVANCE_SCORE * 2;
        const strongCount = candidates.filter(c => c.score >= STRONG_SCORE).length;
        // Flat-field trigger (round-7 Failure-1): the failing-question signature
        // is a FLAT top with a long tail (e.g. [0.51,0.50,0.50,0.48,…]) — many
        // chunks clear STRONG_SCORE so `strongCount < 3` is false, yet NO chunk
        // decisively wins, so the abstract/recap chunk anchors the answer (A7/D5
        // over-refuse; the answer-bearing section never surfaces). Detect it as a
        // small top-vs-median margin and let the concept rescue fire so the
        // section-hint boost can break the tie. Domain-agnostic; only affects the
        // doc-grounded path. Threshold 0.12 chosen so a genuinely sharp peak
        // ([0.92,0.53,…], margin 0.39) never trips it — only true flat fields do.
        const flatField = (() => {
            if (candidates.length < 4) return false;
            const top = candidates[0].score;
            const mid = candidates[Math.floor(candidates.length / 2)].score;
            return (top - mid) < 0.12;
        })();
        if (retrievalDiagnosticsEnabled()) {
            diagLog('LEXICAL rescue-gate', {
                candidateCount: candidates.length,
                strongCount,
                flatField,
                rescueWillFire: forceDocumentGrounding && (strongCount < 3 || flatField),
                top5: candidates.slice(0, 5).map(c => ({ score: Number(c.score.toFixed(3)), sec: (c.text.match(/^\[Section\s+([\d.]+)/) || [])[1] ?? 'UNTAGGED', file: c.sourceId.slice(0, 12) })),
            });
        }
        if (forceDocumentGrounding && (strongCount < 3 || flatField)) {
            // Map the user's question to the document SECTIONS it is asking about
            // using a small, domain-agnostic synonym table (question word →
            // section term that appears in academic/thesis writing). Then give a
            // strong additive boost to any chunk that contains a matched section
            // term verbatim. This rescues conceptual queries whose answer uses
            // different words than the question ("four main phases" → the
            // "objectives" sentence; "evaluation metrics" → the metric rows)
            // WITHOUT polluting precise entity queries (which already cleared the
            // bar on the bare pass and never reach here).
            // Domain-AGNOSTIC question-word → section-word synonyms only. These
            // are generic academic-writing vocabulary (a "phase" question is
            // answered by an "objectives"/"stages" sentence; a "metric" question
            // by an "evaluation"/"metric" sentence). NO fixture-specific terms
            // (no "teleoperation"/"Success Rate"/"MSE") are hardcoded — the boost
            // only fires when the CHUNK itself contains the generic section word.
            const ql = `${options.query ?? ''}`.toLowerCase();
            const sectionHints: string[] = [];
            const addHint = (...terms: string[]) => sectionHints.push(...terms);
            if (/\bphase|phases|stage|stages|step|steps|main (?:parts|components)\b/.test(ql)) addHint('objective', 'phase', 'stage', 'step');
            if (/\bmetric|metrics|measure|measured|evaluat|accuracy\b/.test(ql)) addHint('metric', 'evaluation', 'measure');
            if (/\bmethod|methodology|approach|procedure\b/.test(ql)) addHint('methodology', 'procedure', 'method');
            if (/\bdataset|data set|preprocess|format\b/.test(ql)) addHint('dataset', 'preprocessing', 'format');
            if (/\bresult|results|finding|findings|outcome\b/.test(ql)) addHint('result', 'finding', 'conclusion');
            if (/\blimitation|limitations|challenge|challenges|future work\b/.test(ql)) addHint('limitation', 'challenge', 'future');
            if (/\bobjective|objectives|aim|purpose|goal|goals\b/.test(ql)) addHint('objective', 'aim', 'goal', 'purpose');
            // Conclusion / summary concept (round-7 A7): "conclusion" is rarely a
            // literal section title (docs use "Summary of Findings", "Final
            // Remarks", "Concluding Remarks"), so the planner returns nothing and
            // the bare query goes flat → over-refusal. Map the concept to the
            // generic closing-section vocabulary.
            if (/\bconclu(?:sion|de|ding)|takeaway|summary|summar(?:ise|ize)|final remark|wrap[- ]?up|in summary\b/.test(ql)) addHint('conclusion', 'summary', 'finding', 'remark', 'concluding');
            // Environment / setting concept (round-7 D5): "was it tested outdoors
            // or in a lab?" answers live in the discussion/validity/limitations
            // sections ("controlled setting", "environment was intentionally
            // limited", "internal/external validity"), which share no query words.
            // Map the concept to that discussion-section vocabulary so the
            // conceptual rescue boosts those chunks. Generic academic vocabulary.
            if (/\b(outdoor|outdoors|indoor|lab\b|laboratory|environment|setting|real[- ]world|in the wild|deploy(?:ed|ment)?|controlled)\b/.test(ql)) addHint('environment', 'setting', 'controlled', 'validity', 'reliability', 'limitation', 'discussion', 'generaliz');

            diagLog('LEXICAL rescue-hints', { ql, sectionHints });
            if (sectionHints.length > 0) {
                const rescued = new Map<string, ModeRetrievedSnippet>();
                for (const c of candidates) rescued.set(`${c.sourceId}::${c.text}`, c);
                // Fix 3 (2026-07-06): entity-anchor guard. The synonym rescue
                // admits any chunk that contains a generic section word
                // ("abstract", "methodology", "phase"), which lets the abstract
                // chunk beat the precise answer chunk whenever the answer chunk
                // happens to not contain the synonym. Require that the rescued
                // chunk ALSO contain at least one core entity term from the query
                // when entities exist (e.g. "Vision-Language-Action" / "GPU" /
                // "Mercury X1"). Falls through to the synonym-only rescue when
                // no entities are present in the query (broad / vague questions),
                // so the original behaviour is preserved for entity-less questions.
                const ownEntityTerms = forceDocumentGrounding && options.query
                    ? extractHighSignalEntityTerms(options.query)
                        .filter(t => !/^\d[\d.,]*$/.test(t.trim()))   // drop pure numbers
                        .map(t => t.toLowerCase())
                    : [];
                for (const source of sources) {
                    for (const chunk of chunksForSource(source)) {
                        const chunkLower = chunk.toLowerCase();
                        const hitCount = sectionHints.filter(h => chunkLower.includes(h)).length;
                        if (hitCount === 0) continue;
                        // Entity-anchor gate: when the query has entities, the
                        // chunk must contain at least one. This filters out
                        // generic abstract chunks that mention "phase" or
                        // "methodology" without actually addressing the asked-
                        // about entity.
                        if (ownEntityTerms.length > 0) {
                            const entityHit = ownEntityTerms.some(e => chunkLower.includes(e));
                            if (!entityHit) continue;
                        }
                        const key = `${source.id}::${chunk}`;
                        let base = scoreChunk(queryWords, chunk, options.query, forceDocumentGrounding, queryEntityTerms);
                        // Carry forward the section-target boost so a rescued
                        // chunk in a TARGET section isn't demoted below its
                        // first-pass rank (consistency across the two passes).
                        const rb = sectionBoost(chunkSectionNum(chunk));
                        if (rb > 0) base = Math.min(1, base + rb);
                        // BOUNDED rescue (round-6): convex-combine the base score
                        // with a section-hint coverage signal so the result stays
                        // in [0,1] (was `base + 0.4*hitCount`, unbounded). A chunk
                        // in the asked-about section gets a meaningful lift but
                        // can't exceed a perfectly-matching chunk elsewhere.
                        const hintFrac = Math.min(1, hitCount / Math.max(1, sectionHints.length));
                        // When entity-anchor is active, weight the hint coverage
                        // a little lower (0.30) so the base score dominates and
                        // the entity match is the primary signal. Falls back to
                        // the original 0.40 when no entity anchor is present.
                        const entityAnchorActive = ownEntityTerms.length > 0;
                        const hintWeight = entityAnchorActive ? 0.30 : 0.40;
                        const boosted = (1 - hintWeight) * base + hintWeight * hintFrac;
                        const existing = rescued.get(key);
                        if (!existing || boosted > existing.score) {
                            rescued.set(key, {
                                sourceId: source.id,
                                sourceType: source.type,
                                fileName: source.fileName,
                                text: chunk,
                                score: boosted,
                            });
                        }
                    }
                }
                candidates.length = 0;
                candidates.push(...rescued.values());
                candidates.sort((a, b) => b.score - a.score);
            }
        }

        const selected: ModeRetrievedSnippet[] = [];
        let tokenTotal = 0;
        // When forceDocumentGrounding is active and the caller left the limits at
        // defaults, upgrade to the larger doc-grounded limits so large PDFs get
        // enough chunks to cover the full answer. Explicit caller overrides win.
        const tokenBudget = options.tokenBudget != null
            ? options.tokenBudget
            : (forceDocumentGrounding ? DOC_GROUNDED_TOKEN_BUDGET : DEFAULT_TOKEN_BUDGET);
        const topK = options.topK != null
            ? options.topK
            : (forceDocumentGrounding ? DOC_GROUNDED_TOP_K : DEFAULT_TOP_K);

        // Per-section diversity cap (round-7 Failure-1 fix #2). A section with
        // many near-duplicate windows (e.g. 9 chunks of §4.2.1 benchmarks) can
        // monopolize top-K and starve the section that actually answers a
        // conceptual query (e.g. §4.3.1 "controlled setting" for "lab or
        // outdoors?"). Two-pass select: pass 1 admits at most SECTION_CAP chunks
        // per section (so ≥topK/SECTION_CAP distinct sections appear); pass 2
        // fills any remaining budget by pure score. Only for doc-grounded conceptual
        // queries — precise entity queries with a sharp peak are unaffected
        // because their winning section legitimately holds the answer and pass 2
        // backfills it anyway. Domain-agnostic; no document strings.
        const SECTION_CAP = 3;
        const admit = (candidate: ModeRetrievedSnippet): boolean => {
            const tokens = estimateTokens(candidate.text);
            if (tokenTotal + tokens > tokenBudget && selected.length > 0) return false;
            selected.push(candidate);
            tokenTotal += tokens;
            return true;
        };
        if (forceDocumentGrounding) {
            const perSection = new Map<string, number>();
            const chosen = new Set<ModeRetrievedSnippet>();
            // Pass 1: diversity-capped.
            for (const candidate of candidates) {
                if (selected.length >= topK) break;
                const sn = chunkSectionNum(candidate.text) ?? `__nosec_${candidate.text.slice(0, 16)}`;
                const n = perSection.get(sn) ?? 0;
                if (n >= SECTION_CAP) continue;
                if (admit(candidate)) { perSection.set(sn, n + 1); chosen.add(candidate); }
            }
            // Pass 2: fill remaining slots by pure score (may exceed the cap now).
            for (const candidate of candidates) {
                if (selected.length >= topK) break;
                if (chosen.has(candidate)) continue;
                if (admit(candidate)) chosen.add(candidate);
            }
            if (retrievalDiagnosticsEnabled()) {
                diagLog('LEXICAL section-cap selected TOP-K', {
                    SECTION_CAP, topK, selectedCount: selected.length,
                    rows: selected.map((s, i) => ({
                        rank: i,
                        score: Number(s.score.toFixed(3)),
                        sec: (s.text.match(/^\[Section\s+([\d.]+)/) || [])[1] ?? 'UNTAGGED',
                        page: (s.text.match(/\|\s*p(\d+)/) || [])[1] ?? '?',
                        file: s.sourceId.slice(0, 12),
                        first80: s.text.replace(/\s+/g, ' ').slice(0, 80),
                    })),
                });
            }
        } else {
            for (const candidate of candidates) {
                const tokens = estimateTokens(candidate.text);
                if (tokenTotal + tokens > tokenBudget && selected.length > 0) continue;
                selected.push(candidate);
                tokenTotal += tokens;
                if (selected.length >= topK) break;
            }
        }


        if (selected.length === 0 && !documentIdentityBlock) {
            // Targeted retry (audit 2026-06-27): when document-grounded mode
            // got zero chunks on the first pass and the query contains
            // high-signal entity terms (capitalised / mixed-case / has digits),
            // broaden the search using those terms as the new query. This
            // rescues cases where the model would otherwise say "not directly
            // mentioned" for a fact that IS in the document but lexically
            // distant from the user's question (e.g. user asks "How many
            // joints does Mercury have?" and the doc says "Mercury X1 has 19
            // degrees of freedom").
            if (forceDocumentGrounding) {
                const retryTerms = extractHighSignalEntityTerms(options.query ?? '');
                if (retryTerms.length > 0) {
                    const retryQueryWords = new Set(
                        retryTerms.flatMap((t) => wordsOf(t)),
                    );
                    // retryTerms ARE the entity terms — reuse them directly so
                    // scoreChunk doesn't re-extract per chunk.
                    const retryEntityTerms = forceDocumentGrounding && retryTerms.length > 0 ? retryTerms : null;
                    const retryCandidates: ModeRetrievedSnippet[] = [];
                    for (const source of sources) {
                        for (const chunk of chunksForSource(source)) {
                            const score = Math.max(0, Math.min(1, scoreChunk(retryQueryWords, chunk, retryTerms.join(" "), forceDocumentGrounding, retryEntityTerms)));
                            if (score < MIN_RELEVANCE_SCORE) continue;
                            retryCandidates.push({
                                sourceId: source.id,
                                sourceType: source.type,
                                fileName: source.fileName,
                                text: chunk,
                                score,
                            });
                        }
                    }
                    retryCandidates.sort((a, b) => b.score - a.score);
                    const retrySelected: ModeRetrievedSnippet[] = [];
                    let retryTokens = 0;
                    for (const c of retryCandidates) {
                        const t = estimateTokens(c.text);
                        if (retryTokens + t > tokenBudget && retrySelected.length > 0) continue;
                        retrySelected.push(c);
                        retryTokens += t;
                        if (retrySelected.length >= topK) break;
                    }
                    if (retrySelected.length > 0) {
                        // Retry success emits the standard <active_mode_retrieved_context>
                        // envelope and <evidence_use_rule> via EVIDENCE_USE_RULE below.
                        console.log('[ModeContextRetriever] document-grounded targeted retry', {
                            firstPassTooGeneric: true,
                            targetedRetryTriggered: true,
                            targetedRetryTerms: retryTerms,
                            targetedRetryRetrievedChunks: retrySelected.length,
                            targetedRetryMatchedPages: retrySelected
                                .map((s) => extractPageMarker(s.text))
                                .filter((p): p is number => p !== null),
                            targetedRetryMatchedSections: retrySelected
                                .map((s) => extractFirstHeading(s.text))
                                .filter((s): s is string => s !== null),
                        });
                        // Apply the same presentation-order lift the main path uses:
                        // move chunks from the planner's target sections to the front.
                        const retryOrdered = targetList.length > 0
                            ? [
                                ...retrySelected.filter(s => {
                                    const sn = chunkSectionNum(s.text);
                                    return sn !== null && targetList.some(t => sn === t || sn.startsWith(t + '.'));
                                }),
                                ...retrySelected.filter(s => {
                                    const sn = chunkSectionNum(s.text);
                                    return !(sn !== null && targetList.some(t => sn === t || sn.startsWith(t + '.')));
                                }),
                            ]
                            : retrySelected;
                        const finalChunks: string[] = ['<active_mode_retrieved_context>'];
                        finalChunks.push(EVIDENCE_USE_RULE);
                        finalChunks.push(`  <mode>${escapeXmlText(mode.name)}</mode>`);
                        for (const snippet of retryOrdered) {
                            finalChunks.push('  <snippet>');
                            finalChunks.push(`    <source>${encodePayload({ type: snippet.sourceType, fileName: snippet.fileName, sourceId: snippet.sourceId })}</source>`);
                            finalChunks.push(`    <text>${escapeXmlText(snippet.text)}</text>`);
                            finalChunks.push('  </snippet>');
                        }
                        finalChunks.push('</active_mode_retrieved_context>');
                        return {
                            snippets: retrySelected,
                            formattedContext: finalChunks.join('\n'),
                            usedFallback: false,
                        };
                    }
                    console.warn('[ModeContextRetriever] document-grounded retrieval miss after targeted retry', {
                        firstPassTooGeneric: true,
                        targetedRetryTriggered: true,
                        targetedRetryTerms: retryTerms,
                        ...reportReferenceFilePageCounts(files),
                    });
                } else {
                    console.warn('[ModeContextRetriever] document-grounded retrieval miss', {
                        retrievalRequired: true,
                        retrievalSkipped: false,
                        retrievedReferenceChunks: 0,
                        referenceFileChunkCount: candidates.length,
                        ...reportReferenceFilePageCounts(files),
                    });
                }
            }
            return { snippets: [], formattedContext: '', usedFallback: true };
        }

        if (forceDocumentGrounding) {
            // REAL section + page telemetry (round-6 Stage 4). The selected
            // chunks now carry `[Section N.N | pX-Y] heading` tags from the
            // document map, so we report the ACTUAL sections and pages the
            // answer was grounded in — not the old fixed 14-word expansion list
            // (which could only ever say "introduction/results/…") and not the
            // hard-coded `queryMatchedPages: []`. Falls back to the old
            // expansion-word scan for flat-prose files that have no section tags.
            const sectionTagRe = /\[Section\s+([\d.]+)\s*\|\s*p(\d+)(?:-(\d+))?\]/g;
            const matchedSectionSet = new Set<string>();
            const matchedPageSet = new Set<number>();
            for (const snippet of selected) {
                let m: RegExpExecArray | null;
                sectionTagRe.lastIndex = 0;
                let taggedHere = false;
                while ((m = sectionTagRe.exec(snippet.text)) !== null) {
                    taggedHere = true;
                    matchedSectionSet.add(m[1]);
                    const start = parseInt(m[2], 10);
                    const end = m[3] ? parseInt(m[3], 10) : start;
                    for (let p = start; p <= end && p - start < 30; p++) matchedPageSet.add(p);
                }
                if (!taggedHere) {
                    const pm = extractPageMarker(snippet.text);
                    if (pm !== null) matchedPageSet.add(pm);
                }
            }
            const matchedSections = matchedSectionSet.size > 0
                ? Array.from(matchedSectionSet).sort()
                : DOCUMENT_GROUNDED_QUERY_EXPANSION.filter(section =>
                    selected.some(snippet => snippet.text.toLowerCase().includes(section.toLowerCase())));
            console.log('[ModeContextRetriever] document-grounded retrieval', {
                retrievalRequired: true,
                retrievalSource: 'reference_files',
                retrievalSkipped: false,
                retrievedReferenceChunks: selected.filter(s => s.sourceType === 'reference_file').length,
                topReferenceScores: selected.slice(0, 5).map(s => Number(s.score.toFixed(3))),
                promptContainsReferenceFileContext: selected.some(s => s.sourceType === 'reference_file') || Boolean(documentIdentityBlock),
                ...reportReferenceFilePageCounts(files),
                referenceFileChunkCount: candidates.length,
                referenceFileLastIndexedAt: new Date().toISOString(),
                queryMatchedPages: Array.from(matchedPageSet).sort((a, b) => a - b),
                queryMatchedSections: matchedSections,
            });
        }

        // Presentation-order lift (round-6 Q39 fix): flash-lite reads chunks in
        // sequence and the first chunk dominates its answer. When we have target
        // sections from the planner, move chunks FROM those sections to the front
        // of the prompt even if they scored lower than off-target chunks (§3.3
        // "Results" legitimately mentions "dataset/format" many times and beats
        // §3.2.3 "Preprocessing and RLDS format" on raw lexical, but the answer
        // lives in §3.2.3). This is a presentation change only — the same chunks
        // are selected; only the order the model reads them changes.
        // Safe: targetList is empty for non-doc-grounded paths and for queries
        // where the planner returned nothing — so default modes are unaffected.
        const orderedForPrompt = targetList.length > 0
            ? [
                ...selected.filter(s => {
                    const sn = chunkSectionNum(s.text);
                    return sn !== null && targetList.some(t => sn === t || sn.startsWith(t + '.'));
                }),
                ...selected.filter(s => {
                    const sn = chunkSectionNum(s.text);
                    return !(sn !== null && targetList.some(t => sn === t || sn.startsWith(t + '.')));
                }),
            ]
            : selected;

        const lines = ['<active_mode_retrieved_context>'];
        lines.push(EVIDENCE_USE_RULE);
        lines.push(`  <mode>${escapeXmlText(mode.name)}</mode>`);
        if (documentIdentityBlock) lines.push(documentIdentityBlock);
        for (const snippet of orderedForPrompt) {
            lines.push('  <snippet>');
            lines.push(`    <source>${encodePayload({ type: snippet.sourceType, fileName: snippet.fileName, sourceId: snippet.sourceId })}</source>`);
            lines.push(`    <text>${escapeXmlText(snippet.text)}</text>`);
            lines.push('  </snippet>');
        }
        lines.push('</active_mode_retrieved_context>');

        // Document-type-agnostic confidence (diagnostics; consumed only by the
        // modes:build-retrieved-context debug IPC, NOT by the doc-grounded
        // false-refusal repair gate). Raw top score normalized against this
        // query's own adaptive floor — works across ToC and flat-prose docs.
        const topRawScore = selected.length > 0 ? Math.max(...selected.map(s => s.score)) : 0;
        const confidenceReference = Math.max(adaptiveThreshold * 2.5, 1e-6);
        const topScoreConfidence = Math.max(0, Math.min(1, topRawScore / confidenceReference));

        return {
            snippets: selected,
            formattedContext: lines.join('\n'),
            usedFallback: false,
            topScoreConfidence,
        };
    }

    /**
     * Hybrid retrieval combining FTS/BM25 + vector semantic search.
     * Falls back to lexical-only if embedding provider is unavailable.
     */
    setSharedEmbeddingPipeline(pipeline: EmbeddingPipeline): void {
        this._sharedEmbeddingPipeline = pipeline;
        // Drop any retriever created before RAGManager injected the initialized pipeline.
        this._hybridRetriever = null;
    }

    async retryLexicalOnlyFiles(files: ModeReferenceFile[]): Promise<void> {
        const retriever = this.ensureHybridRetriever();
        if (!retriever) return;
        for (const file of files) {
            try {
                const { status } = retriever.getFileIndexStatus(file.id);
                if (status === 'lexical_only' || status === 'failed' || status === 'pending') {
                    console.log(`[ModeContextRetriever] re-indexing "${file.fileName}" (was ${status})`);
                    await retriever.indexFile(file);
                }
            } catch (e) {
                console.warn(`[ModeContextRetriever] retryLexicalOnlyFiles failed for "${file.fileName}":`, e instanceof Error ? e.message : e);
            }
        }
    }

    /**
     * Lazily create (and cache) the hybrid retriever. Returns null when the
     * database isn't available yet — callers degrade to lexical.
     *
     * IMPORTANT (2026-07-05 hardening): if a query races ahead of
     * `initializeRAGManager()` (e.g. AppState.initializeRAGManager() throws,
     * or a live transcript turn hits retrieveHybrid() before it has run at
     * all), `_sharedEmbeddingPipeline` is still null here. Previously this
     * branch constructed a throwaway `new EmbeddingPipeline(db, vectorStore)`
     * — an instance that is NEVER initialized (nothing ever calls
     * .initialize() on it), so its `provider` stays null FOREVER — and cached
     * it as `_hybridRetriever` for the rest of the app's lifetime. Every
     * later mode query, even after the real shared pipeline resolves a
     * cloud/local provider, still consulted this doomed orphan and logged
     * "[ModeHybridRetriever] Embedding provider unavailable, using lexical
     * fallback" forever — `setSharedEmbeddingPipeline()`'s cache-invalidation
     * only helps if it is ever called; if RAGManager init failed it never is.
     * Do NOT construct or cache a retriever until the real shared pipeline
     * exists — return null so callers take their existing lexical-fallback
     * path instead, and try again (cheaply — no allocation) on the next call.
     */
    private ensureHybridRetriever(): ModeHybridRetriever | null {
        if (this._hybridRetriever) return this._hybridRetriever;
        if (!this._sharedEmbeddingPipeline) {
            console.warn('[ModeContextRetriever] No shared EmbeddingPipeline injected yet — reference files will index as lexical_only until RAGManager finishes initializing.');
            return null;
        }
        const db = DatabaseManager.getInstance().getDb();
        const dbPath = DatabaseManager.getInstance().getDbPath();
        if (!db) return null;
        // VectorStore needs db, dbPath, and extPath. The mode retriever currently
        // does JS cosine search, so an empty extension path is acceptable here.
        const vectorStore = new VectorStore(db, dbPath, '');
        this._hybridRetriever = new ModeHybridRetriever(db, vectorStore, this._sharedEmbeddingPipeline);
        return this._hybridRetriever;
    }

    // ── PI v3 (W3): upload-time indexing pass-throughs ─────────────────────
    /** Chunk + embed + persist one file's vectors (idempotent, never throws). */
    async indexReferenceFile(file: ModeReferenceFile): Promise<void> {
        const retriever = this.ensureHybridRetriever();
        if (!retriever) return;
        await retriever.indexFile(file);
    }

    /** Index status for the Modes Manager UI badge. */
    getReferenceFileIndexStatus(fileId: string): { status: string; chunkCount: number } {
        const retriever = this.ensureHybridRetriever();
        if (!retriever) return { status: 'pending', chunkCount: 0 };
        return retriever.getFileIndexStatus(fileId);
    }

    /** Drop a deleted file's persisted chunks + index state. */
    removeReferenceFileIndex(fileId: string): void {
        this.ensureHybridRetriever()?.removeFileIndex(fileId);
    }

    async retrieveHybrid(mode: Mode, files: ModeReferenceFile[], options: RetrieveOptions): Promise<HybridContext> {
        diagLog('retrieveHybrid() entry', { query: options.query, forceDocumentGrounding: options.forceDocumentGrounding, fileCount: files.length });
        // Lazily create hybrid retriever on first use
        if (!this.ensureHybridRetriever()) {
            console.warn('[ModeContextRetriever] Database not available for hybrid retrieval');
            // Route through the same throttle the hybrid retriever uses
            // so a sticky DB outage during a 1-hour meeting can't spam
            // hundreds of identical events (the retriever is called per
            // transcript turn). See FINDING-007 in BUGFIX_LOG.
            ModeHybridRetriever.emitFallbackTelemetryStatic({
                reason: 'db_unavailable',
                modeId: mode.id,
            });
            return { chunks: [], formattedContext: '', usedFallback: true, usedHybrid: false };
        }

        // Follow-up referent enrichment (round-7 Failure-2) — mirror the lexical
        // path so the hybrid ranker also gets the referent entities. Retrieval-
        // scoring only; never shown to the model.
        let referentEnrichment = '';
        if (options.forceDocumentGrounding && options.followUpReferentHint && options.query) {
            const looksAnaphoric = /\b(it|its|it's|that|this|they|them|those|these|there|the same|he|she)\b/i.test(options.query);
            const ownEntities = extractHighSignalEntityTerms(options.query);
            if (looksAnaphoric && ownEntities.length === 0) {
                // Mirror the lexical path exactly: drop pure-number entities
                // (prior-answer VALUES, not the subject) and take the top 3.
                const hintEntities = extractHighSignalEntityTerms(options.followUpReferentHint)
                    .filter(t => !/^\d[\d.,]*$/.test(t.trim()));
                if (hintEntities.length > 0) referentEnrichment = '\n' + hintEntities.slice(0, 3).join(' ');
            }
        }
        const queryText = `${options.query}\n${options.transcript ?? ''}${referentEnrichment}`.trim();
        // Doc-grounded retrieval must score against the actual question, not the
        // whole transcript. The transcript is useful conversational context, but in
        // a seminar session it contains generic words like "uploaded thesis material"
        // that swamp short precise queries (hardware/camera/self-awareness) and can
        // cause fallback/ranking to miss the answer-bearing reference chunk.
        const hybridQuery = options.forceDocumentGrounding ? `${options.query}${referentEnrichment}`.trim() : queryText;
        const hasTranscript = !options.forceDocumentGrounding && !!options.transcript && options.transcript.trim().length > 0;

        const result = await this._hybridRetriever!.retrieve({
            query: hybridQuery,
            modeId: mode.id,
            files,
            tokenBudget: options.tokenBudget,
            topK: options.topK,
            hasTranscript,
            allowRerank: options.allowRerank,
            // CRITICAL: forward the document-grounding flag so the hybrid retriever
            // applies the doc-grounded budget/topK upgrade (3600/12) instead of the
            // default 1800/6 — grounded answers were retrieving too small a window.
            forceDocumentGrounding: options.forceDocumentGrounding,
        });

        diagLog('retrieveHybrid() return', { usedFallback: result.usedFallback, usedHybrid: result.usedHybrid, chunkCount: result.chunks?.length, hasContext: !!result.formattedContext });
        return result;
    }

}
