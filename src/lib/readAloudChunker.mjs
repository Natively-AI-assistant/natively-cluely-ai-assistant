// Read-aloud: turns a streamed AI answer into speakable sentences.
//
// The overlay feeds every streamed token in with push(); whole sentences come
// back out as soon as they are complete, so speech starts while the rest of
// the answer is still arriving. flush() returns whatever is left once the
// stream ends.
//
// - A sentence ends at . ! ? followed by whitespace, or at a newline.
// - A run with no boundary is cut at the last space before SOFT_CAP
//   characters: Chromium's speechSynthesis stalls on very long utterances.
// - Markdown is stripped (bold, headings, bullets, links, inline code ticks).
// - Fenced code is never read: the first fence in an answer is announced
//   once ("Code shown on screen.") and its contents are skipped.
// - The trailing [[GIST]] teleprompter line is display metadata: it and
//   everything after it is dropped.
//
// Pure module — no DOM, no speechSynthesis — so it is unit-testable.

export const SOFT_CAP = 220;
export const CODE_NOTICE = 'Code shown on screen.';

const FENCE = '```';
const BOUNDARY = /[.!?](?=\s)|\n/;

export function cleanForSpeech(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) -> label
        .replace(/`+/g, '')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        // Underscore emphasis is left alone: it would mangle snake_case names.
        .replace(/(\*\*|\*|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/\$\$?([^$]*)\$\$?/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

// Characters at the end of `buf` that might be the start of a fence or a
// [[GIST]] marker still being streamed; they are held back until the next
// token decides what they are.
function heldTailLength(buf) {
    const partials = ['``', '`', '[[GIST]', '[[GIST', '[[GIS', '[[GI', '[[G', '[[', '['];
    for (const p of partials) if (buf.endsWith(p)) return p.length;
    return 0;
}

export function createChunker() {
    let buf = '';
    let inFence = false;
    let announcedCode = false;
    let done = false;

    const emit = (out, raw) => {
        if (done) return;
        const gistAt = raw.indexOf('[[GIST');
        if (gistAt !== -1) {
            raw = raw.slice(0, gistAt);
            done = true;
        }
        const clean = cleanForSpeech(raw);
        if (clean && /[\p{L}\p{N}]/u.test(clean)) out.push(clean);
    };

    const drain = (out, final) => {
        while (!done && buf.length > 0) {
            if (inFence) {
                const close = buf.indexOf(FENCE);
                if (close === -1) {
                    // Keep only what could be the start of the closing fence.
                    buf = final ? '' : buf.slice(-2);
                    return;
                }
                const lineEnd = buf.indexOf('\n', close + FENCE.length);
                if (lineEnd === -1 && !final) {
                    buf = buf.slice(close);
                    return;
                }
                buf = lineEnd === -1 ? '' : buf.slice(lineEnd + 1);
                inFence = false;
                continue;
            }

            const open = buf.indexOf(FENCE);
            const region = open === -1 ? buf : buf.slice(0, open);
            const m = BOUNDARY.exec(region);
            if (m) {
                const end = m.index + 1;
                emit(out, region.slice(0, end));
                buf = buf.slice(end);
                continue;
            }
            if (open !== -1) {
                emit(out, region);
                if (!announcedCode && !done) {
                    out.push(CODE_NOTICE);
                    announcedCode = true;
                }
                buf = buf.slice(open + FENCE.length);
                inFence = true;
                continue;
            }
            if (region.length > SOFT_CAP) {
                const space = region.lastIndexOf(' ', SOFT_CAP);
                const cut = space > 0 ? space : SOFT_CAP;
                emit(out, region.slice(0, cut));
                buf = buf.slice(cut);
                continue;
            }
            if (final) {
                emit(out, buf);
                buf = '';
            }
            return;
        }
    };

    return {
        push(token) {
            const out = [];
            if (done || typeof token !== 'string' || token.length === 0) return out;
            buf += token;
            const held = heldTailLength(buf);
            if (held > 0) {
                const tail = buf.slice(-held);
                buf = buf.slice(0, -held);
                drain(out, false);
                buf += tail;
            } else {
                drain(out, false);
            }
            return out;
        },
        flush() {
            const out = [];
            drain(out, true);
            buf = '';
            done = true;
            return out;
        },
    };
}
