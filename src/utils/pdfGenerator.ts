import jsPDF from 'jspdf';
import { meetingHasCJK, splitFontRuns, wrapCjkText } from '../lib/pdfCjkText.mjs';

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
// font and use it for the CJK stretches of the document.
const CJK_FONT_NAME = 'NotoSansSC';
const CJK_FONT_VFS = 'NotoSansSC-Regular.ttf';

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

    // Selecting the embedded font for the WHOLE document would destroy text that
    // Helvetica rendered correctly — the subset carries 1 of the 96 Latin-1
    // Supplement codepoints, and jsPDF's Identity-H encoder does not just drop an
    // unmappable one, it discards the rest of the string ("José Müller said the
    // room was 25°C" → "Jos"). So each line is drawn as a sequence of runs and
    // every run keeps the font that can actually encode it. See needsEmbeddedFont.
    const setRunFont = (embedded: boolean, isBold: boolean) => {
        doc.setFont(embedded && useCjk ? CJK_FONT_NAME : 'helvetica', isBold ? 'bold' : 'normal');
    };

    const measureRuns = (text: string, isBold: boolean): number => {
        let width = 0;
        for (const run of splitFontRuns(text)) {
            setRunFont(run.embedded, isBold);
            width += doc.getTextWidth(run.text);
        }
        return width;
    };

    const drawRuns = (text: string, x: number, baseline: number, isBold: boolean) => {
        let cursor = x;
        for (const run of splitFontRuns(text)) {
            setRunFont(run.embedded, isBold);
            doc.text(run.text, cursor, baseline);
            cursor += doc.getTextWidth(run.text);
        }
    };

    // Wrapping strategy:
    //  - Non-CJK docs: jsPDF's space-based splitTextToSize (unchanged behavior).
    //  - CJK docs: per-character break units, measured run-aware (CJK has no
    //    spaces to break on). See wrapCjkText.
    const wrapText = (text: string, isBold: boolean): string[] =>
        useCjk
            ? wrapCjkText(text, contentWidth, (s) => measureRuns(s, isBold))
            : doc.splitTextToSize(text, contentWidth);

    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, color: string = '#000000') => {
        doc.setFontSize(fontSize);
        setRunFont(false, isBold);
        doc.setTextColor(color);

        const lines = wrapText(text, isBold);

        // Check if we need a new page
        if (y + (lines.length * fontSize * 0.5) > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = 20;
        }

        if (useCjk) {
            // Draw line by line so each can be split into per-font runs. The step is
            // jsPDF's own leading (getLineHeight() is in points; the document is in
            // mm), so the result is identical to what doc.text(lines, ...) lays out.
            const lineStep = doc.getLineHeight() / doc.internal.scaleFactor;
            lines.forEach((line, i) => drawRuns(line, margin, y + (i * lineStep), isBold));
        } else {
            doc.text(lines, margin, y);
        }
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
