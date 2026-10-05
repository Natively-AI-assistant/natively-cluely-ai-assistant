// The update card's short version of a GitHub release. The parser in
// electron/update/ReleaseNotesManager.ts keeps each bullet as written, markdown
// and all, and a real release runs to thirty-odd paragraphs — far more than
// the card's notes area holds. The card shows the release's own summary, or,
// without one, the first few headlines; everything else is a count, and the
// full notes stay one click away. A summary and headlines together would say
// the same thing twice: the summary already names the headline features.

const HIGHLIGHT_SECTIONS = ["What's New", 'Improvements', 'Fixes'];
const COUNT_KEY = { "What's New": 'new', Improvements: 'improvements', Fixes: 'fixes' };

/** Inline markdown down to the words a reader sees. */
export function plainText(md) {
    return String(md ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1$2')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * One line for a bullet. A bold lead that stands alone ("**Meeting notes,
 * rebuilt.** Summaries…" or "**Auto Answer (Beta)** — answers…") is the
 * headline. A bold lead that is only the start of the sentence ("**NVIDIA NIM**
 * joins the provider list") is not, so the plain sentence's first clause is.
 */
export function headlineOf(item) {
    const lead = /^\s*\*\*(.+?)\*\*(.*)$/s.exec(String(item ?? ''));
    if (lead) {
        const title = plainText(lead[1]);
        const rest = lead[2];
        if (title && (/[.!?:]$/.test(title) || rest.trim() === '' || /^\s*[—–:-]/.test(rest))) {
            return title.replace(/[.:]$/, '').trim();
        }
    }
    const text = plainText(item);
    return text.split(/\s[—–]\s|(?<=[.!?;])\s/)[0].replace(/[.;:]$/, '').trim();
}

/**
 * @returns {{ summary: string, highlights: string[], counts: Array<{ key: 'more'|'new'|'improvements'|'fixes', count: number }> } | null}
 *   null when the release says nothing the card can show.
 */
export function digestReleaseNotes(notes, { maxHighlights } = {}) {
    if (!notes) return null;
    const summary = plainText(notes.summary);
    const itemsOf = (title) => (notes.sections ?? []).find((s) => s.title === title)?.items ?? [];

    // Headlines come from the first section that has any; the rest are counted.
    const source = HIGHLIGHT_SECTIONS.find((title) => itemsOf(title).length > 0);
    const limit = maxHighlights ?? (summary ? 0 : 4);
    const highlights = source && limit > 0 ? itemsOf(source).slice(0, limit).map(headlineOf).filter(Boolean) : [];

    const counts = [];
    for (const title of HIGHLIGHT_SECTIONS) {
        const count = itemsOf(title).length - (title === source ? highlights.length : 0);
        if (count <= 0) continue;
        counts.push({ key: title === source && highlights.length > 0 ? 'more' : COUNT_KEY[title], count });
    }

    if (!summary && highlights.length === 0) return null;
    return { summary, highlights, counts };
}

/** "v2.8.8", "V2.8.8" and "2.8.8" are the same version; GitHub tags use both cases. */
export function bareVersion(version) {
    return String(version ?? '').trim().replace(/^v/i, '');
}
