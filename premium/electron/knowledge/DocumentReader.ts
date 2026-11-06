// Raw text extraction for Profile Intelligence documents.
//
// Delegates to the shared SafeDocumentTextExtractor so the Profile Intelligence
// Resume/JD pipeline accepts the same hardened format set as Modes Manager
// (txt/md/markdown/json/csv/tsv/xml/html/htm/log/pdf/docx). The minimum-content
// quality gate below is Profile Intelligence-specific: a 50-char pass is too
// short to be a real resume or job description.

import path from 'path';
import { extractSafeDocumentText } from '../../../electron/services/SafeDocumentTextExtractor';

const MIN_PROFILE_DOCUMENT_CHARS = 50;

// Real resumes/JDs are 2-15KB of text; this ceiling is ~10-25x that. It
// exists to protect StructuredExtractor's single-LLM-call extraction (the
// whole document is interpolated into one prompt), not to bound legitimate
// content — a document this long as a "resume" or "JD" is almost certainly
// the wrong file. Unlike Modes Manager reference files (which have no such
// ceiling — they're chunked+embedded, not sent as one prompt, and are
// expected to be large), this must REJECT, not truncate: silently
// structuring only the first N characters of a mis-selected file would
// produce a plausible-looking but wrong profile with no indication anything
// was dropped.
const MAX_PROFILE_DOCUMENT_CHARS = 200_000;

export async function extractDocumentText(filePath: string): Promise<string> {
    const extracted = await extractSafeDocumentText(filePath);
    const text = extracted.content.trim();
    const kind = extracted.extension === '.pdf' ? 'PDF'
        : extracted.extension === '.docx' ? 'DOCX'
        : 'document';

    if (text.length < MIN_PROFILE_DOCUMENT_CHARS) {
        throw new Error(`${kind} appears to contain very little text. It may be a scanned or corrupt document.`);
    }

    if (text.length > MAX_PROFILE_DOCUMENT_CHARS) {
        throw new Error(
            `${kind} is too long (${text.length.toLocaleString()} characters) to be a resume or job description — `
            + `the limit is ${MAX_PROFILE_DOCUMENT_CHARS.toLocaleString()}. `
            + `Please upload a shorter document. If this is meant to be a reference document, add it as a reference file under Modes Manager instead: `
            + `long documents have no such limit there and stay fully searchable.`
        );
    }

    console.log(`[DocumentReader] Extracted ${text.length} chars from ${path.basename(filePath)}`);
    return text;
}