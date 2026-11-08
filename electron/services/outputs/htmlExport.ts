// The notes as one self-contained HTML file: "Share as file", and the page the
// PDF export prints. Pure. Every piece of meeting text is escaped, and the page
// carries a Content-Security-Policy that allows no script, no network and no
// external resource, so the file is inert wherever it is opened.

import { formatOffset, inlineSpans, type NotesDocument } from './notesDocument';

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};

export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]);
}

/** One line of note text, with its **bold** / *italic* / `code` as tags. */
export function inlineHtml(text: string): string {
    return inlineSpans(text)
        .map((s) => {
            const t = escapeHtml(s.text);
            if (s.code) return `<code>${t}</code>`;
            if (s.bold) return `<strong>${t}</strong>`;
            if (s.italic) return `<em>${t}</em>`;
            return t;
        })
        .join('');
}

export interface NotesHtmlOptions {
    includeTranscript: boolean;
    /** The PDF prints in light, at page width; the shared file follows the reader's theme. */
    forPrint?: boolean;
}

const STYLE = `
:root { --ink: #1d1d1f; --muted: #6e6e73; --rule: #e5e5ea; --bg: #ffffff; --chip: #f2f2f7; }
@media (prefers-color-scheme: dark) { :root:not(.print) { --ink: #f5f5f7; --muted: #a1a1a6; --rule: #38383a; --bg: #1c1c1e; --chip: #2c2c2e; } }
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0 auto; max-width: 760px; padding: 48px 32px 64px; color: var(--ink); background: var(--bg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased; }
.print body { padding: 0; max-width: none; }
h1 { font-size: 28px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.01em; }
.meta { color: var(--muted); font-size: 13px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 10px; }
p { margin: 0 0 10px; }
ul { margin: 0; padding-left: 20px; }
li { margin: 0 0 6px; }
ul.tasks { list-style: none; padding-left: 0; }
ul.tasks li { display: flex; gap: 10px; align-items: baseline; }
.box { flex: none; width: 13px; height: 13px; border: 1.5px solid var(--muted); border-radius: 3px; position: relative; top: 2px; }
.box.done { background: var(--muted); }
.owner { font-weight: 600; }
.due { color: var(--muted); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--chip); padding: 1px 4px; border-radius: 4px; }
.transcript { border-top: 1px solid var(--rule); margin-top: 40px; }
.line { display: grid; grid-template-columns: 64px 1fr; gap: 12px; margin: 0 0 8px; break-inside: avoid; }
.time { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; padding-top: 2px; }
.who { font-weight: 600; }
footer { color: var(--muted); font-size: 12px; margin-top: 48px; border-top: 1px solid var(--rule); padding-top: 12px; }
@media print { h2 { break-after: avoid; } li { break-inside: avoid; } }
`;

export function buildNotesHtml(doc: NotesDocument, opts: NotesHtmlOptions): string {
    const parts: string[] = [];
    parts.push(`<h1>${escapeHtml(doc.title)}</h1>`);
    const metaLine = [doc.dateLabel, doc.durationLabel].filter(Boolean).join(' · ');
    if (metaLine) parts.push(`<p class="meta">${escapeHtml(metaLine)}</p>`);
    const people = doc.attendees.length
        ? doc.attendees.map((a) => a.name || a.email)
        : doc.participants;
    if (people.length) parts.push(`<p class="meta">With ${escapeHtml(people.join(', '))}</p>`);

    for (const s of doc.sections) {
        parts.push(`<h2>${escapeHtml(s.heading)}</h2>`);
        if (s.paragraph) {
            for (const para of s.paragraph.split(/\n{2,}/)) parts.push(`<p>${inlineHtml(para)}</p>`);
        }
        if (s.bullets.length) parts.push(`<ul>${s.bullets.map((b) => `<li>${inlineHtml(b)}</li>`).join('')}</ul>`);
    }

    if (doc.actionItems.length) {
        parts.push('<h2>Action items</h2>');
        parts.push(`<ul class="tasks">${doc.actionItems.map((a) => (
            `<li><span class="box${a.done ? ' done' : ''}" aria-hidden="true"></span><span>`
            + `${a.owner ? `<span class="owner">${escapeHtml(a.owner)}:</span> ` : ''}${inlineHtml(a.text)}`
            + `${a.deadline ? ` <span class="due">by ${escapeHtml(a.deadline)}</span>` : ''}</span></li>`
        )).join('')}</ul>`);
    }

    if (opts.includeTranscript && doc.transcript.length) {
        parts.push('<section class="transcript"><h2>Transcript</h2>');
        for (const l of doc.transcript) {
            parts.push(`<div class="line"><span class="time">${escapeHtml(formatOffset(l.offsetMs))}</span>`
                + `<span><span class="who">${escapeHtml(l.speaker)}:</span> ${escapeHtml(l.text)}</span></div>`);
        }
        parts.push('</section>');
    }

    parts.push('<footer>Notes from Natively</footer>');

    return [
        '<!doctype html>',
        `<html lang="en"${opts.forPrint ? ' class="print"' : ''}>`,
        '<head>',
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<meta name="color-scheme" content="${opts.forPrint ? 'light' : 'light dark'}">`,
        `<title>${escapeHtml(doc.title)}</title>`,
        `<style>${STYLE}</style>`,
        '</head>',
        `<body>${parts.join('\n')}</body>`,
        '</html>',
        '',
    ].join('\n');
}
