// Text helpers for the CJK path of the meeting-PDF exporter
// (src/utils/pdfGenerator.ts). Kept here, framework-free and measurement-free,
// so the wrapping and detection rules are unit-testable without a jsPDF
// document — width measurement is injected by the caller.

// U+3000–303F (CJK symbols/punctuation), U+3400–9FFF (CJK ideographs),
// U+F900–FAFF (compatibility ideographs), U+FF00–FFEF (fullwidth forms).
//
// Written once, as an escaped source string, and shared by every regex below.
// The ranges used to be spelled out twice with literal characters, and the two
// copies silently disagreed: one used 豈 U+8C48, the other 豈 U+F900. They render
// identically, so the difference was invisible in review, and the wider range it
// produced swallowed U+D800–DFFF — every surrogate half matched on its own, which
// split astral characters (emoji, CJK Ext-B) into two independent break units.
// One source plus the `u` flag makes both mistakes impossible to reintroduce.
const CJK_RANGES = '\\u3000-\\u303F\\u3400-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF';

export const CJK_RE = new RegExp(`[${CJK_RANGES}]`, 'u');

// A fresh /g regex per call — a shared one carries `lastIndex` between callers.
const cjkUnitRe = () => new RegExp(`[${CJK_RANGES}]|\\s+|[^${CJK_RANGES}\\s]+`, 'gu');

export const hasCJK = (text) => typeof text === 'string' && CJK_RE.test(text);

/** Collect every string the PDF will render, to decide if the CJK font is needed. */
export const meetingHasCJK = (meeting) => {
    if (!meeting) return false;
    if (hasCJK(meeting.title) || hasCJK(meeting.summary)) return true;
    if (meeting.detailedSummary) {
        if ((meeting.detailedSummary.actionItems || []).some(hasCJK)) return true;
        if ((meeting.detailedSummary.keyPoints || []).some(hasCJK)) return true;
    }
    if ((meeting.transcript || []).some((t) => hasCJK(t?.speaker) || hasCJK(t?.text))) return true;
    if ((meeting.usage || []).some((u) => hasCJK(u?.question) || hasCJK(u?.answer))) return true;
    return false;
};

/**
 * True when a character must be drawn with the embedded font rather than Helvetica.
 *
 * The two fonts have mirror-image encoders and the split falls exactly at U+00FF:
 *
 *  - jsPDF's built-in Helvetica is WinAnsi, and its encoder only maps U+0000–00FF.
 *    Anything above that (—, …, “ ”, •, every CJK glyph) is silently dropped.
 *  - The embedded font is a GB2312 + ASCII subset: it carries 1 of the 96 Latin-1
 *    Supplement codepoints, and its Identity-H encoder does not merely drop an
 *    unmappable U+0080–00FF character — it stops, discarding the rest of the
 *    string. "José Müller said the room was 25°C" came out as "Jos".
 *
 * So at or below U+00FF Helvetica is the only font that can encode the character,
 * and above it the embedded font is the only one with a chance. Routing that way
 * makes the truncation unreachable and leaves non-CJK text byte-for-byte as it
 * rendered before the embedded font existed.
 */
export const needsEmbeddedFont = (ch) => ch.codePointAt(0) > 0xff;

/** Split a string into alternating Helvetica / embedded-font runs. */
export const splitFontRuns = (text) => {
    const runs = [];
    for (const ch of String(text)) {
        const embedded = needsEmbeddedFont(ch);
        const last = runs[runs.length - 1];
        if (last && last.embedded === embedded) last.text += ch;
        else runs.push({ text: ch, embedded });
    }
    return runs;
};

/**
 * Wrap text that contains CJK, greedily, against a measured width.
 *
 * Tokenised into break units: each CJK ideograph/punctuation is its own unit (CJK
 * has no spaces, so it may break anywhere), while a run of Latin/other characters
 * stays ONE unit, so English words are not split mid-word inside a mixed meeting.
 *
 * @param text          the paragraph(s) to wrap; '\n' is preserved as a hard break
 * @param contentWidth  maximum line width, in the document's units
 * @param measure       (string) => number, the caller's width measurement
 */
export const wrapCjkText = (text, contentWidth, measure) => {
    const out = [];
    for (const paragraph of String(text).split('\n')) {
        if (paragraph === '') { out.push(''); continue; }
        const units = paragraph.match(cjkUnitRe()) || [];
        let line = '';
        for (const unit of units) {
            // An indivisible unit wider than the whole line (a long URL / file path /
            // unspaced token) cannot fit even on its own line — hard-break it per
            // character so it does not overflow the right margin. CJK units are single
            // glyphs and never reach this.
            if (!/^\s+$/.test(unit) && measure(unit) > contentWidth) {
                if (line) { out.push(line); line = ''; }
                for (const ch of unit) {
                    const candidate = line + ch;
                    if (line && measure(candidate) > contentWidth) { out.push(line); line = ch; }
                    else line = candidate;
                }
                continue;
            }
            const candidate = line + unit;
            if (line && measure(candidate) > contentWidth) {
                out.push(line);
                // Don't start a new line with leading whitespace from the break.
                line = /^\s+$/.test(unit) ? '' : unit;
            } else {
                line = candidate;
            }
        }
        if (line) out.push(line);
    }
    return out;
};
