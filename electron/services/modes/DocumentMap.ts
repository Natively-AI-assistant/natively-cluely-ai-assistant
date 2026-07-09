// electron/services/modes/DocumentMap.ts
//
// Document Map for document-grounded custom modes (round-6 rebuild, 2026-06-29).
//
// WHY THIS EXISTS
// ---------------
// Rounds 2-5 patched the model/prompt layer. Round 6 proved (on the real
// 66-page thesis PDF + the live DB) that ingestion is fine — the full 128 KB of
// text with [Page N] markers and every entity is stored — but RETRIEVAL is
// broken. The old chunker's heading regex
//     /^\s*(?:#{1,3}\s+|(?:\d+(?:\.\d+){0,2}\s+))/
// matched Table-of-Contents dotted-leader lines like
//     "3.4.1 Conversational Agent . . . . . . . . . 38"
// as if they were real section headings, fragmenting the ToC into dozens of
// tiny heading-only chunks. Those (plus a generic "response guidelines" chunk)
// won retrieval for almost every question, so the model only ever saw
// "3.4.1 Conversational Agent" and answered "not in the material" for facts
// that are plainly present.
//
// This module builds a real Document Map from the STORED content (no re-upload):
//   - parses and EXCLUDES the Table of Contents
//   - detects REAL section headings (chapter-numbered, not ToC lines, not table
//     rows, not bibliography entries) and their page ranges
//   - produces a section tree: { num, title, pageStart, pageEnd, body }
//   - exposes a flat section list the retriever chunks/indexes over
//
// Validated on the real thesis: ~51 clean sections, 51 ToC lines removed, every
// key section (2.1.2 OpenVLA-OFT p13, 2.3.2 Technical Specifications p17,
// 2.4.2 ROS# p20, 1.1 Research Questions p8, 4.1 Evaluation metrics p44)
// resolves to its correct body.
//
// Code-review hardening (2026-06-29): the "N.N Title <page>" ToC rule is scoped
// to the detected ToC region only (it false-positived on real prose ending in a
// number); the chapter-number cap was raised from 12 to 40 (it silently dropped
// chapters 13+); a bibliography guard rejects "12 Smith et al 2021 …"; sections
// carry pageStart/pageEnd (single-page-of-heading mis-cited multi-page sections).

export interface DocumentSection {
    /** Section number as written, e.g. "2.1.2" or "" for the preamble. */
    num: string;
    /** Full heading line as written, e.g. "2.1.2 OpenVLA-OFT". */
    heading: string;
    /** 1-based page the heading appears on. */
    pageStart: number;
    /** 1-based last page the section body spans. */
    pageEnd: number;
    /** Body text of the section (whitespace-normalised, ToC + heading excluded). */
    body: string;
    /** Depth from the section number (1 = chapter, 2 = section, 3 = subsection). */
    depth: number;
}

export interface DocumentMap {
    sections: DocumentSection[];
    /** Total [Page N] markers seen — the real page count. */
    pageCount: number;
    /** Number of ToC lines excluded from the corpus. */
    tocLinesRemoved: number;
    /** True if a recognisable Table of Contents was detected and excluded AND
     *  enough real sections were found to chunk by section. */
    hasToc: boolean;
    /** Senior-review observability 2026-07-01: which path triggered hasToc.
     *  'A' = classic dotted-leader ToC (path A), 'B' = numbered-headings-only
     *  generalization (path B), null = hasToc=false (no path triggered).
     *  Surfaces in telemetry so support can distinguish structural types. */
    hasTocPath?: 'A' | 'B' | null;
}

const PAGE_MARKER_RE = /^\s*\[Page\s+(\d+)\]\s*$/;
const DOTTED_LEADER_RE = /\.\s?\.\s?\.\s?\./; // ". . . ." navigation leaders
// "N.N Title <pageNumber>" — only treated as ToC INSIDE the detected ToC region.
const TOC_ENTRY_RE = /^\d+(?:\.\d+){0,3}\s+[A-Z].{0,70}?\s+\d{1,3}$/;
// A real section heading: chapter-numbered, Title-cased, no trailing punctuation.
const HEADING_RE = /^(\d+(?:\.\d+){0,3})\s+([A-Z][A-Za-z].{1,68})$/;
// Bibliography / author-year line guard: "12 Smith et al 2021 Robotics", "5 J.
// Doe, A. Roe. 2019". Reject lines whose title looks like an AUTHOR LIST (with
// "et al" or initials-style names) — optionally followed by a year. A bare year
// alone is NOT a signal: real headings like "3.1 The 2020 Dataset" or
// "2.4 ImageNet-2012 Pretraining" contain a year and must survive. We require an
// author-shaped token, and treat a year as corroborating only.
const BIBLIO_RE = /\bet al\b|\b[A-Z]\.\s?[A-Z]?\.?\s+[A-Z][a-z]+|\b[A-Z][a-z]+\s+(?:and|&|,)\s+[A-Z][a-z]+\s+(?:19|20)\d{2}\b/;

function hasDottedLeader(line: string): boolean {
    return DOTTED_LEADER_RE.test(line);
}

// Within the ToC region, a "N.N Title <page>" line is navigation.
function isTocEntryLine(line: string): boolean {
    const t = line.trim();
    return TOC_ENTRY_RE.test(t);
}

function parseHeading(line: string): { num: string; title: string } | null {
    const t = line.trim();
    if (!t) return null;
    if (hasDottedLeader(t)) return null;
    const m = t.match(HEADING_RE);
    if (!m) return null;
    if (/[.:;,]$/.test(t)) return null;            // headings don't end in punctuation
    const firstNum = parseInt(m[1].split('.')[0], 10);
    if (firstNum < 1 || firstNum > 40) return null; // chapters 1-40; excludes data rows like "<bignum> pose"
    // Table/data-row guard. `pose` was an UNBOUNDED substring that wrongly
    // dropped real headings like "3.2 Pose Estimation" / "4.1 6-DOF Pose
    // Tracking" — common in robotics/vision theses. Use a word-boundary form
    // AND only reject when the row also carries data-row shapes (brackets, units)
    // so a genuine "Pose Estimation" heading survives.
    if (/[[\]]|\bmm\b|\brx\b/i.test(t)) return null; // bracketed / unit-bearing data rows
    if (/\bpose\b/i.test(t) && /\[|\b\d+\s*,|\bx\s*,\s*y\b/i.test(t)) return null; // pose DATA rows only
    if (BIBLIO_RE.test(t)) return null;            // numbered bibliography entries
    return { num: m[1], title: m[2].trim() };
}

/**
 * Identify the [startLine, endLine] span of the Table of Contents: the region
 * between the first and last dotted-leader line, when there are enough of them
 * to constitute a real ToC. Returns null when there's no ToC. This scopes the
 * looser "N.N Title <page>" exclusion so it cannot drop real content lines that
 * merely end in a number elsewhere in the document.
 */
function detectTocRegion(lines: string[]): { start: number; end: number; count: number } | null {
    let first = -1;
    let last = -1;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        if (hasDottedLeader(lines[i])) {
            if (first === -1) first = i;
            last = i;
            count++;
        }
    }
    if (count < 5) return null; // a real ToC is many dotted lines; <5 is incidental
    return { start: first, end: last, count };
}

/**
 * Build a Document Map from stored reference-file content. Pure + deterministic.
 * Works on PDF content that carries [Page N] markers (the v18→v19 ingest format)
 * and degrades gracefully on plain text without markers.
 */
export function buildDocumentMap(content: string): DocumentMap {
    const lines = content.split('\n');
    const toc = detectTocRegion(lines);
    const tocStart = toc ? toc.start : -1;
    const tocEnd = toc ? toc.end : -1;

    const sections: DocumentSection[] = [];
    let current: { num: string; heading: string; pageStart: number; pageEnd: number; body: string[] } = {
        num: '', heading: '', pageStart: 1, pageEnd: 1, body: [],
    };
    let curPage = 1;
    let maxPage = 1;
    let tocLinesRemoved = 0;

    const flush = () => {
        const body = current.body.join('\n').replace(/\s+/g, ' ').trim();
        if (body || current.heading) {
            sections.push({
                num: current.num,
                heading: current.heading || 'Preamble',
                pageStart: current.pageStart,
                pageEnd: Math.max(current.pageStart, current.pageEnd),
                body,
                depth: current.num ? current.num.split('.').length : 0,
            });
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const pm = line.match(PAGE_MARKER_RE);
        if (pm) {
            curPage = parseInt(pm[1], 10);
            if (curPage > maxPage) maxPage = curPage;
            current.pageEnd = curPage; // section spans up to the latest page seen
            continue;
        }
        const inToc = tocStart !== -1 && i >= tocStart && i <= tocEnd;
        // ToC lines (dotted leaders anywhere; "N.N Title <page>" only inside the
        // ToC region) are navigation, not content.
        if (hasDottedLeader(line) || (inToc && isTocEntryLine(line))) {
            tocLinesRemoved++;
            continue;
        }
        const h = parseHeading(line);
        if (h) {
            flush();
            current = { num: h.num, heading: line.trim(), pageStart: curPage, pageEnd: curPage, body: [] };
        } else {
            current.body.push(line);
        }
    }
    flush();

    // hasToc gates section-based chunking. Two valid paths qualify:
    //
    //   PATH A (traditional): a dotted-leader Table of Contents removed during
    //   parse + at least 3 numbered sections afterwards. This is the original
    //   thesis-style detection.
    //
    //   PATH B (round-6 generalization, 2026-07-01): a document WITHOUT a
    //   ToC but WITH ≥5 numbered section headings inline (e.g. modern two-
    //   column journals, slide-deck PDFs, academic papers with numbered
    //   headings only). The count is conservative at ≥5 AND requires at
    //   least one multi-level heading (depth ≥ 2, e.g. "1.1 Background") so
    //   flat to-do lists / numbered FAQ formats with all depth-1 entries
    //   ("1 First\n2 Second\n...") don't false-positive into section
    //   chunking. Hardened after test-engineer review 2026-07-01.
    //
    // A pure flat-prose document (no ToC, no numbered headings) keeps
    // hasToc=false so callers fall back to their word-window chunker — see
    // DocumentMap.test.mjs "flat-prose doc with no ToC does NOT set hasToc".
    const numberedSections = sections.filter(s => s.num).length;
    const hasMultiLevel = sections.some(s => s.depth >= 2);
    const isPathA = tocLinesRemoved >= 5 && numberedSections >= 3;
    const isPathB = !isPathA && numberedSections >= 5 && hasMultiLevel;
    const hasToc = isPathA || isPathB;
    const hasTocPath: 'A' | 'B' | null = isPathA ? 'A' : isPathB ? 'B' : null;

    return { sections, pageCount: maxPage, tocLinesRemoved, hasToc, hasTocPath };
}

/**
 * Section-aware chunking shared by BOTH retrievers (the sync lexical
 * ModeContextRetriever AND the hybrid ModeHybridRetriever). Each chunk is the
 * section body (sub-split when long), prefixed with a `[Section N.N | pX-Y]
 * heading` tag so the chunk carries its own section + page provenance into
 * scoring, telemetry, and the prompt. Returns null when the document has no
 * detectable ToC/section structure — the caller then keeps its existing
 * word-window chunker (flat-prose fixtures, slide decks).
 *
 * This is the single source of truth for ToC-excluding chunking; keeping it here
 * (not duplicated in each retriever) prevents the two paths from diverging — the
 * exact bug that let production keep serving ToC fragments while the lexical
 * path was fixed.
 */
/**
 * Detect delimited tabular data (CSV/TSV) and chunk it BY ROWS with the header
 * repeated on every chunk. Prose chunkers destroy tables: a CSV has no sentence
 * punctuation, so it collapses into a couple of giant blobs where rows lose their
 * column meaning (the header is only in the first chunk), and the model fabricates
 * values instead of reading them. Row-aware chunks keep whole rows intact and give
 * each chunk its own `header + N rows`, so a query for one entity retrieves that
 * entity's row with its columns labelled. Returns null when the text is not a
 * consistent delimited table.
 */
export function tabularChunks(content: string, rowsPerChunk?: number): string[] | null {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 3) return null; // need a header + at least a couple rows
    // Pick the delimiter from the header: comma or tab, whichever splits into >=2
    // columns consistently across the sampled rows.
    const header = lines[0];
    const delim = header.includes('\t') && !header.includes(',') ? '\t' : ',';
    const cols = header.split(delim).length;
    if (cols < 2) return null;
    // Require the majority of sampled rows to have the same column count — this
    // distinguishes a real table from prose that happens to contain commas.
    const sample = lines.slice(1, Math.min(lines.length, 60));
    const consistent = sample.filter((l) => Math.abs(l.split(delim).length - cols) <= 1).length;
    if (consistent < sample.length * 0.8) return null;

    const headerLine = header.trim();
    const rows = lines.slice(1);
    // ADAPTIVE granularity: small tables get SMALL chunks (finer granularity → each
    // chunk's embedding is specific to a few entities, so a query for one entity —
    // "United States population" — ranks that entity's chunk highly). Large tables
    // grow rows-per-chunk to stay under MAX_TABLE_CHUNKS (index memory/OOM bound).
    // Every chunk repeats the header so rows stay labelled + findable.
    const MAX_TABLE_CHUNKS = Number(process.env.NATIVELY_MAX_TABLE_CHUNKS) || 120;
    const MIN_ROWS = Number(process.env.NATIVELY_TABLE_MIN_ROWS_PER_CHUNK) || 10;
    // Base target: ~10 rows/chunk for finer specific-entity recall; but never so many
    // chunks that a large table blows the cap.
    const base = rowsPerChunk ?? MIN_ROWS;
    const effRows = Math.max(base, Math.ceil(rows.length / MAX_TABLE_CHUNKS));
    const chunks: string[] = [];
    for (let i = 0; i < rows.length; i += effRows) {
        const slice = rows.slice(i, i + effRows);
        // Repeat the header on every chunk so column semantics travel with the rows.
        chunks.push(`[Table rows ${i + 1}-${i + slice.length}]\n${headerLine}\n${slice.join('\n')}`);
    }
    return chunks.length > 0 ? chunks : null;
}

/**
 * Split text into sentences, then pack WHOLE sentences into ~targetWords windows
 * with a sentence-boundary overlap. Guarantees a clause — e.g. "Implementations
 * MUST NOT add a byte order mark…" — is never cut across a chunk boundary (which
 * dropped "MUST NOT" from the chunk carrying "byte order mark"). A single sentence
 * longer than targetWords is emitted whole. Progress is always forced (no
 * re-evaluation loop) so it can't infinite-loop when overlap >= target.
 */
export function sentenceAwareWindows(text: string, targetWords: number, overlapWords: number): string[] {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const wordCount = (s: string) => (s.match(/\S+/g) || []).length;
    if (wordCount(clean) <= targetWords) return [clean];
    const sentences: string[] = [];
    for (const part of clean.split(/(?<=[.!?][")\]]?)\s+(?=[A-Z0-9"[(])/)) {
        const p = part.trim();
        if (p) sentences.push(p);
    }
    if (sentences.length <= 1) return [clean];
    const windows: string[] = [];
    let cur: string[] = [];
    let curWords = 0;
    for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i];
        const sw = wordCount(s);
        if (cur.length > 0 && curWords + sw > targetWords) {
            windows.push(cur.join(' '));
            const overlap: string[] = [];
            let ow = 0;
            for (let j = cur.length - 1; j >= 0 && ow < overlapWords; j--) { overlap.unshift(cur[j]); ow += wordCount(cur[j]); }
            cur = overlap;
            curWords = ow;
        }
        cur.push(s);
        curWords += sw;
        if (curWords >= targetWords) { windows.push(cur.join(' ')); cur = []; curWords = 0; }
    }
    if (cur.length > 0) windows.push(cur.join(' '));
    return windows.filter((w, idx) => idx === 0 || w !== windows[idx - 1]);
}

export function sectionAwareChunksFromMap(
    map: DocumentMap,
    chunkWords: number,
    chunkOverlap: number,
): string[] | null {
    if (!map.hasToc) return null;
    const chunks: string[] = [];
    for (const section of map.sections) {
        const body = section.body.trim();
        if (!body) continue;
        const tag = section.num
            ? `[Section ${section.num} | p${section.pageStart}${section.pageEnd !== section.pageStart ? '-' + section.pageEnd : ''}]`
            : `[p${section.pageStart}]`;
        const headingLine = section.heading && section.heading !== 'Preamble'
            ? `${tag} ${section.heading}`
            : tag;
        const words = body.split(/\s+/).filter(Boolean);
        if (words.length <= chunkWords) {
            chunks.push(`${headingLine}\n${body}`);
            continue;
        }
        for (const window of sentenceAwareWindows(body, chunkWords, chunkOverlap)) {
            chunks.push(`${headingLine}\n${window}`);
        }
    }
    return chunks.length > 0 ? chunks : null;
}

/**
 * Resolve a query to the section numbers it most likely targets, using the
 * section TITLES from the document map (not a hardcoded synonym table). Returns
 * section numbers ordered best-first. ADVISORY ONLY — the caller must treat
 * these as a boost/preference, never a hard filter (a query whose entity is not
 * a title word would otherwise lose recall). Empty when nothing matches
 * confidently; the caller then falls back to global retrieval.
 */
export function resolveTargetSections(query: string, map: DocumentMap): string[] {
    const q = query.toLowerCase();
    const qWords = new Set(
        q.replace(/[^a-z0-9#-]+/g, ' ').split(/\s+/).filter(w => w.length > 2),
    );
    // Short pure-digit ordinals (1, 2, 3 …) are discriminating in queries like
    // "What is Benchmark 1 about?" — the digit is the only token that separates
    // §4.2.1 from §4.2.2 and §4.2.3. They are filtered by the `length > 2` guard
    // above, so we add them back explicitly.
    const qOrdinals = new Set(
        q.replace(/[^0-9\s]+/g, ' ').split(/\s+/).filter(d => /^\d{1,2}$/.test(d)),
    );
    if (qWords.size === 0 && qOrdinals.size === 0) return [];

    const tokenizeTitle = (heading: string): string[] => heading.toLowerCase()
        .replace(/^\d+(?:\.\d+)*\s+/, '')
        .replace(/[^a-z0-9#-]+/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

    // Original-case title words (parallel to tokenizeTitle output) so that
    // all-caps acronyms like RLDS, DOF, VLA, MSE retain their signal after
    // tokenizeTitle lowercases them for the qWords lookup.
    const tokenizeTitleOrigCase = (heading: string): string[] => heading
        .replace(/^\d+(?:\.\d+)*\s+/, '')
        .replace(/[^A-Za-z0-9#-]+/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

    // Title document frequency: how many section titles contain each word. A
    // word in only ONE title (e.g. "ros#", "unity", "openvla-oft") is
    // DISTINCTIVE; a word in many titles ("robot", "data", "structure") is
    // generic. This — not token length — decides whether a single-word title
    // match is strong enough to short-circuit. "unity"/"ros#" are short but
    // distinctive; "robot" is long but generic.
    const titleDf = new Map<string, number>();
    for (const s of map.sections) {
        if (!s.num) continue;
        for (const tw of new Set(tokenizeTitle(s.heading))) titleDf.set(tw, (titleDf.get(tw) || 0) + 1);
    }

    const scored: Array<{ num: string; score: number; wordHits: number; distinctiveHit: boolean }> = [];
    for (const s of map.sections) {
        if (!s.num) continue;
        const titleWords = tokenizeTitle(s.heading);
        if (titleWords.length === 0) continue;
        let hits = 0;
        let wordHits = 0;          // distinct title words present in the query
        let distinctiveHit = false; // a title-rare (df<=2) ENTITY token matched
        // A token is "distinctive" only when it is BOTH rare in titles (df≤2) AND
        // has signal shape (a non-lowercase-alpha character: digit, hyphen, "#",
        // uppercase). This prevents plain dictionary words that are df=1 purely
        // due to spelling variation ("robot" vs "robotic") from being treated as
        // entity tokens — only true entities like "ros#", "openvla-oft", "x1"
        // qualify. Without this gate, "robot" (df=1) caused the planner to target
        // §2.3 Mercury X1 Robot (hardware) for "what task did the robot perform?"
        // instead of falling to resolveByContent, which correctly finds §3.2.1.
        // hasSignalShape: a token has signal when it contains a non-lowercase char
        // (digit, hyphen, "#") OR when its original-case form is an all-caps
        // acronym (RLDS, DOF, VLA, MSE). tokenizeTitle lowercases "RLDS" → "rlds"
        // so the /[^a-z]/ test alone misses pure-alpha acronyms.
        const titleWordsOrigCase = tokenizeTitleOrigCase(s.heading);
        const hasSignalShape = (tw: string, idx: number): boolean =>
            /[^a-z]/.test(tw) || /^[A-Z]{2,}$/.test(titleWordsOrigCase[idx] ?? '');
        const markDistinctive = (tw: string, idx: number) => {
            if ((titleDf.get(tw) || 0) <= 2 && hasSignalShape(tw, idx)) distinctiveHit = true;
        };
        for (let ti = 0; ti < titleWords.length; ti++) {
            const tw = titleWords[ti];
            if (qWords.has(tw)) { hits++; wordHits++; markDistinctive(tw, ti); }
        }
        // Exact verbatim title-token match in the query (handles "ROS#", hyphens).
        for (let ti = 0; ti < titleWords.length; ti++) {
            const tw = titleWords[ti];
            if (tw.length >= 3 && q.includes(tw)) { hits += 0.5; markDistinctive(tw, ti); }
        }
        if (hits > 0) {
            // Normalise by title length so a 1-word title match isn't swamped by
            // a long title that happens to share a common word.
            scored.push({ num: s.num, score: hits / Math.sqrt(titleWords.length), wordHits, distinctiveHit });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    // A STRONG title match is high-confidence ONLY when it has real specificity:
    // either ≥2 distinct title words matched, OR a DISTINCTIVE (title-rare)
    // token matched — e.g. "ROS#", "Unity", "OpenVLA-OFT", "Evaluation". A
    // SINGLE GENERIC-noun match (a query sharing just "robot" with "2.3 Mercury
    // X1 Robot", where "robot" appears in many titles) must NOT short-circuit,
    // or it steals targeting from the section whose BODY actually answers (e.g.
    // "3.2.1 Robotic Task Structure" for "what task did the robot perform").
    // Such weak matches fall through to the content fallback below.
    const strongTitleTargets = scored
        .filter(s => s.score >= 1.0 && (s.wordHits >= 2 || s.distinctiveHit))
        .slice(0, 4).map(s => s.num);
    if (strongTitleTargets.length > 0) return strongTitleTargets;
    return resolveByContent(query, map, qOrdinals);
}

/**
 * Content-based section resolution: score section BODIES for the query's
 * content terms, weighting each by inverse section frequency (a word in few
 * sections is discriminative). The top body section MUST contain the rarest
 * content word, so a section sharing only generic words can't win. Used as the
 * fallback when no title matches, and merged in for ambiguous single-word title
 * matches. No document-specific terms are hardcoded.
 *
 * qOrdinals: bare numeric ordinals extracted from the query (e.g. {'1', '2'}).
 * Used to break ties when the query references a numbered item ("Benchmark 1")
 * whose ordinal discriminates between parallel sections (§4.2.1 vs §4.2.2).
 * The ordinal '1' appears in the BODY of §4.2.1 ("first benchmark", "1 task")
 * but NOT in §4.2.2 or §4.2.3, providing a decisive discriminating signal.
 */
function resolveByContent(query: string, map: DocumentMap, qOrdinals: Set<string> = new Set()): string[] {
    const q = query.toLowerCase();
    const qWords = new Set(q.replace(/[^a-z0-9#-]+/g, ' ').split(/\s+/).filter(w => w.length > 2));
    const STOPWORDS = new Set([
        'what', 'which', 'where', 'when', 'how', 'why', 'who', 'whom',
        'used', 'use', 'using', 'uses', 'was', 'were', 'are', 'is', 'the',
        'for', 'and', 'with', 'this', 'that', 'these', 'those', 'does', 'did',
        'has', 'have', 'had', 'can', 'could', 'would', 'should', 'about',
        'role', 'main', 'project', 'thesis', 'paper', 'work', 'study', 'perform',
        // Sync with DOC_GROUNDED_STOPWORDS (ModeContextRetriever.ts): these are
        // high-frequency words that appear in almost every section body and add
        // noise rather than signal to IDF body scoring.
        'many', 'much', 'research',
    ]);
    // Length floor is > 2 (not >= 4) so 3-char tokens like 'mse', 'ros', 'vla'
    // participate in body scoring — they are rare content words whose section
    // frequency is typically 1, making them the rarest word and the anchor for
    // the rarest-word guard below. The STOPWORDS set already blocks noise tokens.
    const contentWords = [...qWords].filter(w => w.length > 2 && !STOPWORDS.has(w));
    if (contentWords.length === 0) return [];
    const sectionsWithBody = map.sections.filter(s => s.num && s.body);
    if (sectionsWithBody.length === 0) return [];
    const lowerBodies = sectionsWithBody.map(s => s.body.toLowerCase());
    // Also lowercase each section heading (without number prefix) for the
    // title-word tiebreak below.
    const lowerHeadings = sectionsWithBody.map(s =>
        s.heading.toLowerCase().replace(/^\d+(?:\.\d+)*\s+/, ''),
    );
    const sf = new Map<string, number>();
    for (const w of contentWords) {
        let n = 0;
        for (const lb of lowerBodies) if (lb.includes(w)) n++;
        sf.set(w, n);
    }
    const total = sectionsWithBody.length;
    const rarest = [...contentWords].sort((a, b) => (sf.get(a) || total) - (sf.get(b) || total))[0];
    const bodyScored: Array<{ num: string; score: number }> = [];
    for (let i = 0; i < sectionsWithBody.length; i++) {
        const bodyLower = lowerBodies[i];
        if (!bodyLower.includes(rarest)) continue;
        let score = 0;
        for (const w of contentWords) {
            if (!bodyLower.includes(w)) continue;
            const freq = sf.get(w) || total;
            score += Math.log((total + 1) / (freq + 1));
        }
        // Title-word tiebreak: a section whose HEADING contains a content word is
        // the authoritative source for that concept — a strong bonus so that
        // §3.2.3 "Preprocessing and RLDS format" decisively outranks §3.3 for
        // "what format was the dataset stored in?", and §3.2.1 "Robotic Task
        // Structure" outranks §2.3 "Mercury X1 Robot" for task queries. The bonus
        // is large (2.0 per match) because IDF body scores can differ by >1 when a
        // "big" section like §3.3 mentions format/dataset in passing many times.
        // Substring matching handles "robot" in "robotic task structure", which
        // gives §3.2.1 BOTH "task" and "robot" matches (+4) vs §2.3 "mercury x1
        // robot" with only "robot" (+2), preserving Q38's correct routing.
        let titleBonus = 0;
        for (const w of contentWords) {
            if (lowerHeadings[i].includes(w)) titleBonus += 2.0;
        }
        // Ordinal discrimination: when the query contains a bare digit (e.g. '1'
        // from "Benchmark 1"), sections whose HEADING contains a DIFFERENT digit
        // are penalised. "Benchmark 2" (heading has '2') is wrong for "Benchmark 1"
        // even if its body scores equally. The heading digits (stripped of section
        // number prefix) are compared against qOrdinals.
        let ordinalBonus = 0;
        if (qOrdinals.size > 0) {
            // Extract bare digit tokens from the heading (after stripping the section number).
            const headingText = lowerHeadings[i];
            const headingDigits = new Set(
                headingText.replace(/[^0-9\s]+/g, ' ').split(/\s+/).filter(d => /^\d{1,2}$/.test(d)),
            );
            // Penalty: heading explicitly names a DIFFERENT ordinal than the query.
            const hasWrongOrdinal = [...headingDigits].some(d => !qOrdinals.has(d));
            // Bonus: heading does NOT contain a conflicting ordinal (section is neutral
            // or matches). Prefer sections with no ordinal in their heading over those
            // that name the wrong ordinal.
            if (hasWrongOrdinal) ordinalBonus -= 3.0; // decisive penalty for "Benchmark 2" when query says "1"
        }
        const total_score = score + titleBonus + ordinalBonus;
        // Push if score is positive OR if ordinals are active and this section
        // wasn't penalised (ordinalBonus >= 0 means no conflicting ordinal in
        // the heading) — covers "Benchmark 1" where IDF score is 0 for all
        // sections but §4.2.1 has no wrong ordinal in its heading.
        if (total_score > 0 || (qOrdinals.size > 0 && ordinalBonus >= 0)) {
            bodyScored.push({ num: sectionsWithBody[i].num, score: total_score });
        }
    }
    bodyScored.sort((a, b) => b.score - a.score);
    if (bodyScored.length === 0) return [];
    const top = bodyScored[0].score;
    return bodyScored.filter(s => s.score >= top * 0.8).slice(0, 3).map(s => s.num);
}
