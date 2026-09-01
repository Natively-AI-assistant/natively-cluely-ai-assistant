import jsPDF from 'jspdf';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

// jsPDF's built-in fonts (Helvetica/Courier) are Latin-only with WinAnsi
// encoding — every CJK codepoint silently maps to a missing glyph, so a Chinese
// transcript exported as boxes / dropped characters. We embed a CJK TrueType
// font and switch to it whenever CJK is present.
const CJK_FONT_NAME = 'NotoSansSC';
const CJK_FONT_VFS = 'NotoSansSC-Regular.ttf';

// U+3000–303F (CJK symbols/punct), U+3400–9FFF (CJK ideographs),
// U+F900–FAFF (compat ideographs), U+FF00–FFEF (fullwidth forms).
// NOTE: the embedded font is a GB2312 (Simplified Chinese) + Latin subset, so
// this range can also detect Traditional-only or rare ideographs the subset
// does not carry — those render as .notdef boxes. Everyday Simplified Chinese
// (the transcription target) is the intended scope; widen the subset in
// src/assets/fonts if broader coverage is ever needed.
const CJK_RE = /[　-〿㐀-鿿豈-﫿＀-￯]/;

const hasCJK = (text: string | undefined | null): boolean =>
    typeof text === 'string' && CJK_RE.test(text);

/** Collect every string the PDF will render, to decide if the CJK font is needed. */
const meetingHasCJK = (meeting: Meeting): boolean => {
    if (hasCJK(meeting.title) || hasCJK(meeting.summary)) return true;
    if (meeting.detailedSummary) {
        if ((meeting.detailedSummary.actionItems || []).some(hasCJK)) return true;
        if ((meeting.detailedSummary.keyPoints || []).some(hasCJK)) return true;
    }
    if ((meeting.transcript || []).some((t) => hasCJK(t.speaker) || hasCJK(t.text))) return true;
    if ((meeting.usage || []).some((u) => hasCJK(u.question) || hasCJK(u.answer))) return true;
    return false;
};

// Load the CJK font as base64 via dynamic import() — a lazy code-split chunk.
// We deliberately do NOT fetch() a `?url` asset: the packaged renderer runs on
// the file:// scheme with webSecurity enabled, where Chromium's Fetch API
// refuses file:// URLs (works in dev over the HTTP dev server, breaks once
// packaged). Dynamic import goes through the module loader, which the app
// already relies on for file:// (e.g. React.lazy of the cropper window), so it
// works in both dev and the packaged app on macOS and Windows. The import is
// only reached when the meeting actually contains CJK, so English-only exports
// and app startup never pull in the ~2.7 MB chunk.
const loadCjkFontBase64 = async (): Promise<string> => {
    const mod = await import('../assets/fonts/notoSansSC.base64');
    return mod.notoSansSCBase64;
};

export const generateMeetingPDF = async (meeting: Meeting): Promise<void> => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // Register the CJK font once, up front, if any content needs it. The subset
    // ships only Regular, so bold maps to the same file (no synthetic bold, but
    // the glyphs render correctly instead of vanishing).
    const useCjk = meetingHasCJK(meeting);
    if (useCjk) {
        const b64 = await loadCjkFontBase64();
        doc.addFileToVFS(CJK_FONT_VFS, b64);
        doc.addFont(CJK_FONT_VFS, CJK_FONT_NAME, 'normal');
        doc.addFont(CJK_FONT_VFS, CJK_FONT_NAME, 'bold');
    }

    // Wrapping strategy:
    //  - Non-CJK docs: jsPDF's space-based splitTextToSize (unchanged behavior).
    //  - CJK docs: tokenize into break units — each CJK ideograph/punctuation is
    //    its own unit (CJK has no spaces, so it may break anywhere), while a run
    //    of Latin/other characters stays ONE unit (so English words are NOT split
    //    mid-word). Units are greedily packed by measured width. This keeps
    //    English passages word-wrapped even inside a mixed zh/en meeting.
    const CJK_UNIT_RE = /[　-〿㐀-鿿豈-﫿＀-￯]|\s+|[^　-〿㐀-鿿豈-﫿＀-￯\s]+/g;
    const wrapText = (text: string): string[] => {
        if (!useCjk) return doc.splitTextToSize(text, contentWidth);
        const out: string[] = [];
        for (const paragraph of String(text).split('\n')) {
            if (paragraph === '') { out.push(''); continue; }
            const units = paragraph.match(CJK_UNIT_RE) || [];
            let line = '';
            for (const unit of units) {
                // An indivisible unit wider than the whole line (a long URL / file
                // path / unspaced token) can't fit even on its own line — hard-break
                // it per character so it doesn't overflow the right margin. CJK units
                // are single glyphs and never hit this.
                if (!/^\s+$/.test(unit) && doc.getTextWidth(unit) > contentWidth) {
                    if (line) { out.push(line); line = ''; }
                    for (const ch of unit) {
                        const c = line + ch;
                        if (line && doc.getTextWidth(c) > contentWidth) { out.push(line); line = ch; }
                        else line = c;
                    }
                    continue;
                }
                const candidate = line + unit;
                if (line && doc.getTextWidth(candidate) > contentWidth) {
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

    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, color: string = '#000000') => {
        doc.setFontSize(fontSize);
        doc.setFont(useCjk ? CJK_FONT_NAME : 'helvetica', isBold ? 'bold' : 'normal');
        doc.setTextColor(color);

        const lines = wrapText(text);

        // Check if we need a new page
        if (y + (lines.length * fontSize * 0.5) > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = 20;
        }

        doc.text(lines, margin, y);
        y += (lines.length * fontSize * 0.5) + 2; // Add some spacing
    };

    const addVerticalSpace = (amount: number) => {
        y += amount;
    };

    // --- Header ---
    addText(meeting.title, 18, true, '#000000');
    addVerticalSpace(2);
    addText(`${meeting.date} • ${meeting.duration}`, 10, false, '#666666');
    addVerticalSpace(10);

    // --- Summary ---
    if (meeting.summary) {
        addText('Summary', 14, true, '#000000');
        addVerticalSpace(2);
        addText(meeting.summary, 10, false, '#333333');
        addVerticalSpace(8);
    }

    if (meeting.detailedSummary) {
        if (meeting.detailedSummary.actionItems && meeting.detailedSummary.actionItems.length > 0) {
            addText('Action Items', 12, true, '#000000');
            meeting.detailedSummary.actionItems.forEach(item => {
                addText(`• ${item}`, 10, false, '#333333');
            });
            addVerticalSpace(5);
        }

        if (meeting.detailedSummary.keyPoints && meeting.detailedSummary.keyPoints.length > 0) {
            addText('Key Points', 12, true, '#000000');
            meeting.detailedSummary.keyPoints.forEach(point => {
                addText(`• ${point}`, 10, false, '#333333');
            });
            addVerticalSpace(8);
        }
    }

    // --- Transcript ---
    if (meeting.transcript && meeting.transcript.length > 0) {
        addText('Transcript', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.transcript.forEach(entry => {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            // Speaker line
            addText(`${entry.speaker} [${timeStr}]`, 10, true, '#444444');
            // Text line
            addText(entry.text, 10, false, '#333333');
            addVerticalSpace(2);
        });
        addVerticalSpace(8);
    }

    // --- Usage (Q&A / AI Interactions) ---
    if (meeting.usage && meeting.usage.length > 0) {
        addText('AI Usage & Interactions', 14, true, '#000000');
        addVerticalSpace(2);

        meeting.usage.forEach(item => {
            if (item.type === 'chat' && item.question && item.answer) {
                addText(`Q: ${item.question}`, 10, true, '#222222');
                addText(`A: ${item.answer}`, 10, false, '#444444');
                addVerticalSpace(3);
            }
            else if (item.type === 'assist' && item.answer) {
                addText('Assist:', 10, true, '#222222');
                addText(item.answer, 10, false, '#444444');
                addVerticalSpace(3);
            }
        });
    }

    // Save. Latin-only titles keep the old slug; a CJK title would slug to an
    // empty string, so fall back to a safe default in that case.
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/_+/g, '_').replace(/^_|_$/g, '');
    doc.save(`${safeTitle || 'meeting'}.pdf`);
};
