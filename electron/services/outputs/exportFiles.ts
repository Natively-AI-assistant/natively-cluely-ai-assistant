// File names and default locations for exported notes. Pure: the platform and
// the folder are passed in, so both the macOS and the Windows branch are tested
// from either machine.

import * as path from 'path';

export type NotesExportFormat = 'pdf' | 'html';

export const NOTES_EXPORT_FILTERS: Record<NotesExportFormat, { name: string; extensions: string[] }> = {
    pdf: { name: 'PDF document', extensions: ['pdf'] },
    html: { name: 'Web page', extensions: ['html'] },
};

const WINDOWS_DEVICE_NAME_RE = /^(?:con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)$/i;

/**
 * "Weekly sync 2026-10-14": legal on both systems whichever one writes it,
 * since the file may be opened or synced on the other. Reserved characters
 * become spaces, a leading dot (hidden on macOS) and a trailing dot or space
 * (dropped by Windows) go, Windows device names get a prefix.
 */
export function notesFileStem(title: unknown, dateIso?: string): string {
    const raw = typeof title === 'string' ? title : '';
    let stem = raw
        .normalize('NFKC')
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[. ]+/, '')
        .slice(0, 80)
        .replace(/[. ]+$/, '');
    if (!stem) stem = 'Meeting notes';
    if (WINDOWS_DEVICE_NAME_RE.test(stem.split('.')[0].trim())) stem = `Notes ${stem}`;
    const day = typeof dateIso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateIso) ? dateIso.slice(0, 10) : '';
    return day && !stem.includes(day) ? `${stem} ${day}` : stem;
}

/** The path the save dialog opens on, joined with the platform's own separators. */
export function defaultExportPath(platform: NodeJS.Platform, folder: string, stem: string, format: NotesExportFormat): string {
    const p = platform === 'win32' ? path.win32 : path.posix;
    return p.join(folder, `${stem}.${format}`);
}

/**
 * The file the user picked, with the extension added when they typed a name
 * without one (the Windows dialog does this itself; macOS does not always).
 */
export function withExportExtension(platform: NodeJS.Platform, filePath: string, format: NotesExportFormat): string {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const ext = p.extname(filePath).toLowerCase();
    return ext === `.${format}` ? filePath : `${filePath}.${format}`;
}

/** Letter where it is the paper size people print on (US, Canada, Mexico and a few others), A4 elsewhere. */
const LETTER_COUNTRIES = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR', 'GT', 'DO', 'CR', 'SV', 'PA', 'NI', 'HN', 'BZ']);
export function pdfPageSize(countryCode: string | undefined | null): 'Letter' | 'A4' {
    return LETTER_COUNTRIES.has(String(countryCode || '').toUpperCase()) ? 'Letter' : 'A4';
}
