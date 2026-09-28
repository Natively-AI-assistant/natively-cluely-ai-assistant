// Pure helpers behind the meeting-notes Usage tab's answer layout
// (MeetingDetails.tsx › UsageInteraction / CodingAnswerBlock) and the notes'
// follow-up draft and title. Kept out of the component so the parsing rules are
// unit-testable; nothing here touches the DOM or the platform.

// A markdown list marker at the start of a line: "- ", "* ", "+ ", "• ", "1. ", "2) ".
export const LIST_MARKER_RE = /^\s*(?:[-*+•]|\d{1,2}[.)])\s+/;

// Pull the first sentence so the answer can lead with a one-line thesis. Avoids
// cutting on decimals (3.4x), abbreviations (e.g., i.e., etc.) and single
// initials by requiring the terminator to be followed by a space + a capital or
// end-of-string. Falls back to a length cap so a run-on paragraph never becomes
// the whole thesis.
const ABBREV_RE = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|Dr|Mr|Ms|Mrs|Fig|No|cf|al)\.$/i;
export function firstSentence(text) {
    const flat = text.replace(/\s+/g, ' ').trim();
    const re = /(?<!\d)[.!?](?=\s+["'“(]?[A-Z0-9]|\s*$)/g;
    let m;
    while ((m = re.exec(flat)) !== null) {
        const candidate = flat.slice(0, m.index + 1);
        if (!ABBREV_RE.test(candidate)) return candidate.trim();
    }
    return flat.length > 160 ? flat.slice(0, 157).trimEnd() + '…' : flat;
}

// The approach section is often a bullet list ("- Classic **TSP**: ... - **Hard
// problem**: ..."). The thesis is the FIRST item only, marker stripped, with any
// lines it wraps onto; the rest stays in the Approach pill. Plain prose falls
// through to firstSentence.
export function leadingItem(body) {
    const lines = body.split('\n').map(l => l.trim());
    const start = lines.findIndex(l => l.length > 0);
    if (start < 0) return '';
    const item = [lines[start].replace(LIST_MARKER_RE, '')];
    for (let i = start + 1; i < lines.length && lines[i] && !LIST_MARKER_RE.test(lines[i]); i++) item.push(lines[i]);
    return firstSentence(item.join(' '));
}

// Short single-line label for the technique chip in the code header: first line,
// no list marker, cut at a word boundary (never mid-word). The chip itself
// ellipsizes whatever still does not fit, so this only keeps the string sane.
export const TECHNIQUE_MAX = 56;
export function techniqueLabel(body) {
    const first = body.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    let label = first
        .replace(LIST_MARKER_RE, '')
        .replace(/[`*_#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(via|using|use|technique[:\s-]*)\s*/i, '');
    // Too long: drop a trailing parenthetical before cutting anything else.
    if (label.length > TECHNIQUE_MAX) label = label.replace(/\s*\([^)]*\)?\s*$/, '').trim();
    if (label.length > TECHNIQUE_MAX) {
        const cut = label.slice(0, TECHNIQUE_MAX - 1);
        label = cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).trimEnd() + '…';
    }
    return label;
}

// Big-O with one level of nested brackets: O(n log(k)), O(n * (m+k)).
const BIG_O = String.raw`O\((?:[^()\n]|\([^()\n]*\))*\)`;
const TIME_RE = new RegExp(String.raw`time[^\n]*?(${BIG_O})`, 'i');
const SPACE_RE = new RegExp(String.raw`space[^\n]*?(${BIG_O})`, 'i');
const BARE_RE = new RegExp(BIG_O, 'g');

// LaTeX the model wrote inside a complexity ("$O(N \log K)$", "O(T \times K)")
// turned into the plain characters the cost chip can show: \times → ×, \log → log,
// \sqrt{n} → √n, and so on; ^{2} becomes ^2 so the chip still superscripts it.
const LATEX_SYMBOLS = { times: '×', cdot: '·', infty: '∞', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', pm: '±', Theta: 'Θ', Omega: 'Ω', omega: 'ω', theta: 'θ', sqrt: '√' };
export function latexToPlain(text) {
    if (!text.includes('\\') && !text.includes('{')) return text;
    return text
        .replace(/\\(?:text|mathrm|operatorname|mathbf)\{([^{}]*)\}/g, '$1')
        .replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
        .replace(/\\(left|right|big|Big)\b/g, '')
        .replace(/\\[,;: ]/g, ' ')
        .replace(/\^\{([A-Za-z0-9]+)\}/g, '^$1')
        .replace(/\\([A-Za-z]+)/g, (_m, name) => LATEX_SYMBOLS[name] ?? name)
        .replace(/[{}]/g, '')
        .replace(/[ \t]{2,}/g, ' ');
}

// Compact "O(n) time · O(1) space" for the cost chip, or null when the section
// has no Big-O in it (the caller then shows no chip — there is no Complexity
// pill any more).
// NOTE: match Big-O on the SAME line as the time/space keyword rather than with a
// negated class like [^O]: under /i that also excludes lowercase 'o', which
// breaks "Time complexity: O(n)".
export function extractComplexity(body) {
    const time = TIME_RE.exec(body)?.[1];
    const space = SPACE_RE.exec(body)?.[1];
    if (time || space) {
        return [time && `${latexToPlain(time)} time`, space && `${latexToPlain(space)} space`].filter(Boolean).join(' · ');
    }
    const bare = body.match(BARE_RE);
    return bare && bare.length ? Array.from(new Set(bare.map(latexToPlain))).slice(0, 2).join(' · ') : null;
}

// "N/A", "None", "Not applicable, conceptual question." — a section the model
// filled in only to say it does not apply. Such sections are not shown. An empty
// section counts too.
const NOT_APPLICABLE_RE = /^(?:n\/?a|none|not applicable|not needed|not required|no dry run)(?![\p{L}\p{N}])/iu;
export function isNotApplicable(body) {
    const t = String(body ?? '').trim().replace(LIST_MARKER_RE, '').replace(/^[*_`"'(\s]+/, '');
    if (!t) return true;
    return t.length <= 160 && NOT_APPLICABLE_RE.test(t);
}

// The model sometimes writes the answer to say out loud AFTER the last template
// section — either behind a horizontal rule, or as plain paragraphs following
// the last section's bullet list. Left alone, the section parser folds it into
// that last section (the Follow-up pill). This splits it back out.
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const MIN_TAIL = 40;
export function splitTrailingAnswer(body) {
    const lines = String(body).split('\n');
    let inFence = false;
    let sawItem = false;
    let headEnd = -1;
    let tailStart = -1;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*```/.test(l)) { inFence = !inFence; continue; }
        if (inFence) continue;
        if (HR_RE.test(l)) { headEnd = i; tailStart = i + 1; break; }
        if (LIST_MARKER_RE.test(l)) { sawItem = true; continue; }
        if (sawItem && l.trim() === '') {
            let j = i + 1;
            while (j < lines.length && lines[j].trim() === '') j++;
            const next = lines[j];
            // A paragraph after the list: not indented (a list continuation), not another list/heading/table/quote/fence.
            if (next !== undefined && !/^\s/.test(next) && !LIST_MARKER_RE.test(next) && !HR_RE.test(next) && !/^(?:#|>|\||```)/.test(next)) {
                headEnd = i; tailStart = j; break;
            }
        }
    }
    if (tailStart < 0) return { body, tail: '' };
    const tail = lines.slice(tailStart).join('\n').trim();
    if (tail.length < MIN_TAIL) return { body, tail: '' };
    return { body: lines.slice(0, headEnd).join('\n').trimEnd(), tail };
}

// Section titles print in a small label, not through markdown: "## **Key Design
// Decisions**" would otherwise show its asterisks.
export function plainTitle(title) {
    return String(title).replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
}

// Split text into fenced-code and non-code parts so line rewrites never touch code.
const FENCE_SPLIT = /(```[\s\S]*?(?:```|$))/g;

// Lines the model wrote one per line, with single newlines, run together into one
// paragraph in markdown. Two shapes are given a hard break:
//   1. a "**Label:**" line under a prose line;
//   2. a line that ends a thought (. ! ? : ; ✓ ) ] or a closing quote) followed by a
//      line that starts a new one (capital, digit, bracket or quote) — the
//      step-by-step working / example-per-line shape.
// Lists, headings, tables, quotes, code and existing hard breaks are left alone,
// and so are long lines (prose that was wrapped, not written line by line).
const BLOCK_START_RE = /^\s*(?:[-*+•]\s|\d{1,2}[.)]\s|#{1,6}\s|>|\||```)/;
const BOLD_LABEL_RE = /^\*\*[^*\n]+\*\*/;
const THOUGHT_END_RE = /[.!?:;✓✔)\]”"]$/;
const THOUGHT_START_RE = /^[A-Z0-9(\[“"]/;
const GLUE_MAX_LINE = 160;
export function breakGluedLines(text) {
    return text.split(FENCE_SPLIT).map((part, idx) => {
        if (idx % 2 === 1) return part;
        const lines = part.split('\n');
        for (let i = 1; i < lines.length; i++) {
            const prev = lines[i - 1];
            const cur = lines[i].trim();
            if (!cur || !prev.trim() || BLOCK_START_RE.test(prev) || BLOCK_START_RE.test(cur) || /(?:  |\\)$/.test(prev)) continue;
            const label = BOLD_LABEL_RE.test(cur);
            const sentenceStep = THOUGHT_END_RE.test(prev.trimEnd()) && THOUGHT_START_RE.test(cur) && prev.length < GLUE_MAX_LINE;
            if (label || sentenceStep) lines[i - 1] = prev.replace(/\s+$/, '') + '  ';
        }
        return lines.join('\n');
    }).join('');
}

// "** Kafka:**" is not bold in markdown (the opening ** must touch the text), so
// the asterisks print. Close the gap inside ** … ** when the emphasised text
// starts with a letter, so "2 ** 3 ** 4" is left alone. Code is untouched.
export function fixBoldSpacing(text) {
    return text.split(FENCE_SPLIT).map((part, idx) => {
        if (idx % 2 === 1) return part;
        return part.split(/(`[^`\n]*`)/g).map((seg, k) => {
            if (k % 2 === 1) return seg;
            return seg.replace(/(^|[\s(])\*\*[ \t]+(?=\p{L})([^*\n]*?\S)[ \t]*\*\*(?=[\s.,;:!?)]|$)/gmu, '$1**$2**')
                      .replace(/(^|[\s(])\*\*(?=\p{L})([^*\n]*?\S)[ \t]+\*\*(?=[\s.,;:!?)]|$)/gmu, '$1**$2**');
        }).join('');
    }).join('');
}

// \( c \) is LaTeX inline math; remark-math only understands $c$. Convert it,
// leaving code spans and fences untouched.
export function latexParensToDollars(text) {
    return text.split(FENCE_SPLIT).map((part, idx) => {
        if (idx % 2 === 1) return part;
        return part.split(/(`[^`\n]*`)/g).map((seg, k) => {
            if (k % 2 === 1) return seg;
            return seg.replace(/\\\(\s*([^\n$]+?)\s*\\\)/g, (_m, inner) => `$${inner}$`);
        }).join('');
    }).join('');
}

// A model's chain-of-thought, stored inline at the start of an answer:
// "<think>…</think>\n\nThe answer." Same rules as the generation-side filter
// (electron/llm/reasoningTagFilter.ts): LEADING only, the block must be CLOSED,
// and if nothing is left after it the original is kept — never a blank answer.
const REASONING_TAGS = new Set(['think', 'thinking', 'reasoning', 'reason']);
export function stripLeadingReasoning(text) {
    const src = String(text ?? '');
    const open = /^\s*<([A-Za-z][\w:-]*)(?:\s[^>]{0,200})?>/.exec(src);
    if (!open) return src;
    const name = open[1];
    if (!REASONING_TAGS.has(name.split(':').pop().toLowerCase())) return src;
    const closeRe = new RegExp(`</${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i');
    const rest = src.slice(open[0].length);
    const close = closeRe.exec(rest);
    if (!close) return src;
    const after = rest.slice(close.index + close[0].length).replace(/^\s+/, '');
    return after.trim() ? after : src;
}

// "[[GIST]] …" lines the model wrote in the MIDDLE of an answer (one after each
// part of a multi-part answer). splitGistLine only takes the last one; these are
// dropped so the marker never prints. Only whole lines that START with the
// marker (optionally bullet-prefixed) go, never a marker inside a sentence.
const STRAY_GIST_RE = /^[ \t]*(?:[-*•–—>]+[ \t]*)?\[\[GIST\]\].*(?:\n|$)/gm;
export function stripStrayGistLines(text) {
    if (!text.includes('[[GIST]]')) return text;
    return text.replace(STRAY_GIST_RE, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

// The follow-up draft is an EMAIL: plain text on screen, in Copy, and in the Gmail
// compose link. Model markdown in it ("**Problem:**") would print its asterisks in
// all three, so emphasis and heading marks go. Hyphen bullets are fine in an email.
export function plainEmailText(text) {
    return String(text ?? '')
        .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
        .replace(/(^|[\s(])__([^_\n]+?)__(?=[\s.,;:!?)]|$)/gm, '$1$2')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/^#{1,6}[ \t]+/gm, '');
}

// A meeting title the model wrote with list or heading chrome ("- Summary was
// missing…"). Shown and edited without it; the original is kept if nothing is left.
export function plainMeetingTitle(title) {
    const raw = String(title ?? '');
    const t = raw
        .replace(/^\s*(?:[-*+•–—]|#{1,6})[ \t]+/, '')
        .replace(/\*\*|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return t || raw;
}

// Some stored answers arrive with their list newlines collapsed to spaces, so a
// list becomes one run-on line ("Here's the plan: - Build it. - Test it." or
// "Steps: 1. Do x. 2. Do y."). This re-breaks such a line into a list.
//
// It is deliberately STRICT, because the loose version it replaces mangled
// ordinary prose in 13 of 668 real answers: "move left to 1. `left_max` …" lost its
// "1", "max(0, c - a - b)" and "O(n * K)" split into bullets, and "## 1. Basic
// Query" became an empty heading. So, per LINE:
//   * a marker only counts when it follows sentence punctuation (. ! ? : ;) —
//     "range 1. From", "c - a - b" and "(a+b) - a" never do;
//   * a bullet item must start like an item (capital, **bold, `code`, bracket, quote);
//   * numbered items must run 1, 2, 3… in order, so "start at 0 and 3. Then" is left alone;
//   * a flattened line needs two markers (the line's own leading one counts);
//   * headings, tables, quotes and code are never touched.
const INLINE_BULLET = /([.!?:;])[ \t]+([-*•])[ \t]+(?=[A-Z*`(\u0001"“'])/g;
const INLINE_NUMBER = /([.!?:;])[ \t]+(\d{1,2})([.)])[ \t]+(?=[A-Z(\u0001])/g;
export function reflowFlattenedList(text) {
    if (!/[.!?:;][ \t]+(?:[-*•]|\d{1,2}[.)])[ \t]+\S/.test(text)) return text;
    // Protect fenced + inline code so a marker inside code is never broken.
    const stash = [];
    const put = (m) => { stash.push(m); return '\u0001' + (stash.length - 1) + '\u0001'; };
    const shielded = text.replace(/```[\s\S]*?```/g, put).replace(/`[^`\n]*`/g, put);
    const out = shielded.split('\n').map((line) => {
        if (/^\s*(?:#{1,6}\s|\||>)/.test(line)) return line;
        let l = line;
        const inlineBullets = [...l.matchAll(INLINE_BULLET)].length;
        const startsBullet = /^\s*[-*•]\s+\S/.test(l);
        if (inlineBullets >= 1 && inlineBullets + (startsBullet ? 1 : 0) >= 2) l = l.replace(INLINE_BULLET, '$1\n$2 ');
        const start = /^\s*(\d{1,2})[.)]\s+\S/.exec(l);
        const seq = [...(start ? [Number(start[1])] : []), ...[...l.matchAll(INLINE_NUMBER)].map(m => Number(m[2]))];
        const inOrder = seq.length >= 2 && seq[0] === 1 && seq.every((n, i) => i === 0 || n === seq[i - 1] + 1);
        if (inOrder) l = l.replace(INLINE_NUMBER, '$1\n$2$3 ');
        return l;
    }).join('\n');
    return out.replace(/\u0001(\d+)\u0001/g, (_m, i) => stash[Number(i)] ?? '');
}
